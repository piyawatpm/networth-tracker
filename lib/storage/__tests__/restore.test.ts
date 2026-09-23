import { describe, it, expect } from "vitest";
import { restoreMissing } from "@/lib/storage/restore";
import { memoryStore } from "./memory-store";

// Settings → Import used to overwrite: every setting and CSV from the file
// replaced what was stored (importing last month's backup deleted this month's
// crypto ledger), same-id entries went back to the backup's older version, and
// the snapshot history was deleted first. Import now restores what's MISSING.

const json = (v: unknown) => JSON.stringify(v);

function setup(stored: Record<string, unknown>) {
  const store = memoryStore(Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, json(v)])));
  const appended: { type: string; rows: unknown[] }[] = [];
  const deps = {
    store,
    appendSnapshots: async (type: string, rows: Record<string, unknown>[]) => {
      appended.push({ type, rows });
      return rows.length;
    },
  };
  const read = (key: string) => JSON.parse(store.rows.get(key)!.value);
  return { store, deps, appended, read };
}

describe("restoreMissing", () => {
  it("adds list entries that aren't stored and keeps the stored version of the rest", async () => {
    const { deps, read } = setup({ income_entries: [{ id: "a", amount: 200 }] });
    const summary = await restoreMissing(
      { income_entries: [{ id: "a", amount: 100 }, { id: "lost", amount: 5 }] },
      deps,
    );
    expect(read("income_entries")).toEqual([{ id: "a", amount: 200 }, { id: "lost", amount: 5 }]);
    expect(summary.entriesAdded).toBe(1);
  });

  it("never overwrites a stored setting or ledger, and creates the missing ones", async () => {
    const { deps, read } = setup({ crypto_csv_text: "this month" });
    const summary = await restoreMissing(
      { crypto_csv_text: "last month", forecast_assumptions: { annualReturnPct: 7 } },
      deps,
    );
    expect(read("crypto_csv_text")).toBe("this month");
    expect(read("forecast_assumptions")).toEqual({ annualReturnPct: 7 });
    expect(summary.keysKept).toEqual(["crypto_csv_text"]);
    expect(summary.keysAdded).toEqual(["forecast_assumptions"]);
  });

  it("hands snapshot history to the append-only sync and ignores the cron log", async () => {
    const { store, deps, appended } = setup({});
    const summary = await restoreMissing(
      { portfolio_snapshots: [{ date: "2026-01-01", value: 1 }], cron_log: [{ date: "x" }] },
      deps,
    );
    expect(appended).toEqual([{ type: "portfolio", rows: [{ date: "2026-01-01", value: 1 }] }]);
    expect(summary.snapshotsAdded).toBe(1);
    expect(store.rows.has("cron_log")).toBe(false);
  });

  it("brings a missing recurring template back paused, so it can't back-fill months of entries", async () => {
    const { deps, read } = setup({ recurring_income_templates: [] });
    await restoreMissing(
      { recurring_income_templates: [{ id: "T", active: true, lastGeneratedDate: "2026-01-02" }] },
      deps,
    );
    expect(read("recurring_income_templates")).toEqual([{ id: "T", active: false, lastGeneratedDate: "2026-01-02" }]);
  });
});
