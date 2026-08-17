import { describe, it, expect } from "vitest";
import {
  projectPath,
  monthsToReach,
  requiredMonthlySaving,
  requiredAnnualReturn,
  describeMonths,
  measuredAnnualPacePct,
  measuredMonthlySaving,
  monthlyRate,
} from "../forecast";

const base = { netWorth: 1_000, monthlySaving: 100, annualReturnPct: 0, contributionGrowthPct: 0 };

describe("projectPath", () => {
  it("is linear at zero return", () => {
    const { withGrowth, savingsOnly } = projectPath(base, 12);
    expect(withGrowth[12]).toBeCloseTo(1_000 + 12 * 100, 6);
    expect(savingsOnly).toEqual(withGrowth);
  });

  it("compounds a 7% year to exactly 7% with no contributions", () => {
    const { withGrowth } = projectPath({ ...base, monthlySaving: 0, annualReturnPct: 7 }, 12);
    expect(withGrowth[12]).toBeCloseTo(1_070, 6);
  });

  it("grows the contribution once per year", () => {
    const { savingsOnly } = projectPath({ ...base, contributionGrowthPct: 10 }, 24);
    // year 1: 12 × 100, year 2: 12 × 110
    expect(savingsOnly[24]).toBeCloseTo(1_000 + 1_200 + 1_320, 6);
  });
});

describe("monthsToReach", () => {
  it("returns 0 when already there", () => {
    expect(monthsToReach(base, 900)).toBe(0);
  });
  it("counts months exactly on a linear path", () => {
    expect(monthsToReach(base, 1_500)).toBe(5);
  });
  it("is null when the path can never get there", () => {
    expect(monthsToReach({ ...base, monthlySaving: 0 }, 2_000)).toBeNull();
    expect(monthsToReach({ ...base, monthlySaving: -50 }, 2_000)).toBeNull();
  });
  it("gets there sooner with return than without", () => {
    const flat = monthsToReach(base, 5_000)!;
    const grown = monthsToReach({ ...base, annualReturnPct: 7 }, 5_000)!;
    expect(grown).toBeLessThan(flat);
  });
});

describe("inverse questions agree with the forward walk", () => {
  it("required saving actually reaches the target in the deadline", () => {
    const target = 50_000;
    const months = 60;
    const need = requiredMonthlySaving({ netWorth: 1_000, annualReturnPct: 7, contributionGrowthPct: 0 }, target, months)!;
    expect(need).toBeGreaterThan(0);
    const reached = monthsToReach({ netWorth: 1_000, monthlySaving: need, annualReturnPct: 7, contributionGrowthPct: 0 }, target)!;
    expect(reached).toBeLessThanOrEqual(months);
    // and a hair less does NOT make it — it's the smallest
    const short = monthsToReach({ netWorth: 1_000, monthlySaving: need * 0.98, annualReturnPct: 7, contributionGrowthPct: 0 }, target);
    expect(short === null || short > months).toBe(true);
  });

  it("required return actually reaches the target in the deadline", () => {
    const target = 20_000;
    const months = 60;
    const need = requiredAnnualReturn({ netWorth: 5_000, monthlySaving: 100, contributionGrowthPct: 0 }, target, months)!;
    const reached = monthsToReach({ netWorth: 5_000, monthlySaving: 100, annualReturnPct: need, contributionGrowthPct: 0 }, target)!;
    expect(reached).toBeLessThanOrEqual(months);
  });

  it("returns 0 saving when growth alone gets there", () => {
    expect(requiredMonthlySaving({ netWorth: 1_000, annualReturnPct: 7, contributionGrowthPct: 0 }, 1_050, 12)).toBe(0);
  });

  it("returns null when no sane return can do it", () => {
    expect(requiredAnnualReturn({ netWorth: 100, monthlySaving: 0, contributionGrowthPct: 0 }, 1_000_000, 12)).toBeNull();
  });
});

describe("describeMonths", () => {
  it("speaks like a person", () => {
    expect(describeMonths(0)).toBe("now");
    expect(describeMonths(1)).toBe("1 month");
    expect(describeMonths(8)).toBe("8 months");
    expect(describeMonths(24)).toBe("2 years");
    expect(describeMonths(175)).toBe("14y 7m");
  });
});

describe("measured inputs", () => {
  it("annualises growth beyond savings", () => {
    // NW 100 → 130 in a year with 20 saved: 10 growth on avg 115
    const pct = measuredAnnualPacePct({ nwStart: 100, nwEnd: 130, netSavingsInWindow: 20, windowDays: 365 })!;
    expect(pct).toBeCloseTo((10 / 115) * 100, 6);
  });
  it("refuses windows under 90 days", () => {
    expect(measuredAnnualPacePct({ nwStart: 100, nwEnd: 130, netSavingsInWindow: 0, windowDays: 60 })).toBeNull();
  });
  it("ignores months before expense tracking began", () => {
    const saving = measuredMonthlySaving([
      { income: 1000, expenses: 0 },   // pre-tracking: would inflate
      { income: 1000, expenses: 400 },
      { income: 1200, expenses: 500 },
    ])!;
    expect(saving).toBeCloseTo((600 + 700) / 2, 6);
  });
  it("falls back to income-only months when nothing else exists", () => {
    expect(measuredMonthlySaving([{ income: 1000, expenses: 0 }])).toBe(1000);
    expect(measuredMonthlySaving([])).toBeNull();
  });
});

describe("monthlyRate", () => {
  it("is geometric, not annual/12", () => {
    expect(Math.pow(1 + monthlyRate(12), 12)).toBeCloseTo(1.12, 10);
  });
});
