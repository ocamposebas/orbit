import { describe, expect, it } from "vitest";
import { verifyTwoFactorCode } from "@/sentinel/auth/two-factor";

describe("TOTP verification", () => {
  it("accepts the RFC 6238 SHA-1 vector reduced to six digits", () => {
    expect(verifyTwoFactorCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59_000)).toBe(true);
  });

  it("rejects malformed and incorrect codes", () => {
    expect(verifyTwoFactorCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287081", 59_000)).toBe(false);
    expect(verifyTwoFactorCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "12345", 59_000)).toBe(false);
  });
});
