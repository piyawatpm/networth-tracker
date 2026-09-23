import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadInitialData } from "@/lib/storage/boot";

// 2026-09-23: the web booted income from the `income_entries` mirror table —
// frozen since 11 Sep because iPhone rows (decimal createdAt) broke the cron's
// copy — and its next save wrote that stale list over app_data. Boot must read
// lists from app_data only, and a failed read must never look like an empty
// account (the next save would then write a one-item list over everything).

type Response = { data: unknown; error: unknown };

function fakeClient(byTable: Record<string, Response[]>) {
  const queried: string[] = [];
  const client = {
    from(table: string) {
      queried.push(table);
      const queue = byTable[table] ?? [{ data: [], error: null }];
      const response = queue.length > 1 ? queue.shift()! : queue[0];
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "range", "eq", "in"]) builder[m] = () => builder;
      builder.then = (resolve: (v: unknown) => void) => resolve(response);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queried };
}

const kvRows = [
  { key: "income_entries", value: '[{"id":"a"}]', updated_at: "2026-09-23T02:28:48.485+00:00" },
  { key: "preferred_currency", value: '"AUD"', updated_at: "2026-09-01T00:00:00+00:00" },
];

describe("loadInitialData", () => {
  it("reads lists from app_data and never from the mirror tables", async () => {
    const { client, queried } = fakeClient({ app_data: [{ data: kvRows, error: null }] });
    const { kv } = await loadInitialData(client, { retryDelayMs: 0 });
    expect(kv.get("income_entries")).toEqual({ value: '[{"id":"a"}]', updatedAt: "2026-09-23T02:28:48.485+00:00" });
    expect(new Set(queried)).toEqual(new Set(["app_data", "snapshots"]));
  });

  it("retries a failed app_data read", async () => {
    const { client } = fakeClient({
      app_data: [{ data: null, error: { message: "Gateway Timeout" } }, { data: kvRows, error: null }],
    });
    const { kv } = await loadInitialData(client, { retryDelayMs: 0 });
    expect(kv.size).toBe(2);
  });

  it("throws instead of booting an empty account when app_data can't be read", async () => {
    const { client } = fakeClient({ app_data: [{ data: null, error: { message: "Gateway Timeout" } }] });
    await expect(loadInitialData(client, { retryDelayMs: 0 })).rejects.toThrow(/Gateway Timeout/);
  });

  it("still boots when only the snapshot history fails (charts fill in later)", async () => {
    const { client } = fakeClient({
      app_data: [{ data: kvRows, error: null }],
      snapshots: [{ data: null, error: { message: "statement timeout" } }],
    });
    const { kv, snapshots } = await loadInitialData(client, { retryDelayMs: 0 });
    expect(kv.size).toBe(2);
    expect(snapshots.size).toBe(0);
  });
});
