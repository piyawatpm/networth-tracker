import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { quickExpenseId } from "@/lib/utils/entry-helpers";

// The cron reads every list at the start of a run, spends seconds fetching
// prices, then used to write whole lists back — erasing anything saved in
// between (a holding deleted mid-run came back; an entry added mid-run
// vanished). It also mirrored lists into relational tables that the web then
// booted from while they were stale (the 2026-09-23 income loss). Lists must be
// written as changes against the latest copy, and the mirror tables left alone.

type Row = { value: string; updated_at: string };

const db = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  tick: 0,
  tables: new Set<string>(),
  /** Runs once, in the middle of the run (during the first price fetch). */
  midRun: null as null | (() => void),
  /** Every app_data read fails (a gateway timeout). */
  failReads: false,
  /** Writes to this key fail. */
  failWritesFor: null as string | null,
  /** Reads of this key fail. */
  failReadsFor: null as string | null,
  /** Runs once, right before the next compare-and-swap update. */
  beforeUpdate: null as null | (() => void),
}));

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_SECRET_KEY = "test";
  process.env.QUICK_ADD_TOKEN = "quick-token";
});

vi.mock("@supabase/supabase-js", () => {
  const stamp = () => `2026-09-23T00:00:${String(db.tick++).padStart(2, "0")}.000+00:00`;
  function query(table: string) {
    db.tables.add(table);
    const q = { op: "select", filters: [] as [string, string, unknown][], payload: null as unknown, single: false };
    const run = () => {
      if (table !== "app_data") return { data: [], error: null }; // snapshots etc. accept anything
      const eqKey = q.filters.find(([op, c]) => op === "eq" && c === "key")?.[2] as string | undefined;
      if (q.op === "select") {
        if (db.failReads || (eqKey && eqKey === db.failReadsFor)) return { data: null, error: { message: "Gateway Timeout" } };
        const inKeys = q.filters.find(([op]) => op === "in")?.[2] as string[] | undefined;
        const rows = [...db.rows.entries()]
          .filter(([k]) => (inKeys ? inKeys.includes(k) : eqKey ? k === eqKey : true))
          .map(([key, r]) => ({ key, value: r.value, updated_at: r.updated_at }));
        return q.single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
      }
      if (q.op === "update") {
        const hook = db.beforeUpdate;
        db.beforeUpdate = null;
        hook?.();
        if (eqKey === db.failWritesFor) return { data: null, error: { message: "Gateway Timeout" } };
        const row = db.rows.get(eqKey!);
        const ts = q.filters.find(([op, c]) => c === "updated_at" && (op === "eq" || op === "is"));
        if (!row || (ts && ts[2] !== row.updated_at)) return { data: [], error: null };
        const next = { value: (q.payload as Row).value, updated_at: stamp() };
        db.rows.set(eqKey!, next);
        return { data: [next], error: null };
      }
      if (q.op === "insert" || q.op === "upsert") {
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]) as { key: string; value: string }[];
        if (q.op === "insert" && list.some((r) => db.rows.has(r.key))) return { data: null, error: { code: "23505", message: "duplicate" } };
        const written = list.map((r) => {
          const next = { value: r.value, updated_at: stamp() };
          db.rows.set(r.key, next);
          return next;
        });
        return { data: written, error: null };
      }
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), b),
      is: (c: string, v: unknown) => (q.filters.push(["is", c, v]), b),
      in: (c: string, v: unknown) => (q.filters.push(["in", c, v]), b),
      order: () => b,
      limit: () => b,
      single: () => ((q.single = true), b),
      maybeSingle: () => ((q.single = true), b),
      update: (p: unknown) => ((q.op = "update"), (q.payload = p), b),
      insert: (p: unknown) => ((q.op = "insert"), (q.payload = p), b),
      upsert: (p: unknown) => ((q.op = "upsert"), (q.payload = p), b),
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        try { resolve(run()); } catch (e) { reject(e); }
      },
    };
    return b;
  }
  return { createClient: () => ({ from: query }) };
});

vi.mock("@/lib/utils/stock-prices", () => ({
  fetchExtendedStockQuote: async () => {
    const hook = db.midRun;
    db.midRun = null;
    hook?.();
    return { price: 10, currency: "USD", extended: false, marketState: "REGULAR" };
  },
}));

vi.mock("@/lib/utils/hostplus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/hostplus")>()),
  fetchHostplusUnitPrices: async () => ({ options: [], dates: [] }),
}));

const sydneyToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const daysBefore = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const set = (key: string, value: unknown) => db.rows.set(key, { value: JSON.stringify(value), updated_at: `seed-${key}` });
const get = (key: string) => JSON.parse(db.rows.get(key)!.value);

beforeEach(() => {
  db.rows.clear();
  db.tables.clear();
  db.tick = 0;
  db.midRun = null;
  db.failReads = false;
  db.failWritesFor = null;
  db.failReadsFor = null;
  db.beforeUpdate = null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ rates: { USD: 1, AUD: 1.5 } }))));
  const today = sydneyToday();
  set("portfolio_holdings", [
    { id: "A", ticker: "AAA", country: "US", units: 2, currentValue: 5, currency: "USD", type: "stock", accountType: "normal" },
    { id: "B", ticker: "BBB", country: "US", units: 1, currentValue: 3, currency: "USD", type: "stock", accountType: "normal" },
  ]);
  set("income_entries", [{ id: "E1", date: daysBefore(today, 30), amount: 1 }]);
  set("recurring_income_templates", [
    { id: "T", frequency: "weekly", startDate: daysBefore(today, 14), lastGeneratedDate: daysBefore(today, 7), active: true, amount: 100, type: "salary" },
  ]);
});
afterEach(() => vi.unstubAllGlobals());

async function runCron() {
  const { GET } = await import("@/app/api/cron/snapshot/route");
  return GET(new NextRequest("http://localhost/api/cron/snapshot"));
}

describe("cron list writes", () => {
  it("keeps a holding deleted mid-run deleted, and reprices from the latest copy", async () => {
    db.midRun = () => {
      const [a] = get("portfolio_holdings");
      db.rows.set("portfolio_holdings", { value: JSON.stringify([{ ...a, units: 3 }]), updated_at: "user-edit" });
    };
    await runCron();
    const holdings = get("portfolio_holdings");
    expect(holdings.map((h: { id: string }) => h.id)).toEqual(["A"]); // B stays deleted
    expect(holdings[0].units).toBe(3); // the user's edit survives
    expect(holdings[0].currentValue).toBe(30); // priced from the latest units: 3 × 10
  });

  it("keeps an entry saved mid-run next to the new recurring entry", async () => {
    db.midRun = () => {
      db.rows.set("income_entries", { value: JSON.stringify([...get("income_entries"), { id: "PHONE", amount: 7 }]), updated_at: "phone" });
    };
    await runCron();
    const ids = get("income_entries").map((e: { id: string; recurringId?: string }) => e.recurringId ?? e.id);
    expect(ids).toEqual(["E1", "PHONE", "T"]);
    expect(get("recurring_income_templates")[0].lastGeneratedDate).toBe(sydneyToday());
  });

  it("never writes the relational mirror tables", async () => {
    await runCron();
    expect([...db.tables].sort()).toEqual(["app_data", "snapshots"]);
  });

  it("doesn't apply a price to a holding whose ticker changed mid-run", async () => {
    db.midRun = () => {
      // e.g. a cash position mis-tickered as BILL is corrected to plain cash.
      const list = get("portfolio_holdings").map((h: { id: string }) =>
        h.id === "B" ? { ...h, ticker: "", currentValue: 150 } : h,
      );
      db.rows.set("portfolio_holdings", { value: JSON.stringify(list), updated_at: "user-fix" });
    };
    await runCron();
    expect(get("portfolio_holdings").find((h: { id: string }) => h.id === "B").currentValue).toBe(150);
  });

  it("an occurrence a web tab saved mid-run isn't duplicated (same id for the same template + date)", async () => {
    const today = sydneyToday();
    db.midRun = () => {
      // A stale web tab generated the same occurrence and saved it meanwhile.
      // …and the user already corrected its amount on the phone.
      const webEntry = { id: `rec-T-${today}`, recurringId: "T", date: today, amount: 4650, isRecurring: true };
      db.rows.set("income_entries", { value: JSON.stringify([...get("income_entries"), webEntry]), updated_at: "web" });
    };
    await runCron();
    const forToday = get("income_entries").filter((e: { recurringId?: string; date: string }) => e.recurringId === "T" && e.date === today);
    expect(forToday).toHaveLength(1);
    expect(forToday[0].amount).toBe(4650); // a regenerated occurrence must not revert the edit
  });

  it("leaves the template alone when its entries couldn't be saved, so the next run retries", async () => {
    db.failWritesFor = "income_entries";
    await runCron();
    expect(get("recurring_income_templates")[0].lastGeneratedDate).toBe(daysBefore(sydneyToday(), 7));
  });
});

describe("manual snapshot (/api/snapshot) holdings write", () => {
  async function runManual(manualUpdates: Record<string, number>) {
    const { POST } = await import("@/app/api/snapshot/route");
    return POST(new NextRequest("http://localhost/api/snapshot", { method: "POST", body: JSON.stringify({ manualUpdates }) }));
  }

  beforeEach(() => {
    set("portfolio_holdings", [
      { id: "A", ticker: "AAA", country: "US", units: 2, currentValue: 5, currency: "USD", type: "stock", accountType: "normal" },
      { id: "B", ticker: "BBB", country: "US", units: 1, currentValue: 3, currency: "USD", type: "stock", accountType: "normal" },
      { id: "C", name: "House", units: 0, currentValue: 100, currency: "AUD", type: "property", accountType: "normal" },
    ]);
  });

  it("applies manual values and prices to the latest holdings — a mid-run delete stays deleted", async () => {
    db.midRun = () => {
      const kept = get("portfolio_holdings").filter((h: { id: string }) => h.id !== "B");
      db.rows.set("portfolio_holdings", { value: JSON.stringify(kept), updated_at: "user-delete" });
    };
    await runManual({ C: 999 });
    const holdings = get("portfolio_holdings");
    expect(holdings.map((h: { id: string }) => h.id)).toEqual(["A", "C"]);
    expect(holdings.find((h: { id: string }) => h.id === "A").currentValue).toBe(20);
    expect(holdings.find((h: { id: string }) => h.id === "C").currentValue).toBe(999);
  });

  it("never writes the relational mirror tables", async () => {
    await runManual({ C: 999 });
    expect([...db.tables].sort()).toEqual(["app_data", "snapshots"]);
  });
});

describe("legacy quick-expense (/api/quick-expense)", () => {
  async function post(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/quick-expense/route");
    return POST(new NextRequest("http://localhost/api/quick-expense", {
      method: "POST",
      headers: { authorization: "Bearer quick-token" },
      body: JSON.stringify(body),
    }));
  }
  const expenseIds = () => get("expense_entries").map((e: { id: string }) => e.id);

  beforeEach(() => set("expense_entries", [{ id: "X1", amount: 5 }, { id: "X2", amount: 6 }]));

  it("never overwrites the expense list when it can't be read", async () => {
    db.failReads = true;
    const res = await post({ amount: 12.5, clientId: "c1", date: "2026-09-23" });
    expect(res.status).toBeGreaterThanOrEqual(500);
    db.failReads = false;
    expect(expenseIds()).toEqual(["X1", "X2"]);
  });

  it("adds the expense next to every stored one, once per clientId", async () => {
    await post({ amount: 12.5, clientId: "c1", date: "2026-09-23" });
    await post({ amount: 12.5, clientId: "c1", date: "2026-09-23" }); // queued retry
    const list = get("expense_entries");
    expect(list.slice(0, 2).map((e: { id: string }) => e.id)).toEqual(["X1", "X2"]);
    expect(list.filter((e: { clientId?: string }) => e.clientId === "c1")).toHaveLength(1);
  });

  it("two racing retries of one tap still store it once", async () => {
    db.beforeUpdate = () => {
      // The other retry of the same tap landed between our read and our write.
      const other = { id: quickExpenseId("c9"), clientId: "c9", amount: 12.5, date: "2026-09-23", currency: "AUD" };
      db.rows.set("expense_entries", { value: JSON.stringify([...get("expense_entries"), other]), updated_at: "other-retry" });
    };
    await post({ amount: 12.5, clientId: "c9", date: "2026-09-23", currency: "AUD" });
    expect(get("expense_entries").filter((e: { clientId?: string }) => e.clientId === "c9")).toHaveLength(1);
  });

  it("doesn't save an expense in the wrong currency when the default currency can't be read", async () => {
    db.failReadsFor = "preferred_currency";
    const res = await post({ amount: 12.5, clientId: "c2", date: "2026-09-23" });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(expenseIds()).toEqual(["X1", "X2"]);
  });

  it("a replayed tap doesn't revert an edit made since (the web edit dropped clientId)", async () => {
    const edited = { id: quickExpenseId("c7"), amount: 99, date: "2026-09-23", currency: "AUD", description: "corrected" };
    set("expense_entries", [{ id: "X1", amount: 5 }, edited]);
    await post({ amount: 12.5, clientId: "c7", date: "2026-09-23", currency: "AUD" });
    expect(get("expense_entries").find((e: { id: string }) => e.id === quickExpenseId("c7"))).toEqual(edited);
  });
});
