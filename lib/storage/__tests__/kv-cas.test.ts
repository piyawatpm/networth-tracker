import { describe, it, expect } from "vitest";
import { writeListChanges } from "@/lib/storage/kv-cas";
import { memoryStore } from "./memory-store";

const list = (s: ReturnType<typeof memoryStore>, key: string) =>
  JSON.parse(s.rows.get(key)!.value).map((e: { id: string }) => e.id);

describe("writeListChanges", () => {
  it("applies the change to the stored list", async () => {
    const s = memoryStore({ income_entries: JSON.stringify([{ id: "a" }]) });
    await writeListChanges(s, "income_entries", [{ upserts: [{ id: "b" }], deletes: [] }]);
    expect(list(s, "income_entries")).toEqual(["a", "b"]);
  });

  it("keeps an entry another device saved between our read and our write", async () => {
    const s = memoryStore({ income_entries: JSON.stringify([{ id: "a" }]) });
    s.beforeNextCas = () => {
      s.rows.set("income_entries", { value: JSON.stringify([{ id: "a" }, { id: "phone" }]), updatedAt: "phone-write" });
    };
    await writeListChanges(s, "income_entries", [{ upserts: [{ id: "web" }], deletes: [] }]);
    expect(list(s, "income_entries")).toEqual(["a", "phone", "web"]);
  });

  it("writes nothing when the read fails — a failed load is never an empty list", async () => {
    const s = memoryStore({ income_entries: JSON.stringify([{ id: "a" }]) });
    s.failReads = true;
    await expect(
      writeListChanges(s, "income_entries", [{ upserts: [{ id: "b" }], deletes: [] }]),
    ).rejects.toThrow();
    expect(s.writes).toBe(0);
  });

  it("writes nothing when the stored value is not a list", async () => {
    const s = memoryStore({ income_entries: "{corrupt" });
    await expect(
      writeListChanges(s, "income_entries", [{ upserts: [{ id: "b" }], deletes: [] }]),
    ).rejects.toThrow();
    expect(s.rows.get("income_entries")!.value).toBe("{corrupt");
  });

  it("creates the key when it doesn't exist yet", async () => {
    const s = memoryStore();
    await writeListChanges(s, "networth_goals", [{ upserts: [{ id: "g" }], deletes: [] }]);
    expect(list(s, "networth_goals")).toEqual(["g"]);
  });

  it("gives up after repeated conflicts without writing anything of its own", async () => {
    const s = memoryStore({ income_entries: JSON.stringify([{ id: "a" }]) });
    let n = 0;
    const churn = () => {
      s.rows.set("income_entries", { value: JSON.stringify([{ id: "a" }]), updatedAt: `other-${n++}` });
      s.beforeNextCas = churn;
    };
    s.beforeNextCas = churn;
    await expect(
      writeListChanges(s, "income_entries", [{ upserts: [{ id: "b" }], deletes: [] }], { maxAttempts: 3 }),
    ).rejects.toThrow(/conflict/i);
    expect(list(s, "income_entries")).toEqual(["a"]);
  });

  it("skips the write when the change is already applied", async () => {
    const s = memoryStore({ income_entries: JSON.stringify([{ id: "a" }, { id: "b" }]) });
    const row = await writeListChanges(s, "income_entries", [{ upserts: [{ id: "b" }], deletes: [] }]);
    expect(s.writes).toBe(0);
    expect(row.updatedAt).toBe("t0");
  });
});
