import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// A Supabase gateway timeout used to reach the snapshot routes as `data: null`
// with the error discarded. Every key then parsed to its empty fallback and the
// run carried on, appending a $0 net worth snapshot — 43 such rows reached
// production in Sep 2026, each one a cliff in the net worth chart. A failed or
// empty app_data read must write nothing.

type ReadResult = {
  data: { key: string; value: string }[] | null;
  error: { message: string } | null;
};

const db = vi.hoisted(() => ({
  read: { data: null, error: null } as ReadResult,
  upserts: [] as unknown[],
  inserts: [] as { table: string; rows: unknown }[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        in: async () => db.read,
        eq: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
      upsert: async (rows: unknown) => {
        db.upserts.push(...(Array.isArray(rows) ? rows : [rows]));
        return { error: null };
      },
      insert: async (rows: unknown) => {
        db.inserts.push({ table, rows });
        return { error: null };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

const writtenKeys = () => db.upserts.map((r) => (r as { key: string }).key);
const insertedTypes = () =>
  db.inserts.flatMap(({ rows }) => (Array.isArray(rows) ? rows : [rows]))
    .map((r) => (r as { type?: string }).type);

beforeEach(() => {
  db.upserts.length = 0;
  db.inserts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ rates: { USD: 1, AUD: 1.5 } }))));
});
afterEach(() => vi.unstubAllGlobals());

const failedReads: [string, ReadResult][] = [
  ["gateway timeout", { data: null, error: { message: "Gateway Timeout" } }],
  ["empty result", { data: [], error: null }],
];

describe.each(failedReads)("cron snapshot — app_data read %s", (_label, read) => {
  it("writes no snapshots and reports the run as failed", async () => {
    db.read = read;
    const { GET } = await import("../cron/snapshot/route");
    const res = await GET(new Request("http://localhost/api/cron/snapshot"));

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(db.inserts).toEqual([]);
    expect(writtenKeys().filter((k) => k !== "cron_log")).toEqual([]);
  });
});

describe.each(failedReads)("manual snapshot — app_data read %s", (_label, read) => {
  it("writes nothing, even with manual value updates", async () => {
    db.read = read;
    const { POST } = await import("../snapshot/route");
    const res = await POST(
      new NextRequest("http://localhost/api/snapshot", {
        method: "POST",
        body: JSON.stringify({ manualUpdates: { "any-id": 100 } }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(db.inserts).toEqual([]);
    expect(writtenKeys()).toEqual([]);
  });
});

describe("net worth snapshot with nothing valued", () => {
  const debtsOnly: ReadResult = { data: [{ key: "debt_records", value: "[]" }], error: null };

  it("cron skips it", async () => {
    db.read = debtsOnly;
    const { GET } = await import("../cron/snapshot/route");
    await GET(new Request("http://localhost/api/cron/snapshot"));

    expect(writtenKeys()).not.toContain("networth_snapshots");
    expect(insertedTypes()).not.toContain("networth");
  });

  it("manual snapshot skips it", async () => {
    db.read = debtsOnly;
    const { POST } = await import("../snapshot/route");
    await POST(new NextRequest("http://localhost/api/snapshot", { method: "POST", body: "{}" }));

    expect(writtenKeys()).not.toContain("networth_snapshots");
    expect(writtenKeys()).not.toContain("portfolio_snapshots");
    expect(insertedTypes()).not.toContain("networth");
    expect(insertedTypes()).not.toContain("portfolio");
  });
});
