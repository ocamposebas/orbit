import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/sentinel/auth/password";

describe("password storage", () => {
  it("uses salted scrypt hashes and constant-time verification", async () => { const first = await hashPassword("a-secure-demo-password"); const second = await hashPassword("a-secure-demo-password"); expect(first).not.toBe(second); await expect(verifyPassword("a-secure-demo-password", first)).resolves.toBe(true); await expect(verifyPassword("wrong-password-value", first)).resolves.toBe(false); });
});
