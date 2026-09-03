import { describe, expect, it } from "vitest";
import { analyticsRange } from "@/operations/analytics";

describe("portal analytics range", () => {
  it("accepts only bounded dashboard ranges", () => {
    expect(analyticsRange("7d")).toBe("7d");
    expect(analyticsRange("30d")).toBe("30d");
    expect(analyticsRange("90d")).toBe("90d");
  });

  it("defaults invalid or unbounded input to 30 days", () => {
    expect(analyticsRange("all")).toBe("30d");
    expect(analyticsRange("99999d")).toBe("30d");
    expect(analyticsRange(undefined)).toBe("30d");
  });
});
