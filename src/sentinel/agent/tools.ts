import type { EvidenceManifest, EvidenceManifestRecord } from "@/sentinel/evidence/schema";
import type { NormalizedContent, SentinelPageType } from "@/sentinel/types";
import { possibleProductCount, verifiedProductRecords, type ProductPageInput } from "@/sentinel/verification/products";
import { investigationPlanSchema, lunaAuditToolNames, type AgenticAuditTrace, type AuditBudget, type AuditToolCallTrace, type LunaAuditToolName } from "./schema";

export interface AuditPage extends ProductPageInput {
  id?: string;
  snapshotId?: string;
}

type ToolArguments = { url: string | null; query: string | null; limit: number };

const commonParameters = {
  type: "object",
  properties: {
    url: { type: ["string", "null"], description: "Exact retained merchant URL to inspect, or null for a merchant-wide query." },
    query: { type: ["string", "null"], description: "Optional evidence type, selector, relationship, or text focus." },
    limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum result records requested within the audit budget." },
  },
  required: ["url", "query", "limit"],
  additionalProperties: false,
} as const;

const descriptions: Record<Exclude<LunaAuditToolName, "record_investigation_plan">, string> = {
  discover_urls: "List discovered first-party URLs, status, page type, discovery parent, and the objective surface inventory.",
  open_rendered_page: "Open retained rendered-page evidence and its screenshot inventory without performing a write or form submission.",
  inspect_visible_text: "Inspect retained visible text and exact text evidence for a page or merchant-wide focus.",
  inspect_dom_structure: "Inspect headings, navigation, footer, CTAs, selectors, forms, controls, and link destinations together.",
  inspect_metadata: "Inspect title, description, Open Graph, canonical/location, and product metadata.",
  inspect_structured_data: "Inspect JSON-LD and other retained structured-data records.",
  enumerate_categories: "Enumerate observed categories and collections with their linked product relationships.",
  enumerate_products: "Enumerate verifier-confirmable products using multiple platform-neutral commerce signals; editorial content is excluded.",
  retrieve_product_commerce: "Retrieve product name, SKU, price, variants, availability, CTA, canonical URL, and supporting evidence IDs.",
  inspect_visual_composition: "Inspect a material visual as one composition with screenshot, text, DOM, CTA/link, product/category relationship, prominence, and evidence IDs.",
  inspect_image_region: "Inspect retained screenshot or crop evidence for a specific page/selector; never reduces the region to OCR labels alone.",
  inspect_page_imagery: "Inspect all retained material imagery, CSS/background references, sliders, carousels, and image context for a page.",
  inspect_documents: "Inspect retained PDF/document links, extracted pages, metadata, availability, and provenance.",
  inspect_public_api: "Inspect anonymously observed, sanitized, read-only public JSON/API evidence.",
  inspect_read_only_checkout: "Inspect retained cart/checkout controls and states without accepting terms, submitting forms, paying, or ordering.",
  follow_internal_links: "Follow retained first-party link relationships from a page and return matching destinations already discovered by Sentinel.",
};

export const lunaAuditToolDefinitions = [
  {
    type: "function",
    name: "record_investigation_plan",
    description: "Record the concise investigation plan before requesting deeper merchant evidence.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        priorities: { type: "array", items: { type: "string" } },
      },
      required: ["objective", "steps", "priorities"],
      additionalProperties: false,
    },
  },
  ...lunaAuditToolNames.filter((name) => name !== "record_investigation_plan").map((name) => ({ type: "function" as const, name, description: descriptions[name], strict: true, parameters: commonParameters })),
];

function text(record: EvidenceManifestRecord) {
  if (record.exactText) return record.exactText;
  if (record.value !== undefined) return JSON.stringify(record.value);
  return "";
}

function compactRecord(record: EvidenceManifestRecord) {
  const valueText = record.value === undefined ? undefined : JSON.stringify(record.value);
  return {
    evidenceRecordId: record.id,
    artifactKind: record.artifactKind,
    evidenceType: record.evidenceType,
    sourceUrl: record.sourceUrl,
    parentUrl: record.parentUrl,
    exactText: record.exactText?.slice(0, 20_000),
    value: valueText && valueText.length > 20_000 ? `${valueText.slice(0, 20_000)}...[TRUNCATED]` : record.value,
    selector: record.selector,
    pageNumber: record.pageNumber,
    storageKey: record.storageKey,
    artifactHash: record.artifactHash,
  };
}

function pageInventory(page: AuditPage) {
  return {
    url: page.url,
    canonicalUrl: page.canonicalUrl ?? page.url,
    status: page.httpStatus ?? null,
    pageType: page.pageType,
    title: page.content.title,
    discoveredFrom: page.content.location.originalUrl !== page.content.location.finalUrl ? page.content.location.originalUrl : null,
    counts: { headings: page.content.headingRecords.length, links: page.content.links.length, images: page.content.images.length, documents: page.content.embeddedDocuments.length, forms: page.content.forms.length },
  };
}

function matching(records: EvidenceManifestRecord[], args: ToolArguments, types?: RegExp) {
  const query = args.query?.trim().toLowerCase();
  return records.filter((record) => (!args.url || record.sourceUrl === args.url || record.parentUrl === args.url) && (!types || types.test(`${record.evidenceType} ${record.artifactKind}`)) && (!query || `${record.evidenceType} ${record.sourceUrl} ${text(record)}`.toLowerCase().includes(query))).slice(0, args.limit);
}

function coverage(discovered: number, inspected: number, capped: boolean) {
  const observed = discovered ? Math.min(100, Math.round(inspected / discovered * 100)) : null;
  return { discovered, inspected, percent: observed === null ? null : capped ? Math.min(99, observed) : observed, complete: discovered > 0 && inspected >= discovered && !capped, capped };
}

export function buildObjectiveInventory(pages: AuditPage[], manifest: EvidenceManifest) {
  const records = manifest.records.filter((record) => record.scope === "MERCHANT_SITE");
  const productRecords = verifiedProductRecords(pages, manifest);
  return {
    siteMap: pages.map(pageInventory),
    surfaces: {
      pages: pages.length,
      possibleProducts: possibleProductCount(pages, manifest),
      verifiedProducts: productRecords.length,
      categories: pages.filter((page) => page.pageType === "CATEGORY" || page.pageType === "COLLECTION").length,
      imageReferences: pages.reduce((sum, page) => sum + page.content.images.length, 0),
      retainedVisualRegions: new Set(records.filter((record) => record.artifactKind === "IMAGE" || record.artifactKind === "SCREENSHOT").map((record) => record.artifactId)).size,
      documents: new Set(records.filter((record) => record.artifactKind === "PDF" || record.artifactKind === "DOCUMENT_TEXT" || record.evidenceType === "DOCUMENT_LINK").map((record) => record.artifactId)).size,
      publicApiResponses: new Set(records.filter((record) => record.artifactKind === "PUBLIC_API").map((record) => record.artifactId)).size,
      checkoutStates: new Set(records.filter((record) => record.artifactKind === "CHECKOUT_STATE").map((record) => record.artifactId)).size,
    },
    evidenceByType: Object.fromEntries([...new Set(records.map((record) => record.evidenceType))].sort().map((type) => [type, records.filter((record) => record.evidenceType === type).length])),
  };
}

export class LunaAuditWorkspace {
  private readonly startedAt = Date.now();
  private readonly records: EvidenceManifestRecord[];
  private readonly calls: AuditToolCallTrace[] = [];
  private readonly inspectedEvidence = new Set<string>();
  private readonly inspectedPages = new Set<string>();
  private readonly inspectedImages = new Set<string>();
  private readonly inspectedDocuments = new Set<string>();
  private readonly unresolved = new Set<string>();
  private plan: AgenticAuditTrace["plan"] = null;

  constructor(readonly pages: AuditPage[], readonly manifest: EvidenceManifest, readonly budget: AuditBudget) {
    this.records = manifest.records.filter((record) => record.scope === "MERCHANT_SITE");
  }

  inventory() { return buildObjectiveInventory(this.pages, this.manifest); }

  addUnresolved(item: string) { this.unresolved.add(item.slice(0, 2_000)); }

  private budgetFailure(name: LunaAuditToolName) {
    if (Date.now() - this.startedAt >= this.budget.maxAuditTimeMs) return "Maximum audit time reached";
    if (this.calls.length >= this.budget.maxToolCalls) return "Maximum tool calls reached";
    if (["inspect_visual_composition", "inspect_image_region", "inspect_page_imagery"].includes(name) && this.inspectedImages.size >= this.budget.maxImageRegions) return "Maximum image regions reached";
    if (name === "inspect_documents" && this.inspectedDocuments.size >= this.budget.maxDocuments) return "Maximum documents reached";
    return undefined;
  }

  private composition(url: string, records: EvidenceManifestRecord[]) {
    const page = this.pages.find((item) => item.url === url);
    const products = verifiedProductRecords(this.pages, this.manifest);
    const linkedProducts = products.filter((product) => product.url === url || page?.content.links.some((link) => link.href === product.url));
    const visual = records.filter((record) => record.artifactKind === "IMAGE" || record.artifactKind === "SCREENSHOT").map(compactRecord);
    return {
      pageUrl: url,
      pageType: page?.pageType ?? "OTHER",
      locationAndProminence: page ? (["PRODUCT", "CATEGORY", "COLLECTION", "HOME", "LANDING"].includes(page.pageType) ? "COMMERCIAL" : ["ARTICLE", "BLOG"].includes(page.pageType) ? "EDITORIAL" : "SUPPORTING") : "UNKNOWN",
      screenshotsAndRegions: visual,
      visibleText: page?.content.visibleText.slice(0, 30_000),
      surroundingDom: page?.content.domEvidence.slice(0, 100),
      linksAndCtas: [...(page?.content.linkCtas ?? []), ...(page?.content.navigation ?? [])].slice(0, 100),
      imageReferences: page?.content.images.slice(0, 100) ?? [],
      categoryRelationship: page?.content.productCategories ?? [],
      associatedProducts: linkedProducts,
      verifiedProductCount: products.length,
      semanticInstruction: "Interpret screenshots, embedded text, DOM, link destinations, CTA, and product/category relationships as one composition; do not infer from OCR or labels alone.",
    };
  }

  async execute(callId: string, name: string, rawArguments: unknown) {
    const startedAt = new Date().toISOString();
    const tool = lunaAuditToolNames.includes(name as LunaAuditToolName) ? name as LunaAuditToolName : undefined;
    if (!tool) return { ok: false, error: `Unknown audit tool: ${name}`, evidenceRecordIds: [] as string[] };
    const blocked = this.budgetFailure(tool);
    if (blocked) {
      this.unresolved.add(blocked);
      this.calls.push({ callId, tool, arguments: {}, status: "BUDGET_EXHAUSTED", evidenceRecordIds: [], startedAt, completedAt: new Date().toISOString(), error: blocked });
      return { ok: false, error: blocked, budgetExhausted: true, evidenceRecordIds: [] as string[] };
    }
    try {
      if (tool === "record_investigation_plan") {
        this.plan = investigationPlanSchema.parse(rawArguments);
        const result = { ok: true, planRecorded: true, evidenceRecordIds: [] as string[] };
        this.calls.push({ callId, tool, arguments: rawArguments as Record<string, unknown>, status: "COMPLETED", evidenceRecordIds: [], startedAt, completedAt: new Date().toISOString() });
        return result;
      }
      const parsed = rawArguments as Partial<ToolArguments>;
      const args: ToolArguments = { url: typeof parsed.url === "string" ? parsed.url : null, query: typeof parsed.query === "string" ? parsed.query : null, limit: Math.max(1, Math.min(100, Number(parsed.limit) || 25)) };
      let selected: EvidenceManifestRecord[] = [];
      let data: unknown;
      const page = args.url ? this.pages.find((item) => item.url === args.url) : undefined;
      switch (tool) {
        case "discover_urls": data = this.inventory(); selected = matching(this.records, { ...args, url: null }, /PAGE_TYPE|PAGE_LOCATION/); break;
        case "open_rendered_page": selected = matching(this.records, args, /PAGE_|SCREENSHOT|VIEWPORT|FULL_PAGE/); data = { page: page && pageInventory(page), evidence: selected.map(compactRecord) }; break;
        case "inspect_visible_text": selected = matching(this.records, args, /VISIBLE_TEXT|TITLE|HEADING|CLAIM|DISCLAIMER|BUTTON|BADGE|STOCK|CHECKOUT_TEXT/); data = selected.map(compactRecord); break;
        case "inspect_dom_structure": selected = matching(this.records, args, /HEADING|NAVIGATION|FOOTER|LINK_CTA|BUTTON|FORM_FIELD|OBSERVED_CONTROLS|INTERACTIVE_STATE/); data = { evidence: selected.map(compactRecord), dom: page?.content.domEvidence.slice(0, args.limit), links: page?.content.links.slice(0, args.limit) }; break;
        case "inspect_metadata": selected = matching(this.records, args, /TITLE|META_|OPEN_GRAPH|PAGE_LOCATION|PRODUCT_NAME|PRODUCT_TAG/); data = selected.map(compactRecord); break;
        case "inspect_structured_data": selected = matching(this.records, args, /STRUCTURED_DATA/); data = selected.map(compactRecord); break;
        case "enumerate_categories": {
          selected = matching(this.records, args, /PRODUCT_CATEGORY|BREADCRUMB|PAGE_TYPE|LINK_CTA|NAVIGATION/);
          const products = verifiedProductRecords(this.pages, this.manifest);
          data = this.pages.filter((item) => item.pageType === "CATEGORY" || item.pageType === "COLLECTION" || item.content.productCategories.length).slice(0, args.limit).map((item) => ({ url: item.url, type: item.pageType, title: item.content.title, categories: item.content.productCategories, linkedProducts: products.filter((product) => item.content.links.some((link) => link.href === product.url)).map((product) => ({ name: product.name, url: product.canonicalUrl })) }));
          break;
        }
        case "enumerate_products": data = { verified: verifiedProductRecords(this.pages, this.manifest).slice(0, args.limit), possibleCount: possibleProductCount(this.pages, this.manifest), editorialExcluded: true }; selected = matching(this.records, args, /PRODUCT_NAME|SKU|PRICE|STRUCTURED_DATA|STOCK|BUTTON|LINK_CTA|PRODUCT_VARIATION|INTERACTIVE_STATE/); break;
        case "retrieve_product_commerce": data = verifiedProductRecords(this.pages, this.manifest).filter((product) => !args.url || product.url === args.url || product.canonicalUrl === args.url).slice(0, args.limit); selected = matching(this.records, args, /PRODUCT_NAME|SKU|PRICE|STRUCTURED_DATA|STOCK|BUTTON|LINK_CTA|PRODUCT_VARIATION|INTERACTIVE_STATE|PRODUCT_CATEGORY/); break;
        case "inspect_visual_composition":
        case "inspect_image_region":
        case "inspect_page_imagery": {
          const remaining = Math.max(0, this.budget.maxImageRegions - this.inspectedImages.size);
          selected = matching(this.records, args, /IMAGE|SCREENSHOT|VIEWPORT|FULL_PAGE|BANNER|GRAPHIC|CHECKOUT/).filter((record) => this.inspectedImages.has(record.artifactId) || remaining > 0).slice(0, remaining || args.limit);
          data = this.composition(args.url ?? selected[0]?.sourceUrl ?? this.pages[0]?.url ?? "", selected);
          break;
        }
        case "inspect_documents": {
          const remaining = Math.max(0, this.budget.maxDocuments - this.inspectedDocuments.size);
          selected = matching(this.records, args, /DOCUMENT|PDF|COA/).filter((record) => this.inspectedDocuments.has(record.artifactId) || remaining > 0).slice(0, remaining || args.limit);
          data = selected.map(compactRecord);
          break;
        }
        case "inspect_public_api": selected = matching(this.records, args, /PUBLIC_API|PUBLIC_JSON/); data = selected.map(compactRecord); break;
        case "inspect_read_only_checkout": selected = matching(this.records, args, /CHECKOUT|FORM_FIELD|OBSERVED_CONTROLS|INTERACTIVE_STATE/); data = { readOnly: true, prohibitedActions: ["submit form", "accept legal terms", "place order", "make payment", "send communication"], evidence: selected.map(compactRecord) }; break;
        case "follow_internal_links": data = page ? page.content.links.filter((link) => this.pages.some((item) => item.url === link.href) && (!args.query || `${link.text} ${link.href}`.toLowerCase().includes(args.query.toLowerCase()))).slice(0, args.limit) : []; selected = matching(this.records, args, /NAVIGATION|FOOTER|LINK_CTA/); break;
      }
      for (const record of selected) {
        this.inspectedEvidence.add(record.id);
        const pageUrl = this.pages.some((page) => page.url === record.sourceUrl) ? record.sourceUrl : record.parentUrl && this.pages.some((page) => page.url === record.parentUrl) ? record.parentUrl : record.sourceUrl;
        this.inspectedPages.add(pageUrl);
        if (record.artifactKind === "IMAGE" || record.artifactKind === "SCREENSHOT") this.inspectedImages.add(record.artifactId);
        if (record.artifactKind === "PDF" || record.artifactKind === "DOCUMENT_TEXT") this.inspectedDocuments.add(record.artifactId);
      }
      const evidenceRecordIds = selected.map((record) => record.id);
      this.calls.push({ callId, tool, arguments: args, status: "COMPLETED", evidenceRecordIds, startedAt, completedAt: new Date().toISOString() });
      return { ok: true, data, evidenceRecordIds, coverage: this.trace().coverage };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown tool failure";
      this.unresolved.add(`${tool}: ${message}`);
      this.calls.push({ callId, tool, arguments: typeof rawArguments === "object" && rawArguments ? rawArguments as Record<string, unknown> : {}, status: "FAILED", evidenceRecordIds: [], startedAt, completedAt: new Date().toISOString(), error: message });
      return { ok: false, error: message, evidenceRecordIds: [] as string[] };
    }
  }

  inspectedManifest() {
    const selected = this.records.filter((record) => this.inspectedEvidence.has(record.id));
    const fallback = selected.length ? selected : this.records.filter((record) => record.evidenceType === "PAGE_TYPE" || record.evidenceType === "TITLE").slice(0, Math.max(1, this.budget.maxPages * 2));
    return { ...this.manifest, records: fallback };
  }

  evidenceRecords(ids: string[]) {
    const wanted = new Set(ids);
    return this.records.filter((record) => wanted.has(record.id));
  }

  trace(): AgenticAuditTrace {
    const inventory = this.inventory().surfaces;
    const elapsedMs = Date.now() - this.startedAt;
    const capped = this.calls.some((call) => call.status === "BUDGET_EXHAUSTED");
    const inspectedProducts = new Set(this.calls.filter((call) => call.tool === "enumerate_products" || call.tool === "retrieve_product_commerce").flatMap((call) => call.evidenceRecordIds)).size;
    return {
      version: "orbit-agentic-audit-v1",
      plan: this.plan,
      toolCalls: [...this.calls],
      evidenceInspected: [...this.inspectedEvidence],
      unresolvedItems: [...this.unresolved],
      budget: this.budget,
      budgetUsed: { toolCalls: this.calls.length, pages: this.inspectedPages.size, imageRegions: this.inspectedImages.size, documents: this.inspectedDocuments.size, elapsedMs },
      coverage: {
        pages: coverage(inventory.pages, this.inspectedPages.size, capped || (inventory.pages >= this.budget.maxPages && this.inspectedPages.size >= this.budget.maxPages)),
        products: coverage(inventory.verifiedProducts, Math.min(inventory.verifiedProducts, inspectedProducts), capped),
        visual: coverage(inventory.retainedVisualRegions, this.inspectedImages.size, capped || this.inspectedImages.size >= this.budget.maxImageRegions && this.inspectedImages.size < inventory.retainedVisualRegions),
        documents: coverage(inventory.documents, this.inspectedDocuments.size, capped || this.inspectedDocuments.size >= this.budget.maxDocuments && this.inspectedDocuments.size < inventory.documents),
        checkout: coverage(inventory.checkoutStates, this.calls.some((call) => call.tool === "inspect_read_only_checkout" && call.status === "COMPLETED") ? inventory.checkoutStates : 0, capped),
      },
    };
  }
}

export function auditPagesFromInput(pages: Array<{ url: string; canonicalUrl?: string; httpStatus?: number; pageType: SentinelPageType; content: NormalizedContent }>): AuditPage[] {
  return pages;
}
