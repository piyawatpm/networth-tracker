// =============================================================================
// List changes — the unit every writer of a list blob sends.
// =============================================================================
// Lists (income, expenses, transactions, holdings, debts, goals, recurring
// templates) live in app_data as whole JSON arrays, and four writers touch them:
// the web app, the iOS app, the Android app and the cron. Writing a whole list
// from memory erases whatever another writer added since that copy was read —
// on 2026-09-23 a web save wiped four income entries that way.
//
// So a writer never sends its list. It sends what it CHANGED (entries by id),
// and the change is applied to the latest stored list (see kv-cas.ts).

export type ListItem = Record<string, unknown>;

/** app_data keys whose value is a list of entries with string ids. Every
 *  writer sends these as changes — never as a whole list. */
export const LIST_KEYS: ReadonlySet<string> = new Set([
  "income_entries",
  "expense_entries",
  "recurring_income_templates",
  "recurring_expense_templates",
  "portfolio_holdings",
  "portfolio_transactions",
  "debt_records",
  "debt_transactions",
  "networth_goals",
  "custom_income_categories",
  "custom_expense_categories",
  "portfolio_groups",
]);

/** An edit computed from the LATEST stored version of one entry. */
export interface ListUpdate {
  id: string;
  apply: (item: ListItem) => ListItem;
}

export interface ListChange {
  /** Whole entries to add, or to replace in place when the id exists. */
  upserts: ListItem[];
  /** Ids to remove. */
  deletes: string[];
  /** Edits computed from the LATEST version of an entry (e.g. repricing a
   *  holding from its current units). Skipped when the id is gone — an update
   *  must never resurrect an entry someone deleted. */
  updates?: ListUpdate[];
  /** Entries to add only if their id isn't stored (restoring a backup):
   *  never replaces what's there. */
  inserts?: ListItem[];
}

/** Identity of an entry. Every stored list uses string ids; anything without
 *  one is addressed by its content so it is at least never duplicated. */
export function keyOf(item: unknown): string {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : JSON.stringify(item);
}

/** What the user did between two versions of a list, by id. */
export function diffById(prev: unknown[], next: unknown[]): ListChange {
  const before = new Map(prev.map((item) => [keyOf(item), JSON.stringify(item)]));
  const after = new Set(next.map(keyOf));
  const upserts = (next as ListItem[]).filter(
    (item) => before.get(keyOf(item)) !== JSON.stringify(item),
  );
  const deletes = [...before.keys()].filter((k) => !after.has(k));
  return { upserts, deletes };
}

/** Apply a change to the latest stored list: deletes drop, upserts replace in
 *  place or append, updates rewrite existing entries. Everything else — and
 *  the order — is left exactly as stored. */
export function applyChange(list: ListItem[], change: ListChange): ListItem[] {
  const deleted = new Set(change.deletes);
  const upserts = new Map(change.upserts.map((item) => [keyOf(item), item]));
  // Several updates to one id compose, in order.
  const updates = new Map<string, (item: ListItem) => ListItem>();
  for (const u of change.updates ?? []) {
    const prior = updates.get(u.id);
    updates.set(u.id, prior ? (item) => u.apply(prior(item)) : u.apply);
  }

  const result: ListItem[] = [];
  const placed = new Set<string>();
  for (const item of list) {
    const k = keyOf(item);
    if (deleted.has(k)) continue;
    const upsert = upserts.get(k);
    const update = updates.get(k);
    if (!upsert && !update) {
      result.push(item); // not named by the change: passed through verbatim
      continue;
    }
    if (placed.has(k)) continue; // a named id lands once, where it first stood
    result.push(update ? update(upsert ?? item) : upsert!);
    placed.add(k);
  }
  for (const [k, item] of upserts) {
    if (!placed.has(k) && !deleted.has(k)) {
      result.push(item);
      placed.add(k);
    }
  }
  if (change.inserts?.length) {
    const present = new Set(result.map(keyOf));
    for (const item of change.inserts) {
      const k = keyOf(item);
      if (present.has(k) || deleted.has(k)) continue;
      result.push(item);
      present.add(k);
    }
  }
  return result;
}
