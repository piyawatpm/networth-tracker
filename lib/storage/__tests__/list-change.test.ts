import { describe, it, expect } from "vitest";
import { diffById, applyChange } from "@/lib/storage/list-change";

// On 2026-09-23 a web tab saved its whole (stale) income list over the stored
// one and erased four entries another device had added. A save must carry only
// what the user changed, and applying it must leave every other entry alone.

const a = { id: "a", amount: 1 };
const b = { id: "b", amount: 2 };
const c = { id: "c", amount: 3 };

describe("diffById — what the user actually changed", () => {
  it("an added entry becomes an upsert, nothing is deleted", () => {
    expect(diffById([a, b], [a, b, c])).toEqual({ upserts: [c], deletes: [] });
  });

  it("an edited entry becomes an upsert of the new version", () => {
    const b2 = { id: "b", amount: 20 };
    expect(diffById([a, b], [a, b2])).toEqual({ upserts: [b2], deletes: [] });
  });

  it("a removed entry becomes a delete of its id", () => {
    expect(diffById([a, b], [a])).toEqual({ upserts: [], deletes: ["b"] });
  });

  it("an untouched list is an empty change", () => {
    expect(diffById([a, b], [{ id: "a", amount: 1 }, { id: "b", amount: 2 }])).toEqual({ upserts: [], deletes: [] });
  });
});

describe("applyChange — the change lands on the LATEST list", () => {
  it("keeps entries another device added (the 2026-09-23 loss)", () => {
    const stale = [a, b];
    const mine = [a, b, c]; // user adds c in a tab that never saw d
    const d = { id: "d", amount: 4 }; // added meanwhile on the phone
    const latest = [a, b, d];
    expect(applyChange(latest, diffById(stale, mine))).toEqual([a, b, d, c]);
  });

  it("replaces an edited entry in place", () => {
    const b2 = { id: "b", amount: 20 };
    expect(applyChange([a, b, c], { upserts: [b2], deletes: [] })).toEqual([a, b2, c]);
  });

  it("removes a deleted entry and nothing else", () => {
    expect(applyChange([a, b, c], { upserts: [], deletes: ["b"] })).toEqual([a, c]);
  });

  it("never alters entries the change doesn't name — even malformed duplicates", () => {
    const dupA = { id: "a", amount: 99 };
    expect(applyChange([a, dupA, b], { upserts: [c], deletes: [] })).toEqual([a, dupA, b, c]);
  });

  it("is idempotent — re-applying the same change changes nothing", () => {
    const change = { upserts: [c], deletes: ["a"] };
    const once = applyChange([a, b], change);
    expect(applyChange(once, change)).toEqual(once);
  });

  it("an update function sees the latest version and skips ids that are gone", () => {
    const change = {
      upserts: [],
      deletes: [],
      updates: [
        { id: "b", apply: (x: Record<string, unknown>) => ({ ...x, amount: (x.amount as number) * 10 }) },
        { id: "zzz", apply: () => ({ id: "zzz", resurrected: true }) },
      ],
    };
    expect(applyChange([a, { id: "b", amount: 5 }], change)).toEqual([a, { id: "b", amount: 50 }]);
  });
});

describe("applyChange — inserts (restore what's missing)", () => {
  it("adds entries whose id isn't stored and never replaces one that is", () => {
    const newerB = { id: "b", amount: 20 };
    const backupB = { id: "b", amount: 2 };
    expect(applyChange([a, newerB], { upserts: [], deletes: [], inserts: [backupB, c] })).toEqual([a, newerB, c]);
  });
});
