import { describe, expect, it } from "vitest";
import { appOriginForRequest, appOriginIsAllowed, parseAppUrlConfiguration } from "@/sentinel/app-url";

describe("APP_URL configuration", () => {
  it("accepts one origin", () => {
    expect(parseAppUrlConfiguration("https://orbit.example")).toEqual({
      canonicalOrigin: "https://orbit.example",
      allowedOrigins: ["https://orbit.example"],
    });
  });

  it("accepts two comma-separated origins and keeps the first canonical", () => {
    expect(parseAppUrlConfiguration("https://orbit.example, https://alternate.example/")).toEqual({
      canonicalOrigin: "https://orbit.example",
      allowedOrigins: ["https://orbit.example", "https://alternate.example"],
    });
  });

  it.each([
    "https://orbit.example,",
    "https://orbit.example,https://alternate.example,https://third.example",
    "https://orbit.example,https://orbit.example/",
    "https://orbit.example/path,https://alternate.example",
    "https://user:password@orbit.example,https://alternate.example",
    "ftp://orbit.example,https://alternate.example",
  ])("rejects invalid origin configuration %s", (value) => {
    expect(() => parseAppUrlConfiguration(value)).toThrow(/APP_URL must contain one or two/);
  });

  it("allows either configured origin and rejects any other origin", () => {
    const appUrl = "https://orbit.example,https://alternate.example";
    expect(appOriginIsAllowed(appUrl, "https://orbit.example")).toBe(true);
    expect(appOriginIsAllowed(appUrl, "https://alternate.example")).toBe(true);
    expect(appOriginIsAllowed(appUrl, "https://evil.example")).toBe(false);
  });

  it("keeps request-local redirects on an allowed alternate origin", () => {
    const appUrl = "https://orbit.example,https://alternate.example";
    const request = new Request("https://alternate.example/merchants/example", { headers: { origin: "https://alternate.example" } });
    expect(appOriginForRequest(appUrl, request)).toBe("https://alternate.example");
  });

  it("falls back to the canonical origin for an unrecognized request host", () => {
    const appUrl = "https://orbit.example,https://alternate.example";
    const request = new Request("https://evil.example/merchants/example");
    expect(appOriginForRequest(appUrl, request)).toBe("https://orbit.example");
  });
});
