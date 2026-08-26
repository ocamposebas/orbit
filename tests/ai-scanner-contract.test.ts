import { describe, expect, it } from "vitest";
import { criticReason } from "@/ai-scanner/critic";
import { AI_SCANNER_QUEUE, AI_SCANNER_VERSION } from "@/ai-scanner/types";
import { aiScannerToolDefinitions } from "@/ai-scanner/tools/definitions";

describe("ORBIT AI Scanner v1 contracts", () => {
  it("exposes one independent queue and the complete read-only Luna tool surface", () => {
    expect(AI_SCANNER_QUEUE).toBe("orbit-ai-scanner-v1");
    expect(AI_SCANNER_VERSION).toBe("orbit-ai-scanner-v1");
    const names = aiScannerToolDefinitions.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["open_url", "get_page_snapshot", "inspect_navigation", "inspect_category", "enumerate_products", "inspect_product", "capture_viewport", "inspect_visual_region", "inspect_page_images", "inspect_background_images", "inspect_carousel", "inspect_pdf", "inspect_public_api", "inspect_checkout_read_only"]));
    expect(aiScannerToolDefinitions.every((tool) => tool.strict && tool.parameters.additionalProperties === false)).toBe(true);
  });

  it("routes only disputes to the optional critic", () => {
    expect(criticReason({ severity: "CRITICAL", ambiguous: false, contradictoryEvidence: false, materiality: "MATERIAL", confidence: 0.95 })).toBe("critical finding");
    expect(criticReason({ severity: "HIGH", ambiguous: true, contradictoryEvidence: false, materiality: "MATERIAL", confidence: 0.8 })).toBe("materially ambiguous high finding");
    expect(criticReason({ severity: "MEDIUM", ambiguous: false, contradictoryEvidence: true, materiality: "MATERIAL", confidence: 0.8 })).toBe("contradictory evidence");
    expect(criticReason({ severity: "MEDIUM", ambiguous: false, contradictoryEvidence: false, materiality: "MATERIAL", confidence: 0.5 })).toBe("low-confidence material conclusion");
    expect(criticReason({ severity: "HIGH", ambiguous: false, contradictoryEvidence: false, materiality: "MATERIAL", confidence: 0.9 })).toBeNull();
  });
});
