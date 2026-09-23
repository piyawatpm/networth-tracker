import type { KvRow, KvStore } from "@/lib/storage/kv-cas";

// In-memory app_data with the same compare-and-swap contract as the Supabase
// store: a write only lands if updated_at is still what the writer read.
export function memoryStore(initial: Record<string, string> = {}) {
  let tick = 0;
  const rows = new Map<string, KvRow>(
    Object.entries(initial).map(([k, value]) => [k, { value, updatedAt: `t${tick++}` }]),
  );
  const store = {
    rows,
    writes: 0,
    failReads: false,
    /** Runs once, right before the next compare-and-swap — a device saving in the gap. */
    beforeNextCas: null as null | (() => void),
    async read(key: string) {
      if (store.failReads) throw new Error("Gateway Timeout");
      return rows.get(key) ?? null;
    },
    async compareAndSet(key: string, value: string, expected: string | null) {
      const hook = store.beforeNextCas;
      store.beforeNextCas = null;
      hook?.();
      const row = rows.get(key);
      if (!row || row.updatedAt !== expected) return null;
      const next = { value, updatedAt: `t${tick++}` };
      rows.set(key, next);
      store.writes++;
      return next;
    },
    async insert(key: string, value: string) {
      if (rows.has(key)) return null;
      const next = { value, updatedAt: `t${tick++}` };
      rows.set(key, next);
      store.writes++;
      return next;
    },
  };
  return store satisfies KvStore;
}

