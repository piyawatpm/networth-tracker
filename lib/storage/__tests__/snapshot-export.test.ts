import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllSnapshots } from "@/lib/storage/snapshot-export";

// Settings → Export used to read snapshots with one un-paginated select, which
// the API caps at 1000 rows: every backup held 1000 of ~107k points, and Import
// then deleted the full history before inserting them. Export must return ALL
// rows or fail — never a silently partial history.

type Row = { id: string; type: string; date: string; value: number };

function fakeSnapshots(rows: Row[], { failOnCall = -1, serverMaxRows = Infinity } = {}) {
  let calls = 0;
  const client = {
    from() {
      const q = { type: "", dateEq: null as string | null, dateGt: null as string | null, limit: Infinity };
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        eq: (c: string, v: string) => ((c === "type" ? (q.type = v) : (q.dateEq = v)), builder),
        gt: (_c: string, v: string) => ((q.dateGt = v), builder),
        limit: (n: number) => ((q.limit = n), builder),
        then: (resolve: (v: unknown) => void) => {
          if (calls++ === failOnCall) return resolve({ data: null, error: { message: "statement timeout" } });
          const data = rows
            .filter((r) => r.type === q.type)
            .filter((r) => q.dateEq === null || r.date === q.dateEq)
            .filter((r) => q.dateGt === null || r.date > q.dateGt)
            .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
            .slice(0, Math.min(q.limit, serverMaxRows));
          resolve({ data, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return client;
}

const series = (type: string, n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${type}-${String(i).padStart(4, "0")}`, type, date: `2026-01-01 ${String(i).padStart(5, "0")}`, value: i }));

describe("fetchAllSnapshots", () => {
  it("returns every row of every type across pages, oldest first", async () => {
    const rows = [...series("portfolio", 25), ...series("crypto", 7), ...series("networth", 10)];
    const all = await fetchAllSnapshots(fakeSnapshots(rows), { pageSize: 4 });
    expect(all.portfolio.map((r) => r.id)).toEqual(series("portfolio", 25).map((r) => r.id));
    expect(all.crypto).toHaveLength(7);
    expect(all.networth).toHaveLength(10);
  });

  it("keeps rows that share a date across a page boundary — none dropped, none doubled", async () => {
    const same = (id: string): Row => ({ id, type: "networth", date: "2026-09-14", value: 1 });
    const rows = [...series("networth", 3), same("x1"), same("x2"), same("x3"), same("x4")];
    const all = await fetchAllSnapshots(fakeSnapshots(rows), { pageSize: 4 });
    expect(all.networth.map((r) => r.id).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it("throws when a page fails instead of returning part of the history", async () => {
    const rows = series("portfolio", 25);
    await expect(fetchAllSnapshots(fakeSnapshots(rows, { failOnCall: 2 }), { pageSize: 4 })).rejects.toThrow(/statement timeout/);
  });

  it("keeps paging when the server caps a page below the size asked for", async () => {
    const rows = series("portfolio", 25);
    const all = await fetchAllSnapshots(fakeSnapshots(rows, { serverMaxRows: 3 }), { pageSize: 4 });
    expect(all.portfolio).toHaveLength(25);
  });
});
