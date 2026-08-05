import { describe, it, expect } from "vitest";
import { parseHostplusPrices } from "../hostplus";

// Trimmed fixtures captured from the live Hostplus endpoints (2026-08-05).
const RETURNS = {
  msg: {
    DailyData: [
      {
        Key: "Diversified options",
        Items: [
          { currentOptionName: "High Growth", price: ["$1.4095", "$1.4129", "$1.4086", "$1.4153", "$1.4230"] },
          { currentOptionName: "Indexed Growth ", price: ["$1.2211", "$1.2194", "$1.2208", "$1.2274", "$1.2364"] },
        ],
      },
      {
        Key: "Sector options",
        Items: [
          { currentOptionName: "International Shares", price: ["$5.4096", "$5.4011", "$5.3970", "$5.4426", "$5.4798"] },
          { currentOptionName: "International Shares - Indexed", price: ["$2.8778", "$2.8630", "$2.8761", "$2.8834", "$2.9238"] },
          { currentOptionName: "Empty Option", price: [] },
        ],
      },
    ],
    DateHeaders: ["Tuesday 28 July 2026", "Wednesday 29 July 2026", "Thursday 30 July 2026", "Friday 31 July 2026", "Monday 3 August 2026"],
    LastUpdatedDate: "4 August 2026 6:00:16 PM",
  },
};

const OPTIONS = {
  msg: [
    { OptionCode: "HC35A", OptionName: "High Growth", InvestmentTypeId: 13 },
    { OptionCode: "HC38A", OptionName: "Indexed Growth ", InvestmentTypeId: 13 },
    { OptionCode: "HC06A", OptionName: "International Shares", InvestmentTypeId: 13 },
    { OptionCode: "HC21A", OptionName: "International Shares - Indexed", InvestmentTypeId: 13 },
  ],
};

describe("parseHostplusPrices", () => {
  const result = parseHostplusPrices(RETURNS, OPTIONS, "Superannuation");

  it("takes the last array element as the latest price", () => {
    const intl = result.options.find((o) => o.code === "HC21A");
    expect(intl?.price).toBeCloseTo(2.9238, 4);
    expect(intl?.name).toBe("International Shares - Indexed");
  });

  it("maps option names (incl. trailing-space names) to their codes", () => {
    expect(result.options.find((o) => o.name === "Indexed Growth")?.code).toBe("HC38A");
    expect(result.options.find((o) => o.name === "High Growth")?.code).toBe("HC35A");
  });

  it("distinguishes active vs indexed International Shares", () => {
    expect(result.options.find((o) => o.code === "HC06A")?.price).toBeCloseTo(5.4798, 4);
    expect(result.options.find((o) => o.code === "HC21A")?.price).toBeCloseTo(2.9238, 4);
  });

  it("keeps the full oldest→newest history", () => {
    const intl = result.options.find((o) => o.code === "HC21A");
    expect(intl?.history).toEqual([2.8778, 2.863, 2.8761, 2.8834, 2.9238]);
  });

  it("drops options with no price data", () => {
    expect(result.options.some((o) => o.name === "Empty Option")).toBe(false);
  });

  it("passes through dates and last-updated stamp", () => {
    expect(result.dates).toHaveLength(5);
    expect(result.dates[4]).toBe("Monday 3 August 2026");
    expect(result.lastUpdated).toBe("4 August 2026 6:00:16 PM");
  });
});
