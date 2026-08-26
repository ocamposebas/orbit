import { describe, expect, it } from "vitest";
import { redirectedCanonicalHost, safeNavigationCandidates } from "@/ai-scanner/tools/browser-session";

describe("AI Scanner safe browser navigation recovery", () => {
  it("tries only bounded same-host and www/protocol equivalents while preserving the path", () => {
    expect(safeNavigationCandidates("https://merchant.example/catalog?q=research#ignored")).toEqual([
      "https://merchant.example/catalog?q=research",
      "https://www.merchant.example/catalog?q=research",
      "http://merchant.example/catalog?q=research",
      "http://www.merchant.example/catalog?q=research",
    ]);
  });

  it("does not duplicate a www variant", () => {
    expect(safeNavigationCandidates("https://www.merchant.example/")).toEqual([
      "https://www.merchant.example/",
      "https://merchant.example/",
      "http://www.merchant.example/",
      "http://merchant.example/",
    ]);
  });

  it("accepts a canonical host only when a registered URL initiated the HTTP redirect chain", () => {
    expect(redirectedCanonicalHost({
      requestedUrl: "https://merchant.company.site/",
      finalUrl: "https://merchant.com/",
      redirectChain: ["https://merchant.company.site/", "https://merchant.com/"],
      allowedHosts: new Set(["merchant.company.site", "www.merchant.company.site"]),
    })).toBe("merchant.com");

    expect(redirectedCanonicalHost({
      requestedUrl: "https://merchant.com/",
      finalUrl: "https://merchant.com/",
      redirectChain: ["https://merchant.com/"],
      allowedHosts: new Set(["merchant.company.site"]),
    })).toBeNull();
  });

  it("rejects mismatched, unregistered, or excessive redirect chains", () => {
    const allowedHosts = new Set(["merchant.company.site"]);
    expect(redirectedCanonicalHost({ requestedUrl: "https://merchant.company.site/", finalUrl: "https://merchant.com/", redirectChain: ["https://other.example/", "https://merchant.com/"], allowedHosts })).toBeNull();
    expect(redirectedCanonicalHost({ requestedUrl: "https://merchant.company.site/", finalUrl: "https://merchant.com/", redirectChain: ["https://merchant.company.site/", "https://merchant.com/"], allowedHosts: new Set() })).toBeNull();
    expect(redirectedCanonicalHost({ requestedUrl: "https://merchant.company.site/", finalUrl: "https://merchant.com/", redirectChain: ["https://merchant.company.site/", "https://one.example/", "https://two.example/", "https://three.example/", "https://four.example/", "https://five.example/", "https://merchant.com/"], allowedHosts })).toBeNull();
  });
});
