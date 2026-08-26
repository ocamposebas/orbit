import { z } from "zod";

export const lunaAuditToolNames = [
  "record_investigation_plan",
  "discover_urls",
  "open_rendered_page",
  "inspect_visible_text",
  "inspect_dom_structure",
  "inspect_metadata",
  "inspect_structured_data",
  "enumerate_categories",
  "enumerate_products",
  "retrieve_product_commerce",
  "inspect_visual_composition",
  "inspect_image_region",
  "inspect_page_imagery",
  "inspect_documents",
  "inspect_public_api",
  "inspect_read_only_checkout",
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
  coverage: Record<string, { discovered: number; inspected: number; percent: number | null; complete: boolean; capped: boolean }>;
}
