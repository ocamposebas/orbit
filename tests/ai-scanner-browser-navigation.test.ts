import { describe, expect, it } from "vitest";
import { safeNavigationCandidates } from "@/ai-scanner/tools/browser-session";

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
});
