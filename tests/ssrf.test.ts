import { describe, expect, it } from "vitest";
import { isPrivateOrReservedIp, normalizePublicUrl, validatePublicUrl } from "@/sentinel/security/ssrf";

describe("SSRF protection", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1"])("blocks reserved address %s", (address) => expect(isPrivateOrReservedIp(address)).toBe(true));
  it.each(["file:///etc/passwd", "ftp://example.com/file", "http://localhost:3000", "http://metadata.google.internal"])("rejects unsafe target %s", (target) => expect(() => normalizePublicUrl(target)).toThrow());
  it("blocks an IP target before making a request", async () => { await expect(validatePublicUrl("http://127.0.0.1:3000")).rejects.toThrow(/Private|reserved/i); });
});
