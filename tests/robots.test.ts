import { describe, expect, it } from "vitest";
import { parseRobots } from "@/sentinel/crawler/discovery";

describe("robots discovery", () => { it("extracts sitemaps and blocks disallowed paths", () => { const policy = parseRobots("User-agent: *\nDisallow: /private\nSitemap: /sitemap.xml", "https://example.test"); expect(policy.sitemaps).toEqual(["https://example.test/sitemap.xml"]); expect(policy.isAllowed("https://example.test/private/data")).toBe(false); expect(policy.isAllowed("https://example.test/catalog")).toBe(true); }); });
