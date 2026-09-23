import { describe, it, expect } from "vitest";
import { reconcileHoldingPosition } from "@/lib/utils/portfolio-transactions";
import type { PortfolioHolding, PortfolioTransaction } from "@/lib/utils/types";

// Logging a transaction moves its holding by exactly what the transaction log
// moved (after − before). Applied to the LATEST stored holding, that composes
// with changes made elsewhere — a buy logged on the phone must survive.

const same = (amount: number) => amount;
const buy = (id: string, units: number, price: number): PortfolioTransaction =>
  ({ id, holdingId: "H", holdingName: "X", type: "buy", units, pricePerUnit: price, totalAmount: units * price, currency: "USD", date: "2026-09-01", notes: "", createdAt: 0 }) as PortfolioTransaction;
const holding = (units: number, amountInvested: number, currentValue: number) =>
  ({ id: "H", units, amountInvested, currentValue, currency: "USD" }) as PortfolioHolding;

describe("reconcileHoldingPosition", () => {
  it("adds this change's delta on top of units the phone added meanwhile", () => {
    const before = [buy("t1", 10, 10)];            // what this page's log held
    const after = [buy("t2", 2, 10), ...before];    // this page logs +2
    const stored = holding(13, 130, 130);           // phone already logged +3 (10 → 13)
    const next = reconcileHoldingPosition(stored, before, after, same);
    expect(next.units).toBe(15);
    expect(next.amountInvested).toBe(150);
    expect(next.currentValue).toBe(150); // rescaled at the stored price per unit
  });

  it("keeps units the log doesn't explain (a legacy opening position)", () => {
    const next = reconcileHoldingPosition(holding(5, 50, 60), [], [buy("t1", 1, 10)], same);
    expect(next.units).toBe(6);
    expect(next.amountInvested).toBe(60);
  });
});
