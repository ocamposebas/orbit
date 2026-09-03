import { describe, expect, it } from "vitest";
import { createLoginEmailCode, loginEmailCodeHash, loginVerificationEmailHtml, maskLoginEmail, verifyLoginEmailCode } from "@/sentinel/auth/login-email";

describe("email login verification", () => {
  it("creates fixed-width numeric codes", () => {
    for (let index = 0; index < 25; index += 1) expect(createLoginEmailCode()).toMatch(/^\d{6}$/);
  });

  it("binds a code hash to both the opaque challenge token and code", () => {
    const hash = loginEmailCodeHash("token-one", "123456");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyLoginEmailCode("token-one", "123456", hash)).toBe(true);
    expect(verifyLoginEmailCode("token-two", "123456", hash)).toBe(false);
    expect(verifyLoginEmailCode("token-one", "654321", hash)).toBe(false);
    expect(verifyLoginEmailCode("token-one", "12345", hash)).toBe(false);
  });

  it("shows only a masked version of the registered destination", () => {
    expect(maskLoginEmail("sebastian@example.com")).toBe("se•••••••@example.com");
    expect(maskLoginEmail("a@example.com")).toBe("a•••@example.com");
  });

  it("escapes profile content in the email and includes the one-time code", () => {
    const html = loginVerificationEmailHtml({ name: '<script>alert("x")</script>', code: "042731" });
    expect(html).toContain("042731");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("expires in 10 minutes");
  });
});
