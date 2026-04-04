import { createClient } from "./client";

// All localStorage keys the app uses
const SYNC_KEYS = [
  "income_entries",
  "expense_entries",
  "crypto_csv_text",
  "crypto_csv_uploaded_at",
  "crypto_exchange_overrides",
  "crypto_stablecoin_tags",
  "crypto_prices_cache",
  "portfolio_holdings",
  "portfolio_transactions",
  "portfolio_snapshots",
  "fund_allocations",
  "debt_records",
  "debt_transactions",
  "preferred_currency",
  "enabled_currencies",
  "fx_rates_cache",
  "networth_snapshots",
  "networth_goal",
  "networth_goals",
  "price_cache",
  "price_update_log",
  "recurring_expense_templates",
  "recurring_income_templates",
  "custom_expense_categories",
  "custom_income_categories",
  "dashboard_hidden_sections",
];

/** Push all localStorage data to Supabase */
export async function pushToSupabase(): Promise<{ success: boolean; error?: string }> {
  if (typeof window === "undefined") return { success: false, error: "No window" };
  try {
    const supabase = createClient();
    const rows: { key: string; value: string; updated_at: string }[] = [];

    for (const key of SYNC_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        rows.push({
          key,
          value: raw,
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (rows.length === 0) return { success: true };

    const { error } = await supabase.from("app_data").upsert(rows, { onConflict: "key" });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Merge data from Supabase into localStorage.
 * - Keys missing locally but present in Supabase → restore them
 * - Keys present locally → keep local version (local wins)
 * Returns how many keys were restored from cloud.
 */
export async function mergeFromSupabase(): Promise<{ success: boolean; keysRestored: number; error?: string }> {
  if (typeof window === "undefined") return { success: false, keysRestored: 0, error: "No window" };
  try {
    const supabase = createClient();
    const { data, error } = await supabase.from("app_data").select("key, value");

    if (error) return { success: false, keysRestored: 0, error: error.message };
    if (!data || data.length === 0) return { success: true, keysRestored: 0 };

    let restored = 0;
    for (const row of data) {
      if (!SYNC_KEYS.includes(row.key)) continue;

      const localValue = localStorage.getItem(row.key);

      // Restore from cloud if missing locally or local is empty/default
      if (localValue === null || localValue === "[]" || localValue === "{}") {
        localStorage.setItem(row.key, row.value);
        restored++;
      }
    }

    return { success: true, keysRestored: restored };
  } catch (e) {
    return { success: false, keysRestored: 0, error: String(e) };
  }
}

/**
 * Force pull ALL data from Supabase, overwriting localStorage.
 * Used for "Restore from Cloud" button.
 */
export async function forceRestoreFromSupabase(): Promise<{ success: boolean; keysRestored: number; error?: string }> {
  if (typeof window === "undefined") return { success: false, keysRestored: 0, error: "No window" };
  try {
    const supabase = createClient();
    const { data, error } = await supabase.from("app_data").select("key, value");

    if (error) return { success: false, keysRestored: 0, error: error.message };
    if (!data || data.length === 0) return { success: true, keysRestored: 0 };

    let restored = 0;
    for (const row of data) {
      if (SYNC_KEYS.includes(row.key)) {
        localStorage.setItem(row.key, row.value);
        restored++;
      }
    }

    return { success: true, keysRestored: restored };
  } catch (e) {
    return { success: false, keysRestored: 0, error: String(e) };
  }
}

/** Get last sync timestamp from localStorage */
export function getLastSyncTime(): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("_supabase_last_sync");
  return raw ? parseInt(raw, 10) : null;
}

/** Record sync timestamp */
export function setLastSyncTime() {
  if (typeof window === "undefined") return;
  localStorage.setItem("_supabase_last_sync", String(Date.now()));
}
