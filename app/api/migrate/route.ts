import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rowToSnake } from "@/lib/supabase/tables";

// Use secret key for server-side access (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Insert rows in chunks of at most `size` to stay within Supabase batch limits */
async function insertInChunks(
  table: string,
  rows: Record<string, unknown>[],
  size = 500,
): Promise<{ inserted: number; error?: string }> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) return { inserted, error: error.message };
    inserted += chunk.length;
  }
  return { inserted };
}

// ---------------------------------------------------------------------------
// Migration handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // This route runs with the service key (bypasses RLS) and reads the whole
  // ledger — it must NEVER be publicly triggerable. Reuse the quick-add
  // bearer token as the gate, and fail closed when it isn't configured.
  const token = process.env.QUICK_ADD_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [];

  // 1. Read ALL rows from the legacy KV table
  const { data: kvRows, error: kvError } = await supabase
    .from("app_data")
    .select("key, value");

  if (kvError) {
    return NextResponse.json(
      { ok: false, log: [`Failed to read app_data: ${kvError.message}`] },
      { status: 500 },
    );
  }

  const dataMap: Record<string, string> = {};
  for (const row of kvRows ?? []) {
    dataMap[row.key] = row.value;
  }

  log.push(`Read ${Object.keys(dataMap).length} keys from app_data`);

  // ---------------------------------------------------------------------------
  // 2. Entity tables  (camelCase JSON arrays → snake_case upsert)
  // ---------------------------------------------------------------------------

  const ENTITY_KEYS = [
    "income_entries",
    "expense_entries",
    "recurring_income_templates",
    "recurring_expense_templates",
    "portfolio_holdings",
    "portfolio_transactions",
    "debt_records",
    "debt_transactions",
    "networth_goals",
  ] as const;

  for (const key of ENTITY_KEYS) {
    try {
      const rows = safeParse<Record<string, unknown>[]>(dataMap[key], []);
      if (rows.length === 0) {
        log.push(`${key}: 0 rows — skipped`);
        continue;
      }

      const snakeRows = rows.map(rowToSnake);
      const { error } = await supabase.from(key).upsert(snakeRows);
      if (error) {
        log.push(`${key}: ERROR — ${error.message}`);
      } else {
        log.push(`${key}: migrated ${snakeRows.length} rows`);
      }
    } catch (e) {
      log.push(`${key}: ERROR — ${String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Snapshot migrations  (3 KV keys → unified `snapshots` table)
  //    Delete existing rows of that type first for idempotency, then insert
  //    in chunks of 500.
  // ---------------------------------------------------------------------------

  const SNAPSHOT_KEYS: Record<string, string> = {
    portfolio_snapshots: "portfolio",
    crypto_snapshots: "crypto",
    networth_snapshots: "networth",
  };

  for (const [kvKey, snapshotType] of Object.entries(SNAPSHOT_KEYS)) {
    try {
      const rows = safeParse<Record<string, unknown>[]>(dataMap[kvKey], []);
      if (rows.length === 0) {
        log.push(`${kvKey}: 0 rows — skipped`);
        continue;
      }

      // Delete existing snapshots of this type for idempotency
      const { error: deleteError } = await supabase
        .from("snapshots")
        .delete()
        .eq("type", snapshotType);

      if (deleteError) {
        log.push(`${kvKey}: ERROR deleting existing rows — ${deleteError.message}`);
        continue;
      }

      // Only these columns exist in the snapshots table — strip anything else
      const ALLOWED_SNAPSHOT_COLS = new Set([
        "type", "date", "value", "value_no_super", "value_with_super",
        "portfolio", "crypto", "currency",
      ]);
      // Convert keys to snake_case, strip client-generated id, inject type
      const insertRows = rows.map((row) => {
        const snake = rowToSnake(row);
        delete snake["id"];
        snake["type"] = snapshotType;
        // Remove any keys not in the allowed set (e.g. legacy 'time' field)
        for (const k of Object.keys(snake)) {
          if (!ALLOWED_SNAPSHOT_COLS.has(k)) delete snake[k];
        }
        return snake;
      });

      const { inserted, error } = await insertInChunks("snapshots", insertRows);
      if (error) {
        log.push(`${kvKey}: ERROR after inserting ${inserted} rows — ${error}`);
      } else {
        log.push(`${kvKey}: migrated ${inserted} rows (type="${snapshotType}")`);
      }
    } catch (e) {
      log.push(`${kvKey}: ERROR — ${String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Cron log migration  (array of { date, timestamp, success, log })
  //    Delete all existing cron_logs first for idempotency, then insert.
  // ---------------------------------------------------------------------------

  try {
    type CronLogEntry = {
      date: string;
      timestamp: string;
      success: boolean;
      log: string[];
    };

    const cronEntries = safeParse<CronLogEntry[]>(dataMap["cron_log"], []);
    if (cronEntries.length === 0) {
      log.push(`cron_log: 0 rows — skipped`);
    } else {
      const { error: deleteError } = await supabase
        .from("cron_logs")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // delete all rows

      if (deleteError) {
        log.push(`cron_log: ERROR deleting existing rows — ${deleteError.message}`);
      } else {
        const insertRows = cronEntries.map((entry) => ({
          date: entry.date,
          timestamp: entry.timestamp,
          success: entry.success,
          log: JSON.stringify(entry.log),
        }));

        const { inserted, error } = await insertInChunks("cron_logs", insertRows);
        if (error) {
          log.push(`cron_log: ERROR after inserting ${inserted} rows — ${error}`);
        } else {
          log.push(`cron_log: migrated ${inserted} rows`);
        }
      }
    }
  } catch (e) {
    log.push(`cron_log: ERROR — ${String(e)}`);
  }

  // ---------------------------------------------------------------------------
  // 5. Custom category migration  ({ id, label, color } with kind discriminator)
  //    Upsert with onConflict on (id, kind).
  // ---------------------------------------------------------------------------

  const CATEGORY_KEYS: Record<string, string> = {
    custom_income_categories: "income",
    custom_expense_categories: "expense",
  };

  for (const [kvKey, kind] of Object.entries(CATEGORY_KEYS)) {
    try {
      type CategoryRow = { id: string; label: string; color: string };
      const rows = safeParse<CategoryRow[]>(dataMap[kvKey], []);

      if (rows.length === 0) {
        log.push(`${kvKey}: 0 rows — skipped`);
        continue;
      }

      const insertRows = rows.map((row) => {
        const snake = rowToSnake(row as unknown as Record<string, unknown>);
        snake["kind"] = kind;
        return snake;
      });

      const { error } = await supabase
        .from("custom_categories")
        .upsert(insertRows, { onConflict: "id,kind" });

      if (error) {
        log.push(`${kvKey}: ERROR — ${error.message}`);
      } else {
        log.push(`${kvKey}: migrated ${insertRows.length} rows (kind="${kind}")`);
      }
    } catch (e) {
      log.push(`${kvKey}: ERROR — ${String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------------------

  log.push("Migration complete. app_data rows were NOT modified.");
  return NextResponse.json({ ok: true, log });
}
