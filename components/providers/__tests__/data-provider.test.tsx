// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode, useEffect } from "react";
import { render, act, waitFor, cleanup } from "@testing-library/react";

// The provider + useCloudStorage are where every web save starts. These tests
// render them for real (React dev mode, so StrictMode double-invokes updaters)
// against an in-memory app_data with Supabase's compare-and-swap semantics.

type Row = { value: string; updated_at: string };

const db = vi.hoisted(() => ({
  rows: new Map<string, { value: string; updated_at: string }>(),
  tick: 0,
  upserts: [] as string[],
  casWrites: [] as string[],
}));

vi.mock("@/lib/supabase/client", () => {
  const stamp = () => `2026-09-23T00:00:${String(db.tick++).padStart(2, "0")}.000+00:00`;
  function query(table: string) {
    const q = { op: "select", filters: [] as [string, string, unknown][], payload: null as unknown, single: false };
    const run = () => {
      if (table !== "app_data") return { data: [], error: null };
      const eqKey = q.filters.find(([op, c]) => op === "eq" && c === "key")?.[2] as string | undefined;
      if (q.op === "select") {
        const rows = [...db.rows.entries()]
          .filter(([k]) => (eqKey ? k === eqKey : true))
          .map(([key, r]) => ({ key, value: r.value, updated_at: r.updated_at }));
        return q.single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
      }
      if (q.op === "update") {
        const row = db.rows.get(eqKey!);
        const ts = q.filters.find(([, c]) => c === "updated_at");
        if (!row || (ts && ts[2] !== row.updated_at)) return { data: [], error: null };
        const next = { value: (q.payload as Row).value, updated_at: stamp() };
        db.rows.set(eqKey!, next);
        db.casWrites.push(eqKey!);
        return { data: [next], error: null };
      }
      const list = (Array.isArray(q.payload) ? q.payload : [q.payload]) as { key: string; value: string }[];
      if (q.op === "insert" && list.some((r) => db.rows.has(r.key))) return { data: null, error: { code: "23505", message: "dup" } };
      for (const r of list) {
        db.rows.set(r.key, { value: r.value, updated_at: stamp() });
        if (q.op === "upsert") db.upserts.push(r.key);
        else db.casWrites.push(r.key);
      }
      return { data: list.map((r) => db.rows.get(r.key)), error: null };
    };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "range", "gt", "not"]) b[m] = () => b;
    Object.assign(b, {
      eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), b),
      is: (c: string, v: unknown) => (q.filters.push(["is", c, v]), b),
      maybeSingle: () => ((q.single = true), b),
      single: () => ((q.single = true), b),
      update: (p: unknown) => ((q.op = "update"), (q.payload = p), b),
      insert: (p: unknown) => ((q.op = "insert"), (q.payload = p), b),
      upsert: (p: unknown) => ((q.op = "upsert"), (q.payload = p), b),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    });
    return b;
  }
  const client = { from: query };
  return { createClient: () => client };
});

import { DataProvider, useCloudStorage } from "@/components/providers/data-provider";
import { useRecurringEntries } from "@/hooks/use-recurring-entries";
import { recurringEntryId } from "@/lib/utils/entry-helpers";

type Goal = { id: string; name?: string };
type Holding = { id: string; units: number; currentValue: number };
type Api = {
  goals: Goal[];
  setGoals: (v: Goal[] | ((p: Goal[]) => Goal[])) => void;
  currency: string;
  setCurrency: (v: string | ((p: string) => string)) => void;
  holdings: Holding[];
  patchHoldings: (updates: { id: string; apply: (h: Record<string, unknown>) => Record<string, unknown> }[]) => void;
};

let api: (Api & { setLogos: (v: (p: Record<string, string>) => Record<string, string>) => void }) | null = null;
const setterIdentities = new Set<unknown>();
let renders = 0;

function Probe() {
  renders++;
  const [goals, setGoals] = useCloudStorage<Goal[]>("networth_goals", []);
  const [currency, setCurrency] = useCloudStorage<string>("preferred_currency", "AUD");
  const [holdings, , patchHoldings] = useCloudStorage<Holding[]>("portfolio_holdings", []);
  const [, setLogos] = useCloudStorage<Record<string, string>>("portfolio_stock_logos", {});
  useEffect(() => {
    setterIdentities.add(setCurrency);
  }, [setCurrency]);
  api = { goals, setGoals, currency, setCurrency, holdings, patchHoldings, setLogos } as typeof api;
  return null;
}

const stored = (key: string) => JSON.parse(db.rows.get(key)!.value);

async function mount(strict = false) {
  const tree = (
    <DataProvider>
      <Probe />
    </DataProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  await waitFor(() => expect(api).not.toBeNull());
}

beforeEach(() => {
  cleanup();
  api = null;
  setterIdentities.clear();
  db.rows.clear();
  db.upserts.length = 0;
  db.casWrites.length = 0;
  db.rows.set("networth_goals", { value: JSON.stringify([{ id: "g1" }]), updated_at: "seed-goals" });
  db.rows.set("preferred_currency", { value: JSON.stringify("AUD"), updated_at: "seed-cur" });
  db.rows.set("portfolio_holdings", { value: JSON.stringify([{ id: "A", units: 2, currentValue: 5 }]), updated_at: "seed-h" });
});

describe("useCloudStorage", () => {
  it("keeps each setter's identity across saves, so effects that depend on it don't re-run", async () => {
    await mount();
    await act(async () => api!.setCurrency("THB"));
    await waitFor(() => expect(db.upserts).toContain("preferred_currency"));
    await act(async () => api!.setGoals((p) => [...p, { id: "g2" }]));
    await waitFor(() => expect(db.casWrites).toContain("networth_goals"));
    expect(setterIdentities.size).toBe(1);
  });

  it("doesn't write a value that didn't change", async () => {
    await mount();
    await act(async () => api!.setCurrency((prev) => prev));
    await new Promise((r) => setTimeout(r, 450));
    expect(db.upserts).toEqual([]);
  });

  it("an update that returns an equal copy neither re-renders nor saves (no effect loops)", async () => {
    await mount();
    const before = renders;
    await act(async () => api!.setLogos((prev) => ({ ...prev })));
    await new Promise((r) => setTimeout(r, 450));
    expect(renders).toBe(before);
    expect(db.upserts).toEqual([]);
  });

  it("saves an updater's result exactly once under StrictMode (no duplicate ids)", async () => {
    await mount(true);
    await act(async () => api!.setGoals((prev) => [...prev, { id: crypto.randomUUID(), name: "new" }]));
    await waitFor(() => expect(db.casWrites).toContain("networth_goals"));
    await new Promise((r) => setTimeout(r, 450));
    expect(stored("networth_goals").filter((g: Goal) => g.name === "new")).toHaveLength(1);
  });

  it("patch with { save: false } only updates the screen (live price ticks aren't saved)", async () => {
    await mount();
    await act(async () =>
      (api!.patchHoldings as unknown as (u: unknown[], o: { save: boolean }) => void)(
        [{ id: "A", apply: (h: Record<string, unknown>) => ({ ...h, currentValue: 99 }) }],
        { save: false },
      ),
    );
    expect(api!.holdings[0].currentValue).toBe(99);
    await new Promise((r) => setTimeout(r, 450));
    expect(db.casWrites).toEqual([]);
    expect(stored("portfolio_holdings")[0].currentValue).toBe(5);
  });

  it("patch computes a field from the LATEST stored entry, keeping another device's edit", async () => {
    await mount();
    // The phone logs a buy: units 2 → 3, after this page loaded.
    db.rows.set("portfolio_holdings", { value: JSON.stringify([{ id: "A", units: 3, currentValue: 5 }]), updated_at: "phone" });
    await act(async () => api!.patchHoldings([{ id: "A", apply: (h) => ({ ...h, currentValue: Number(h.units) * 10 }) }]));
    await waitFor(() => expect(db.casWrites).toContain("portfolio_holdings"));
    expect(stored("portfolio_holdings")).toEqual([{ id: "A", units: 3, currentValue: 30 }]);
  });
});

describe("useRecurringEntries (web generator)", () => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  const daysBefore = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  type Tpl = { id: string; frequency: "weekly"; startDate: string; lastGeneratedDate?: string; active: boolean; amount: number };
  type Entry = { id: string; date: string; recurringId?: string };
  let addTemplate: ((t: Tpl) => void) | null = null;
  let updateTemplate: ((t: Tpl) => void) | null = null;
  let toggleTemplate: ((id: string) => void) | null = null;

  function IncomeProbe() {
    const [, setEntries] = useCloudStorage<Entry[]>("income_entries", []);
    ({ addTemplate, updateTemplate, toggleTemplate } = useRecurringEntries<Tpl, Entry>(setEntries, {
      storageKey: "recurring_income_templates",
      createEntry: (t, date) => ({ id: recurringEntryId(t.id, date), date, recurringId: t.id }),
    }));
    return null;
  }

  beforeEach(() => {
    addTemplate = null;
    db.rows.set("income_entries", { value: JSON.stringify([{ id: "old", date: daysBefore(30) }]), updated_at: "seed-inc" });
    db.rows.set("recurring_income_templates", {
      value: JSON.stringify([{ id: "T", frequency: "weekly", startDate: daysBefore(14), lastGeneratedDate: daysBefore(7), active: true, amount: 100 }]),
      updated_at: "seed-tpl",
    });
  });

  it("opening the page generates nothing — the cron owns recurring entries (a stale tab can't revert or re-add)", async () => {
    render(<DataProvider><IncomeProbe /></DataProvider>);
    await waitFor(() => expect(addTemplate).not.toBeNull());
    await new Promise((r) => setTimeout(r, 600));
    expect(db.casWrites).toEqual([]);
  });

  it("a NEW template generates its past occurrences at once, and records how far it got", async () => {
    render(<DataProvider><IncomeProbe /></DataProvider>);
    await waitFor(() => expect(addTemplate).not.toBeNull());
    await act(async () => addTemplate!({ id: "N", frequency: "weekly", startDate: daysBefore(14), active: true, amount: 5 }));
    await waitFor(() => expect(db.casWrites).toEqual(expect.arrayContaining(["income_entries", "recurring_income_templates"])), { timeout: 3000 });
    const ids = stored("income_entries").map((e: Entry) => e.id);
    expect(ids).toEqual(["old", recurringEntryId("N", daysBefore(14)), recurringEntryId("N", daysBefore(7)), recurringEntryId("N", today)]);
    expect(stored("recurring_income_templates").find((t: Tpl) => t.id === "N").lastGeneratedDate).toBe(today);
  });

  it("editing or pausing a template never moves its lastGeneratedDate backwards", async () => {
    render(<DataProvider><IncomeProbe /></DataProvider>);
    await waitFor(() => expect(updateTemplate).not.toBeNull());
    // The cron generated today's occurrence after this page loaded its copy.
    const local = stored("recurring_income_templates")[0] as Tpl;
    db.rows.set("recurring_income_templates", { value: JSON.stringify([{ ...local, lastGeneratedDate: today }]), updated_at: "cron" });
    await act(async () => updateTemplate!({ ...local, amount: 999 }));
    await waitFor(() => expect(db.casWrites).toContain("recurring_income_templates"), { timeout: 3000 });
    expect(stored("recurring_income_templates")[0]).toMatchObject({ amount: 999, lastGeneratedDate: today });
    await act(async () => toggleTemplate!("T"));
    await waitFor(() => expect(stored("recurring_income_templates")[0].active).toBe(false), { timeout: 3000 });
    expect(stored("recurring_income_templates")[0].lastGeneratedDate).toBe(today);
  });
});
