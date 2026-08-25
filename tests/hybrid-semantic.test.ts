import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { buildPageSemanticDocument, merchantSemanticCandidates, pageSemanticCandidates, validateMerchantSemanticAnalysis, validatePageSemanticAnalysis } from "@/sentinel/analysis/hybrid-semantic";
import { merchantSemanticAnalysisSchema, pageSemanticAnalysisSchema, pageSemanticJsonSchema, type SemanticObservation } from "@/sentinel/analysis/semantic-schema";
import { OpenAICompatibleWebsiteSemanticAnalyzer, type MerchantSemanticDocument } from "@/sentinel/analysis/website-semantic";
import { consolidateCandidates, isScorableCandidate } from "@/sentinel/analysis/candidate-quality";
import { calculateHealthScore } from "@/sentinel/analysis/score";
import type { CandidateFinding } from "@/sentinel/types";

const merchantUrl = "https://coreaminosresearch.company.site/";
const fixture = readFileSync(new URL("./fixtures/coreaminosresearch.html", import.meta.url), "utf8");
const content = extractNormalizedContent(fixture, merchantUrl);
const page = { url: merchantUrl, pageType: "HOME" as const, content };

function observation(exactText: string, overrides: Partial<SemanticObservation> = {}): SemanticObservation {
  return {
    category: "INTENDED_USE",
    classification: "CONTEXTUAL_REVIEW",
    evidence: { url: merchantUrl, evidenceType: "NAVIGATION", exactText },
    severity: "HIGH",
    confidence: 0.94,
    contextualExplanation: "A physiological outcome is used to organize a public commercial research catalog; research wording does not remove the intended-use signal.",
    humanReviewRequired: true,
    ...overrides,
  };
}

describe("hybrid website semantic analysis", () => {
  it("retains all Core Aminos evidence channels needed by the semantic pass", () => {
    const document = buildPageSemanticDocument(page);
    expect(document.evidenceItems).toEqual(expect.arrayContaining([
      { evidenceType: "NAVIGATION", text: "Obesity Research Products" },
      { evidenceType: "NAVIGATION", text: "Muscle Growth Research Products" },
      { evidenceType: "NAVIGATION", text: "Cognitive Research Products" },
      { evidenceType: "NAVIGATION", text: "Reproductive Research Products" },
      { evidenceType: "DISCLAIMER", text: "We are not a compounding pharmacy." },
      { evidenceType: "CTA", text: "Browse Research Products" },
    ]));
  });

  it("creates intended-use observations while keeping compounding-pharmacy negation non-promotional", () => {
    const document = buildPageSemanticDocument(page);
    const raw = pageSemanticAnalysisSchema.parse({ pageUrl: merchantUrl, observations: [
      observation("Obesity Research Products"),
      observation("Muscle Growth Research Products"),
      observation("Cognitive Research Products"),
      observation("Reproductive Research Products"),
      observation("We are not a compounding pharmacy.", { category: "PHARMACY_PRESCRIPTION", classification: "NEGATION", evidence: { url: merchantUrl, evidenceType: "DISCLAIMER", exactText: "We are not a compounding pharmacy." }, severity: "INFO", confidence: 0.99, contextualExplanation: "The sentence expressly denies pharmacy status.", humanReviewRequired: false }),
    ] });
    const validated = validatePageSemanticAnalysis(document, raw);
    const candidates = pageSemanticCandidates(validated, [page], "fixture", "fixture-model");
    expect(candidates.map((candidate) => candidate.detectedText)).toEqual([
      "Obesity Research Products",
      "Muscle Growth Research Products",
      "Cognitive Research Products",
      "Reproductive Research Products",
    ]);
    expect(candidates.some((candidate) => /pharmacy/i.test(candidate.detectedText ?? ""))).toBe(false);
  });

  it("rejects semantic observations whose exact evidence is not in the retained page", () => {
    const document = buildPageSemanticDocument(page);
    const raw = pageSemanticAnalysisSchema.parse({ pageUrl: merchantUrl, observations: [observation("Guaranteed diabetes cure")] });
    expect(validatePageSemanticAnalysis(document, raw).observations).toEqual([]);
  });

  it("builds an auditable merchant-level RUO-versus-marketing contradiction", () => {
    const intended = observation("Obesity Research Products");
    const restriction = observation("All products are sold for research use only and are not for human consumption.", { category: "RESEARCH_POSITIONING", classification: "RESTRICTION", evidence: { url: merchantUrl, evidenceType: "DISCLAIMER", exactText: "All products are sold for research use only and are not for human consumption." }, severity: "INFO", confidence: 0.99, contextualExplanation: "The merchant states an explicit RUO restriction.", humanReviewRequired: false });
    const merchantDocument: MerchantSemanticDocument = { merchantName: "Core Aminos Research", pages: [{ pageUrl: merchantUrl, pageType: "HOME", observations: [intended, restriction] }], deterministicFindings: [] };
    const analysis = merchantSemanticAnalysisSchema.parse({ observations: [{ ...intended, category: "CONTRADICTION", classification: "CONTRADICTION", contextualExplanation: "The public obesity catalog positioning conflicts with the merchant's separate research-only and no-human-consumption restriction.", supportingEvidence: [restriction.evidence], humanReviewRequired: true }] });
    const validated = validateMerchantSemanticAnalysis(merchantDocument, analysis);
    const candidates = merchantSemanticCandidates(validated, [page], "fixture", "fixture-model");
    expect(candidates).toEqual([expect.objectContaining({ ruleKey: "SEM-MERCHANT-CONTRADICTION", detectedText: "Obesity Research Products", supportingEvidence: [expect.objectContaining({ text: restriction.evidence.exactText })] })]);
  });

  it("deduplicates template evidence across URLs and feeds only validated semantic observations into deterministic scoring", () => {
    const document = buildPageSemanticDocument(page);
    const validated = validatePageSemanticAnalysis(document, pageSemanticAnalysisSchema.parse({ pageUrl: merchantUrl, observations: [observation("Obesity Research Products")] }));
    const first = pageSemanticCandidates(validated, [page], "fixture", "fixture-model")[0];
    const repeated = { ...first, url: `${merchantUrl}products/alpha`, pageType: "PRODUCT" as const };
    const consolidated = consolidateCandidates([first, repeated]);
    expect(consolidated).toHaveLength(1);
    expect(consolidated[0].affectedUrls).toEqual([merchantUrl, `${merchantUrl}products/alpha`]);
    const score = calculateHealthScore(consolidated.filter(isScorableCandidate));
    expect(score.components.find((component) => component.key === "MARKETING_RISK")?.score).toBeLessThan(100);
  });

  it("keeps an equivalent deterministic observation authoritative over semantic scoring input", () => {
    const semantic = pageSemanticCandidates(pageSemanticAnalysisSchema.parse({ pageUrl: merchantUrl, observations: [observation("Obesity Research Products")] }), [page], "fixture", "fixture-model")[0];
    const deterministic: CandidateFinding = { ...semantic, ruleKey: "MKT-INTENDED-USE-001", analysisSource: "DETERMINISTIC", provider: undefined, modelVersion: undefined };
    expect(consolidateCandidates([semantic, deterministic])).toEqual([expect.objectContaining({ ruleKey: "MKT-INTENDED-USE-001" })]);
  });

  it("requests strict JSON-schema output and forbids approval decisions", async () => {
    let requestBody: Record<string, unknown> = {};
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ pageUrl: merchantUrl, observations: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const analyzer = new OpenAICompatibleWebsiteSemanticAnalyzer({ apiKey: "test-key", baseUrl: "https://llm.example/v1", model: "review-model", timeoutMs: 5_000, maxOutputTokens: 1_000, inputCostPerMillion: 1, outputCostPerMillion: 2 }, request as typeof fetch);
    const run = await analyzer.analyzePage(buildPageSemanticDocument(page));
    expect(run.result).toEqual({ pageUrl: merchantUrl, observations: [] });
    expect(requestBody).toEqual(expect.objectContaining({ temperature: 0, response_format: expect.objectContaining({ type: "json_schema", json_schema: expect.objectContaining({ strict: true }) }) }));
    expect(JSON.stringify(requestBody)).toContain("Never decide or imply merchant approval");
    expect(pageSemanticJsonSchema).toEqual(expect.objectContaining({ additionalProperties: false }));
  });
});
