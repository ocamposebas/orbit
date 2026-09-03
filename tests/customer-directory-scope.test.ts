import { describe, expect, it } from "vitest";
import { customerMerchantIds } from "@/customers/data";

describe("customer directory merchant scope", () => {
  it("shows the complete authorized portfolio to ORBIT administrators", () => {
    expect(customerMerchantIds("OWNER", "merchant_a", ["merchant_a", "merchant_b", "merchant_b"]))
      .toEqual(["merchant_a", "merchant_b"]);
  });

  it("shows only the selected account to merchant users", () => {
    expect(customerMerchantIds("MERCHANT", "merchant_a", ["merchant_a", "merchant_b"]))
      .toEqual(["merchant_a"]);
  });

  it("never accepts an unselected merchant for a merchant user", () => {
    expect(customerMerchantIds("VIEWER", null, ["merchant_a", "merchant_b"]))
      .toEqual([]);
  });
});
