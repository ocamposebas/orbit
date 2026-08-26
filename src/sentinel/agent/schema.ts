import { z } from "zod";

export const lunaAuditToolNames = [
  "record_investigation_plan",
  "discover_urls",
  "open_rendered_page",
  "inspect_visible_text",
  "inspect_dom_structure",
  "inspect_headings",
  "inspect_navigation_footer",
  "inspect_metadata",
  "inspect_open_graph",
  "inspect_structured_data",
  "enumerate_categories",
  "inspect_category_collection",
  "enumerate_products",
  "inspect_product",
  "inspect_product_variations",
  "inspect_product_sku",
  "inspect_product_price_inventory",
  "inspect_product_cta",
  "retrieve_product_commerce",
  "inspect_link_destination",
  "inspect_visual_composition",
  "inspect_image_region",
  "inspect_page_imagery",
  "capture_full_page_screenshot",
  "capture_viewport",
  "capture_dom_element",
  "inspect_carousel_slider",
  "inspect_css_background_images",
  "inspect_product_category_imagery",
  "inspect_image_pixels",
  "read_image_text",
  "inspect_documents",
  "inspect_pdf_document",
  "inspect_public_api",
  "inspect_read_only_checkout",
  "inspect_safe_public_cart_checkout",
  "follow_internal_links",
] as const;

export type LunaAuditToolName = (typeof lunaAuditToolNames)[number];

export const auditBudgetSchema = z.object({
  maxAuditTimeMs: z.number().int().positive(),
  maxToolCalls: z.number().int().positive(),
  maxPages: z.number().int().positive(),
  maxImageRegions: z.number().int().positive(),
  maxDocuments: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  maxCostUsd: z.number().nonnegative(),
}).strict();

export type AuditBudget = z.infer<typeof auditBudgetSchema>;

export const investigationPlanSchema = z.object({
  objective: z.string().trim().min(1).max(2_000),
  steps: z.array(z.string().trim().min(1).max(1_000)).min(1).max(30),
  priorities: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();

export type InvestigationPlan = z.infer<typeof investigationPlanSchema>;

export interface AuditToolCallTrace {
  callId: string;
  tool: LunaAuditToolName;
  arguments: Record<string, unknown>;
  status: "COMPLETED" | "FAILED" | "BUDGET_EXHAUSTED";
  evidenceRecordIds: string[];
  startedAt: string;
  completedAt: string;
  error?: string;
}

export interface AgenticAuditTrace {
  version: "orbit-agentic-audit-v1";
  plan: InvestigationPlan | null;
  toolCalls: AuditToolCallTrace[];
  evidenceInspected: string[];
  unresolvedItems: string[];
  budget: AuditBudget;
  budgetUsed: { toolCalls: number; pages: number; imageRegions: number; documents: number; elapsedMs: number };
  surfaceCounts: {
    urlsDiscovered: number;
    pagesOpened: number;
    pagesSemanticallyReviewed: number;
    visualRegionsReviewed: number;
    imagesReviewed: number;
    categoriesInvestigated: number;
    productsDiscovered: number;
    productsVerifierConfirmed: number;
    productsInvestigated: number;
    documentsInspected: number;
    checkoutStatesInspected: number;
    lunaToolCalls: number;
  };
  coverage: Record<string, { discovered: number; inspected: number; percent: number | null; complete: boolean; capped: boolean }>;
}
