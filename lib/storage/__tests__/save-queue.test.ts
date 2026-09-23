import { describe, it, expect } from "vitest";
import { ListSaveQueue, ValueSaveQueue } from "@/lib/storage/save-queue";
import type { ListChange } from "@/lib/storage/list-change";
import type { KvRow } from "@/lib/storage/kv-cas";

const add = (id: string): ListChange => ({ upserts: [{ id }], deletes: [] });
const ids = (changes: ListChange[]) => changes.flatMap((c) => c.upserts.map((u) => u.id));

function harness(failTimes = 0) {
  const writes: { key: string; changes: ListChange[] }[] = [];
  const saved: string[] = [];
  const errors: string[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  let failures = failTimes;
  const queue = new ListSaveQueue({
    debounceMs: 0,
    retryDelaysMs: [0],
    write: async (key, changes): Promise<KvRow> => {
      writes.push({ key, changes });
      if (hold) await new Promise<void>((r) => (release = r));
      if (failures-- > 0) throw new Error("Gateway Timeout");
      return { value: "[]", updatedAt: `w${writes.length}` };
    },
    onSaved: (key) => saved.push(key),
    onError: (key) => errors.push(key),
  });
  return {
    queue, writes, saved, errors,
    holdWrites: () => (hold = true),
    releaseWrite: () => { hold = false; release?.(); },
  };
}

describe("ListSaveQueue", () => {
  it("sends changes made close together as one write, in order", async () => {
    const h = harness();
    h.queue.enqueue("income_entries", add("a"));
    h.queue.enqueue("income_entries", add("b"));
    await h.queue.flush();
    expect(h.writes).toHaveLength(1);
    expect(ids(h.writes[0].changes)).toEqual(["a", "b"]);
    expect(h.saved).toEqual(["income_entries"]);
  });

  it("never runs two writes for the same list at once", async () => {
    const h = harness();
    h.holdWrites();
    h.queue.enqueue("income_entries", add("a"));
    const first = h.queue.flush();
    await Promise.resolve();
    h.queue.enqueue("income_entries", add("b"));
    const second = h.queue.flush();
    await Promise.resolve();
    expect(h.writes).toHaveLength(1); // b waits for a's write to finish
    h.releaseWrite();
    await Promise.all([first, second]);
    expect(h.writes.map((w) => ids(w.changes))).toEqual([["a"], ["b"]]);
  });

  it("keeps a change whose write failed and saves it on retry", async () => {
    const h = harness(1);
    h.queue.enqueue("income_entries", add("a"));
    await h.queue.flush();
    expect(h.errors).toEqual(["income_entries"]);
    expect(h.queue.hasPending("income_entries")).toBe(true);
    await h.queue.flush();
    expect(ids(h.writes.at(-1)!.changes)).toEqual(["a"]);
    expect(h.queue.hasPending("income_entries")).toBe(false);
  });

  it("onSaved sees nothing pending when no newer edit is waiting — safe to show the merged list", async () => {
    const seen: boolean[] = [];
    const queue: ListSaveQueue = new ListSaveQueue({
      debounceMs: 0,
      write: async () => ({ value: "[]", updatedAt: "w1" }),
      onSaved: (key) => seen.push(queue.hasPending(key)),
      onError: () => {},
    });
    queue.enqueue("income_entries", add("a"));
    await queue.flush();
    expect(seen).toEqual([false]);
  });

  it("reports a list as pending while its change is queued or in flight", async () => {
    const h = harness();
    expect(h.queue.hasPending("income_entries")).toBe(false);
    h.holdWrites();
    h.queue.enqueue("income_entries", add("a"));
    expect(h.queue.hasPending("income_entries")).toBe(true);
    const done = h.queue.flush();
    await Promise.resolve();
    expect(h.queue.hasPending("income_entries")).toBe(true);
    h.releaseWrite();
    await done;
    expect(h.queue.hasPending("income_entries")).toBe(false);
  });
});

describe("ListSaveQueue — steady streams and unsaved work", () => {
  it("flushes within maxWait even while changes keep arriving (live price ticks)", async () => {
    const writes: number[] = [];
    const queue = new ListSaveQueue({
      debounceMs: 50,
      maxWaitMs: 120,
      write: async () => (writes.push(Date.now()), { value: "[]", updatedAt: "w" }),
      onSaved: () => {},
      onError: () => {},
    });
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      queue.enqueue("portfolio_holdings", add(`tick${i}`));
      await new Promise((r) => setTimeout(r, 30)); // faster than the debounce
    }
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[0] - start).toBeLessThan(250);
    await queue.flush();
  });

  it("reports unsaved work across all lists", async () => {
    const h = harness();
    expect(h.queue.hasAnyPending()).toBe(false);
    h.queue.enqueue("networth_goals", add("g"));
    expect(h.queue.hasAnyPending()).toBe(true);
    await h.queue.flush();
    expect(h.queue.hasAnyPending()).toBe(false);
  });
});

describe("ValueSaveQueue — settings, CSV text, tags", () => {
  it("writes the latest value once after the debounce", async () => {
    const writes: [string, string][] = [];
    const queue = new ValueSaveQueue({ debounceMs: 0, write: async (k, v) => void writes.push([k, v]), onSaved: () => {}, onError: () => {} });
    queue.enqueue("preferred_currency", '"THB"');
    queue.enqueue("preferred_currency", '"USD"');
    await queue.flush();
    expect(writes).toEqual([["preferred_currency", '"USD"']]);
  });

  it("keeps a failed value and retries it — unless a newer value replaced it", async () => {
    let fail = true;
    const writes: string[] = [];
    const errors: string[] = [];
    const queue = new ValueSaveQueue({
      debounceMs: 0,
      retryDelaysMs: [60_000],
      write: async (_k, v) => {
        writes.push(v);
        if (fail) throw new Error("Gateway Timeout");
      },
      onSaved: () => {},
      onError: (k) => errors.push(k),
    });
    queue.enqueue("crypto_csv_text", '"v1"');
    await queue.flush();
    expect(errors).toEqual(["crypto_csv_text"]);
    expect(queue.hasAnyPending()).toBe(true); // v1 not dropped
    fail = false;
    queue.enqueue("crypto_csv_text", '"v2"'); // newer value supersedes the failed one
    await queue.flush();
    expect(writes).toEqual(['"v1"', '"v2"']);
    expect(queue.hasAnyPending()).toBe(false);
  });
});

describe("backoff after a failure", () => {
  it("new changes wait for the scheduled retry instead of hammering a failing server", async () => {
    const writes: number[] = [];
    let fail = true;
    const queue = new ListSaveQueue({
      debounceMs: 0,
      retryDelaysMs: [300],
      write: async () => {
        writes.push(Date.now());
        if (fail) throw new Error("Gateway Timeout");
        return { value: "[]", updatedAt: "w" };
      },
      onSaved: () => {},
      onError: () => {},
    });
    queue.enqueue("portfolio_holdings", add("a"));
    await new Promise((r) => setTimeout(r, 20)); // first attempt fails → retry in 300 ms
    const failedAt = writes[0];
    fail = false;
    for (let i = 0; i < 5; i++) {
      queue.enqueue("portfolio_holdings", add(`tick${i}`));
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(writes).toHaveLength(1); // nothing sent during the backoff
    await new Promise((r) => setTimeout(r, 350));
    expect(writes).toHaveLength(2);
    expect(writes[1] - failedAt).toBeGreaterThanOrEqual(280);
  });
});
