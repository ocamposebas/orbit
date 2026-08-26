import type { ServerEnv } from "@/sentinel/config";
import { logger, sanitizeLogText, serializeErrorForLog } from "@/sentinel/logger";

export type AgenticFailureStage = "configuration" | "orchestrator_start" | "agent_request" | "agent_invariant" | "tool_execution" | "final_review";

type AgenticRuntimeEnv = Pick<ServerEnv, "AI_PROVIDER" | "AI_REVIEW_MODEL" | "AI_API_KEY" | "DUAL_REVIEW_MODE">;

export interface AgenticRuntimeSelection {
  mode: ServerEnv["DUAL_REVIEW_MODE"];
  model: string;
  enabled: boolean;
  enforced: boolean;
  available: boolean;
  fallbackAllowed: boolean;
  reason: "DUAL_REVIEW_MODE_OFF" | "AI_PROVIDER_NOT_OPENAI_COMPATIBLE" | "AI_API_KEY_MISSING" | null;
}

export interface AgenticFailureFields {
  errorName: string;
  message: string;
  stack: string | null;
  httpStatus: number | null;
  openaiRequestId: string | null;
  openaiCode: string | null;
  openaiType: string | null;
  agentStage: AgenticFailureStage;
  toolName: string | null;
}

type ErrorDetails = {
  originalError?: unknown;
  httpStatus?: unknown;
  openaiRequestId?: unknown;
  requestId?: unknown;
  openaiCode?: unknown;
  openaiErrorCode?: unknown;
  openaiType?: unknown;
  openaiErrorType?: unknown;
  agentStage?: unknown;
  toolName?: unknown;
};

export class AgenticConfigurationError extends Error {
  readonly agentStage = "configuration" as const;

  constructor(message: string) {
    super(message);
    this.name = "AgenticConfigurationError";
  }
}

function stringField(...values: unknown[]) {
  const value = values.find((item) => typeof item === "string" && item.length > 0);
  return typeof value === "string" ? sanitizeLogText(value) : null;
}

function numberField(...values: unknown[]) {
  const value = values.find((item) => typeof item === "number" && Number.isFinite(item));
  return typeof value === "number" ? value : null;
}

export function selectAgenticRuntime(env: AgenticRuntimeEnv): AgenticRuntimeSelection {
  const enforced = env.DUAL_REVIEW_MODE === "enforced";
  const fallbackAllowed = !enforced;
  if (env.DUAL_REVIEW_MODE === "off") return { mode: env.DUAL_REVIEW_MODE, model: env.AI_REVIEW_MODEL, enabled: false, enforced, available: false, fallbackAllowed, reason: "DUAL_REVIEW_MODE_OFF" };
  if (env.AI_PROVIDER !== "openai-compatible") return { mode: env.DUAL_REVIEW_MODE, model: env.AI_REVIEW_MODEL, enabled: false, enforced, available: false, fallbackAllowed, reason: "AI_PROVIDER_NOT_OPENAI_COMPATIBLE" };
  if (!env.AI_API_KEY) return { mode: env.DUAL_REVIEW_MODE, model: env.AI_REVIEW_MODEL, enabled: true, enforced, available: false, fallbackAllowed, reason: "AI_API_KEY_MISSING" };
  return { mode: env.DUAL_REVIEW_MODE, model: env.AI_REVIEW_MODEL, enabled: true, enforced, available: true, fallbackAllowed, reason: null };
}

export function agenticFailureLogFields(error: unknown, fallbackStage: AgenticFailureStage, toolName?: string): AgenticFailureFields {
  const wrapper = typeof error === "object" && error ? error as ErrorDetails : {};
  const source = wrapper.originalError ?? error;
  const details = typeof source === "object" && source ? source as ErrorDetails : {};
  const serialized = serializeErrorForLog(source);
  const stage = stringField(wrapper.agentStage, details.agentStage, fallbackStage) as AgenticFailureStage;
  return {
    errorName: serialized.name,
    message: serialized.message,
    stack: serialized.stack ?? null,
    httpStatus: numberField(wrapper.httpStatus, details.httpStatus),
    openaiRequestId: stringField(wrapper.openaiRequestId, wrapper.requestId, details.openaiRequestId, details.requestId),
    openaiCode: stringField(wrapper.openaiCode, wrapper.openaiErrorCode, details.openaiCode, details.openaiErrorCode),
    openaiType: stringField(wrapper.openaiType, wrapper.openaiErrorType, details.openaiType, details.openaiErrorType),
    agentStage: stage,
    toolName: stringField(toolName, wrapper.toolName, details.toolName),
  };
}

export type AgenticTransitionStatus = "DISABLED" | "COMPLETED" | "FALLBACK_CONFIGURED" | "AGENTIC_REVIEW_FAILED";

export async function runAgenticTransition<T>(input: {
  scanId: string;
  selection: AgenticRuntimeSelection;
  invoke?: () => Promise<T>;
}): Promise<{ status: AgenticTransitionStatus; result?: T; failure?: AgenticFailureFields; error?: unknown }> {
  const context = { scanId: input.scanId, dualReviewMode: input.selection.mode, lunaModel: input.selection.model };
  if (!input.selection.available || !input.invoke) {
    const reason = input.selection.reason ?? "LUNA_REVIEWER_NOT_CONSTRUCTED";
    if (input.selection.enforced) {
      const failure = agenticFailureLogFields(new AgenticConfigurationError(`Agentic Sentinel cannot start: ${reason}.`), "configuration");
      logger.error({ ...context, fallbackReason: reason, agenticFailure: failure }, "Agentic Sentinel startup failed");
      return { status: "AGENTIC_REVIEW_FAILED", failure };
    }
    logger.warn({ ...context, fallbackReason: reason }, "Agentic Sentinel fallback selected by configuration");
    return { status: input.selection.mode === "off" ? "DISABLED" : "FALLBACK_CONFIGURED" };
  }

  logger.info({ ...context }, "Agentic Sentinel enabled");
  try {
    const result = await input.invoke();
    return { status: "COMPLETED", result };
  } catch (error) {
    const failure = agenticFailureLogFields(error, "orchestrator_start");
    if (input.selection.fallbackAllowed) {
      logger.error({ ...context, fallbackReason: failure.message, agenticFailure: failure }, "Agentic Sentinel failed; explicit shadow-mode fallback selected");
      return { status: "FALLBACK_CONFIGURED", failure, error };
    }
    logger.error({ ...context, fallbackReason: null, agenticFailure: failure }, "Agentic Sentinel failed; fallback prohibited in enforced mode");
    return { status: "AGENTIC_REVIEW_FAILED", failure, error };
  }
}
