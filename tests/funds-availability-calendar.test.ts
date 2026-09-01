import { describe, expect, it } from "vitest";
import { pendingAvailabilityCalendar } from "@/merchant-portal/data";

describe("pending funds availability calendar", () => {
  it("groups positive pending net movements by confirmed date and currency", () => {
    const result = pendingAvailabilityCalendar([
      { available_on: 1_788_393_600, currency: "usd", net: 1_000, status: "pending" },
      { available_on: 1_788_393_600, currency: "usd", net: 2_500, status: "pending" },
      { available_on: 1_788_480_000, currency: "usd", net: 500, status: "pending" },
      { available_on: 1_788_393_600, currency: "usd", net: -200, status: "pending" },
      { available_on: 1_788_393_600, currency: "usd", net: 900, status: "available" },
    ], "USD");
    expect(result).toEqual([
      { availableOn: 1_788_393_600, amountMinor: 3_500, currency: "USD", transactionCount: 2 },
      { availableOn: 1_788_480_000, amountMinor: 500, currency: "USD", transactionCount: 1 },
    ]);
  });
});
