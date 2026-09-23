// =============================================================================
// Per-key save queues for the web app.
// =============================================================================
// Collect what the user changed, send it after a short debounce (never later
// than maxWait, so a steady stream of live-price ticks can't postpone a save
// forever), keep at most one write per key in flight (so a later save can't
// overtake an earlier one), and never drop anything whose write failed: it
// goes back in the queue and is retried with backoff.
//
//   ListSaveQueue  — lists: the queued changes accumulate, in order.
//   ValueSaveQueue — single values (settings, CSV text, tags): latest wins.

import type { ListChange } from "@/lib/storage/list-change";
import type { KvRow } from "@/lib/storage/kv-cas";

interface SaveQueueOptions<P, R> {
  write: (key: string, payload: P) => Promise<R>;
  onSaved: (key: string, result: R) => void;
  onError: (key: string, error: unknown) => void;
  debounceMs?: number;
  /** Longest a queued change waits while newer changes keep arriving. */
  maxWaitMs?: number;
  /** Delay before each retry of a failed write; the last value repeats. */
  retryDelaysMs?: number[];
}

class KeyedSaveQueue<P, R> {
  private queued = new Map<string, P>();
  private queuedSince = new Map<string, number>();
  private inFlight = new Map<string, Promise<unknown>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private failures = new Map<string, number>();
  /** While a key backs off after a failure: when its retry is due. */
  private retryAt = new Map<string, number>();

  constructor(
    private readonly opts: SaveQueueOptions<P, R>,
    /** Fold a new payload into what's already queued for the key. */
    private readonly combine: (queued: P | undefined, incoming: P) => P,
    /** After a failed write: what to queue, given anything queued meanwhile. */
    private readonly restore: (failed: P, queuedMeanwhile: P | undefined) => P,
  ) {}

  protected add(key: string, payload: P): void {
    this.queued.set(key, this.combine(this.queued.get(key), payload));
    if (!this.queuedSince.has(key)) this.queuedSince.set(key, Date.now());
    const now = Date.now();
    const waited = now - this.queuedSince.get(key)!;
    const debounce = this.opts.debounceMs ?? 400;
    const maxWait = this.opts.maxWaitMs ?? 2_000;
    let delay = Math.max(0, Math.min(debounce, maxWait - waited));
    // A key backing off after a failure keeps its retry time: new changes
    // join the queued batch instead of hammering a failing server.
    const retryAt = this.retryAt.get(key);
    if (retryAt !== undefined) delay = Math.max(delay, retryAt - now);
    this.schedule(key, delay);
  }

  /** True while something for this key is waiting or being written. */
  hasPending(key: string): boolean {
    return this.queued.has(key) || this.inFlight.has(key);
  }

  /** True while anything, for any key, is not yet saved. */
  hasAnyPending(): boolean {
    return this.queued.size > 0 || this.inFlight.size > 0;
  }

  /** Write everything queued (one key, or all of them) now. Resolves once it
   *  has landed or failed; true when every write succeeded. */
  async flush(key?: string): Promise<boolean> {
    const keys = key ? [key] : [...new Set([...this.queued.keys(), ...this.inFlight.keys()])];
    const results = await Promise.all(keys.map((k) => this.flushKey(k)));
    return results.every(Boolean);
  }

  private schedule(key: string, delayMs: number): void {
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.flushKey(key);
      }, delayMs),
    );
  }

  private async flushKey(key: string): Promise<boolean> {
    while (this.inFlight.has(key)) await this.inFlight.get(key);
    if (!this.queued.has(key)) return true;
    const payload = this.queued.get(key)!;
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.queued.delete(key);
    this.queuedSince.delete(key);

    const run = (async (): Promise<{ result: R } | { error: unknown }> => {
      try {
        return { result: await this.opts.write(key, payload) };
      } catch (error) {
        this.queued.set(key, this.restore(payload, this.queued.get(key)));
        if (!this.queuedSince.has(key)) this.queuedSince.set(key, Date.now());
        return { error };
      }
    })();
    this.inFlight.set(key, run);
    let outcome: { result: R } | { error: unknown };
    try {
      outcome = await run;
    } finally {
      this.inFlight.delete(key);
    }

    // Reported once this write no longer counts as pending, so hasPending()
    // inside the callbacks means "something newer is waiting".
    if ("result" in outcome) {
      this.failures.delete(key);
      this.retryAt.delete(key);
      this.opts.onSaved(key, outcome.result);
      return true;
    }
    const attempt = this.failures.get(key) ?? 0;
    this.failures.set(key, attempt + 1);
    const delays = this.opts.retryDelaysMs ?? [2_000, 5_000, 15_000, 30_000, 60_000];
    const delay = delays[Math.min(attempt, delays.length - 1)];
    this.retryAt.set(key, Date.now() + delay);
    this.opts.onError(key, outcome.error);
    this.schedule(key, delay);
    return false;
  }
}

/** List changes: accumulate in order; a failed batch goes back in FRONT of
 *  anything queued meanwhile. */
export class ListSaveQueue extends KeyedSaveQueue<ListChange[], KvRow> {
  constructor(opts: SaveQueueOptions<ListChange[], KvRow>) {
    super(
      opts,
      (queued, incoming) => [...(queued ?? []), ...incoming],
      (failed, meanwhile) => [...failed, ...(meanwhile ?? [])],
    );
  }

  enqueue(key: string, change: ListChange): void {
    this.add(key, [change]);
  }
}

/** Single values: the latest one wins; a failed value is retried unless a
 *  newer one replaced it meanwhile. */
export class ValueSaveQueue extends KeyedSaveQueue<string, void> {
  constructor(opts: SaveQueueOptions<string, void>) {
    super(
      opts,
      (_queued, incoming) => incoming,
      (failed, meanwhile) => meanwhile ?? failed,
    );
  }

  enqueue(key: string, value: string): void {
    this.add(key, value);
  }
}
