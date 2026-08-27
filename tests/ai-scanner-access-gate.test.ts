import { describe, expect, it } from "vitest";
import { isRestrictedAuditRoute, isSafePublicGateControl } from "@/ai-scanner/tools/browser-session";

describe("public access gate safety", () => {
  it("allows only an unambiguous non-form entry acknowledgement", () => {
    expect(isSafePublicGateControl({ label: "Agree", inForm: false, type: null, destinationPathname: "/" })).toBe(true);
    expect(isSafePublicGateControl({ label: "Soy mayor de edad", inForm: false, type: "button", destinationPathname: "/catalog" })).toBe(true);
  });

  it("refuses negative, submitted, and transactional controls", () => {
    expect(isSafePublicGateControl({ label: "Disagree", inForm: false, type: null, destinationPathname: "/" })).toBe(false);
    expect(isSafePublicGateControl({ label: "Agree", inForm: true, type: "submit", destinationPathname: "/" })).toBe(false);
    expect(isSafePublicGateControl({ label: "Continue", inForm: false, type: null, destinationPathname: "/checkout" })).toBe(false);
    expect(isRestrictedAuditRoute("/products/checkout/payment")).toBe(true);
  });
});
