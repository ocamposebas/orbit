import { describe, expect, it } from "vitest";
import { parseRobots } from "@/sentinel/crawler/discovery";

describe("robots discovery", () => {
  it("extracts same-origin sitemaps and honors the longest matching rule", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\nSitemap: /sitemap.xml\nSitemap: https://attacker.test/injected.xml", "https://example.test");
    expect(policy.sitemaps).toEqual(["https://example.test/sitemap.xml"]);
    expect(policy.isAllowed("https://example.test/private/data")).toBe(false);
    expect(policy.isAllowed("https://example.test/private/public/document")).toBe(true);
    expect(policy.isAllowed("https://example.test/catalog")).toBe(true);
  });

  it("prefers an explicit ORBIT crawler group over the wildcard group", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /wildcard-only\n\nUser-agent: Orbit-Sentinel\nDisallow: /scanner-private", "https://example.test");
    expect(policy.isAllowed("https://example.test/wildcard-only")).toBe(true);
    expect(policy.isAllowed("https://example.test/scanner-private")).toBe(false);
  });
});
