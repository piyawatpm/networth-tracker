import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseKvStore } from "@/lib/storage/kv-cas";

// Records the query-builder chain one request builds, and resolves the way
// supabase-js does ({ data, error }). The point under test is WHICH filters the
// store sends — without the updated_at filter a "compare-and-swap" is a blind
// overwrite again.
function fakeClient(response: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "update", "insert", "maybeSingle"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(response);
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("supabaseKvStore", () => {
  it("compareAndSet only matches the row version it was given", async () => {
    const { client, calls } = fakeClient({ data: [{ value: "[]", updated_at: "new" }], error: null });
    const row = await supabaseKvStore(client).compareAndSet("income_entries", "[]", "2026-09-23T02:28:48.485+00:00");
    expect(calls).toContainEqual(["eq", "key", "income_entries"]);
    expect(calls).toContainEqual(["eq", "updated_at", "2026-09-23T02:28:48.485+00:00"]);
    expect(row).toEqual({ value: "[]", updatedAt: "new" });
  });

  it("compareAndSet on a row with no updated_at matches IS NULL", async () => {
    const { client, calls } = fakeClient({ data: [{ value: "[]", updated_at: "new" }], error: null });
    await supabaseKvStore(client).compareAndSet("k", "[]", null);
    expect(calls).toContainEqual(["is", "updated_at", null]);
  });

  it("compareAndSet reports a lost race as null, not success", async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await supabaseKvStore(client).compareAndSet("k", "[]", "old")).toBeNull();
  });

  it("read throws on a failed request instead of reporting an empty key", async () => {
    const { client } = fakeClient({ data: null, error: { message: "Gateway Timeout" } });
    await expect(supabaseKvStore(client).read("income_entries")).rejects.toThrow(/Gateway Timeout/);
  });

  it("insert reports an existing key (unique violation) as null", async () => {
    const { client } = fakeClient({ data: null, error: { code: "23505", message: "duplicate key" } });
    expect(await supabaseKvStore(client).insert("k", "[]")).toBeNull();
  });

  it("stamps a write later than the version it replaces, even when this clock is behind", async () => {
    const { client, calls } = fakeClient({ data: [{ value: "[]", updated_at: "x" }], error: null });
    const ahead = new Date(Date.now() + 3_600_000).toISOString(); // written by a device an hour ahead
    await supabaseKvStore(client).compareAndSet("k", "[]", ahead);
    const payload = calls.find(([m]) => m === "update")![1] as { updated_at: string };
    expect(Date.parse(payload.updated_at)).toBeGreaterThan(Date.parse(ahead));
  });
});
