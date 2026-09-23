import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncSnapshots } from "@/lib/supabase/tables";

// Append-only snapshot sync (Import, /debug): it must add exactly the dates the
// table lacks, in request-sized chunks, and fail loudly rather than report a
// restore that didn't happen.

function fakeTable(existingDates: string[], { failScan = false } = {}) {
  const inserts: Record<string, unknown>[][] = [];
  const client = {
    from() {
      const q = { gt: null as string | null, limit: Infinity, insert: null as Record<string, unknown>[] | null, ordered: false };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        order: () => ((q.ordered = true), b),
        gt: (_c: string, v: string) => ((q.gt = v), b),
        limit: (n: number) => ((q.limit = n), b),
        range: () => b,
        insert: (rows: Record<string, unknown>[]) => ((q.insert = rows), b),
        then: (resolve: (v: unknown) => void) => {
          if (q.insert) {
            inserts.push(q.insert);
            return resolve({ error: null });
          }
          if (failScan) return resolve({ data: null, error: { message: "statement timeout" } });
          if (!q.ordered) return resolve({ data: null, error: { message: "test: scan must be ordered" } });
          const data = existingDates.filter((d) => q.gt === null || d > q.gt).sort().slice(0, q.limit).map((date) => ({ date }));
          resolve({ data, error: null });
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { client, inserts };
}

const rows = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-01-01 ${String(from + i).padStart(5, "0")}`, value: i }));

describe("syncSnapshots", () => {
  it("inserts only the dates the table doesn't have, in chunks of at most 500", async () => {
    const existing = rows(1500).map((r) => r.date); // more than one scan page
    const { client, inserts } = fakeTable(existing);
    const added = await syncSnapshots(client, "networth", rows(2700)); // 1200 new
    expect(added).toBe(1200);
    expect(inserts.every((chunk) => chunk.length <= 500)).toBe(true);
    expect(inserts.flat().map((r) => r.date)).toEqual(rows(1200, 1500).map((r) => r.date));
  });

  it("throws when it can't read what's stored, instead of silently skipping", async () => {
    const { client, inserts } = fakeTable([], { failScan: true });
    await expect(syncSnapshots(client, "networth", rows(3))).rejects.toThrow(/statement timeout/);
    expect(inserts).toEqual([]);
  });
});
