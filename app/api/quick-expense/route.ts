import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { EXPENSE_TYPE_LABELS } from "@/lib/utils/constants";
import { quickExpenseId } from "@/lib/utils/entry-helpers";
import type { ListItem } from "@/lib/storage/list-change";
import { supabaseKvStore, writeListChanges } from "@/lib/storage/kv-cas";

// Quick-add endpoint for the iOS Action Button app.
//
// Expenses do NOT live in the `expense_entries` table — that table is empty.
// The source of truth is a single JSON blob in `app_data` keyed
// "expense_entries", so adding one expense is a read-modify-write of the whole
// array. Doing that from the phone would mean shipping the database key to the
// device and round-tripping ~54 KB per coffee, and any browser tab saving at
// the same moment would clobber the result. Keeping it server-side makes the
// device send ~100 bytes and narrows the race to a single short request.
//
// Auth is a shared bearer token, NOT the Supabase key — a leaked token can only
// append expenses, and can be rotated without touching the database.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const dynamic = "force-dynamic";

const EXPENSES_KEY = "expense_entries";
const CUSTOM_CATEGORIES_KEY = "custom_expense_categories";
const CURRENCY_KEY = "preferred_currency";

const PAYMENT_METHODS = new Set([
  "cash",
  "debit_card",
  "credit_card",
  "bank_transfer",
  "other",
]);

interface ExpenseRecord {
  id: string;
  type: string;
  description: string;
  amount: number;
  currency: string;
  vendor: string;
  date: string;
  notes: string;
  images: string[];
  paymentMethod: string;
  isRecurring: boolean;
  isOneOff: boolean;
  createdAt: number;
  /** Marks rows added from the phone, so they're identifiable later. */
  source?: string;
}

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** Constant-time-ish compare so the token can't be probed byte by byte. */
function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.QUICK_ADD_TOKEN;
  // No token configured = endpoint disabled. Failing closed beats silently
  // exposing an unauthenticated write to the whole expense ledger.
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  return provided.length > 0 && tokenMatches(provided, expected);
}

async function readKv<T>(key: string, fallback: T): Promise<T> {
  const { data } = await supabase
    .from("app_data")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (!data?.value) return fallback;
  try {
    return JSON.parse(data.value as string) as T;
  } catch {
    return fallback;
  }
}

/**
 * Categories and default currency, so the phone can render a picker that
 * matches the web app — including any custom categories added there.
 */
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();

  const [custom, currency] = await Promise.all([
    readKv<{ id: string; label: string; color: string }[]>(
      CUSTOM_CATEGORIES_KEY,
      [],
    ),
    readKv<string>(CURRENCY_KEY, "AUD"),
  ]);

  const categories = [
    ...Object.entries(EXPENSE_TYPE_LABELS).map(([id, label]) => ({ id, label })),
    ...custom.map((c) => ({ id: c.id, label: c.label })),
  ];

  return NextResponse.json({
    categories,
    defaultCurrency: currency,
    paymentMethods: [...PAYMENT_METHODS],
  });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const amount = Number((body as Record<string, unknown>).amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;
  const str = (v: unknown, fallback = "") =>
    typeof v === "string" ? v.trim() : fallback;

  const date = str(b.date) || getSydneyDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const paymentMethod = str(b.paymentMethod, "other");
  // The default currency must actually be read: falling back to AUD when the
  // read fails would silently store a THB (or USD) expense as AUD.
  let currency = str(b.currency);
  if (!currency) {
    try {
      const stored = await supabaseKvStore(supabase).read(CURRENCY_KEY);
      currency = stored ? (JSON.parse(stored.value) as string) : "AUD";
    } catch (err) {
      return NextResponse.json(
        { error: `default currency unavailable: ${err instanceof Error ? err.message : "read failed"}` },
        { status: 503 },
      );
    }
  }

  const clientId = str(b.clientId);
  const entry: ExpenseRecord = {
    // Per-tap id: two retries of one tap that race each other store it once.
    id: clientId ? quickExpenseId(clientId) : crypto.randomUUID(),
    type: str(b.type, "other") || "other",
    description: str(b.description),
    // Round to cents — a float from a phone keypad shouldn't add 0.30000000004.
    amount: Math.round(amount * 100) / 100,
    currency,
    vendor: str(b.vendor),
    date,
    notes: str(b.notes),
    images: [],
    paymentMethod: PAYMENT_METHODS.has(paymentMethod) ? paymentMethod : "other",
    isRecurring: false,
    isOneOff: false,
    createdAt: Date.now(),
    source: "ios",
  };

  try {
    const kv = supabaseKvStore(supabase);

    // Idempotency: the phone retries queued items after a dropped connection,
    // and a retry must not create a duplicate. `clientId` is stable per queued
    // item, so a replay is recognised and acknowledged instead of re-added.
    if (clientId) {
      const stored = await kv.read(EXPENSES_KEY); // throws when the read fails
      const existing: unknown = stored ? JSON.parse(stored.value) : [];
      const already = Array.isArray(existing)
        ? (existing as (ExpenseRecord & { clientId?: string })[]).find((e) => e?.clientId === clientId)
        : undefined;
      if (already) {
        return NextResponse.json({ entry: already, duplicate: true });
      }
      (entry as ExpenseRecord & { clientId?: string }).clientId = clientId;
    }

    // Added to the LATEST stored list with a compare-and-swap — as an insert:
    // a replay whose entry is already stored (maybe edited since) leaves the
    // stored one alone. A failed or non-list read writes nothing; it used to
    // fall back to [] and save a one-entry list over every expense.
    const row = await writeListChanges(kv, EXPENSES_KEY, [
      { upserts: [], deletes: [], inserts: [entry as unknown as ListItem] },
    ]);
    const list = JSON.parse(row.value) as ExpenseRecord[];
    const stored = list.find((e) => e?.id === entry.id);
    if (stored && JSON.stringify(stored) !== JSON.stringify(entry)) {
      return NextResponse.json({ entry: stored, duplicate: true });
    }
    return NextResponse.json({ entry, total: list.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "write failed" },
      { status: 503 },
    );
  }
}
