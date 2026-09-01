import { describe, expect, it } from "vitest";
import { formatTransferDate, transferArrivalTiming } from "../src/merchant-portal/format";

describe("merchant transfer presentation", () => {
  const septemberThirdUtc = Date.UTC(2026, 8, 3) / 1_000;

  it("shows the confirmed arrival as a complete, unambiguous date", () => {
    expect(formatTransferDate(septemberThirdUtc)).toBe("September 3, 2026");
  });

  it("shows how close the confirmed bank arrival is", () => {
    expect(transferArrivalTiming(septemberThirdUtc, new Date("2026-09-01T18:00:00Z"))).toBe("In 2 days");
    expect(transferArrivalTiming(septemberThirdUtc, new Date("2026-09-02T23:59:00Z"))).toBe("Tomorrow");
    expect(transferArrivalTiming(septemberThirdUtc, new Date("2026-09-03T00:01:00Z"))).toBe("Today");
  });
});
