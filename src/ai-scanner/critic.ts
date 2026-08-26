import { z } from "zod";
import type { AiFinding, AiFindingEvidence, AiEvidence } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { getServerEnv } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { logger, serializeErrorForLog } from "@/sentinel/logger";

type FindingWithEvidence = AiFinding & { evidence: Array<AiFindingEvidence & { evidence: AiEvidence }> };
const json = (value: unknown) => value as Prisma.InputJsonValue;

const criticResultSchema = z.object({
  recommendation: z.enum(["UPHOLD", "REVISE", "REJECT", "HUMAN_REVIEW"]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string().trim().min(1).max(4_000),
  disputedEvidenceIds: z.array(z.string()).max(30),
}).strict();

const criticJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["recommendation", "severity", "confidence", "explanation", "disputedEvidenceIds"],
  properties: {
    recommendation: { type: "string", enum: ["UPHOLD", "REVISE", "REJECT", "HUMAN_REVIEW"] },
    severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    explanation: { type: "string" },
    disputedEvidenceIds: { type: "array", items: { type: "string" } },
  },
} as const;

export function criticReason(finding: Pick<AiFinding, "severity" | "ambiguous" | "contradictoryEvidence" | "materiality" | "confidence">) {
  if (finding.severity === "CRITICAL") return "critical finding";
  if (finding.severity === "HIGH" && finding.ambiguous) return "materially ambiguous high finding";
  if (finding.contradictoryEvidence) return "contradictory evidence";
  if (finding.materiality === "MATERIAL" && finding.confidence < 0.7) return "low-confidence material conclusion";
  return null;
}

function outputText(response: { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("");
}

export async function runOptionalCritics(scanId: string) {
  const env = getServerEnv();
  if (!env.AI_CRITIC_MODEL || !env.OPENAI_API_KEY) return [];
  const findings = await getDatabase().aiFinding.findMany({ where: { scanId }, include: { evidence: { include: { evidence: true } } } });
  const outcomes = [];
  for (const finding of findings) {
    const reason = criticReason(finding);
    if (!reason) continue;
    const review = await getDatabase().aiCriticReview.create({ data: { scanId, findingId: finding.id, model: env.AI_CRITIC_MODEL } });
    await getDatabase().aiFinding.update({ where: { id: finding.id }, data: { criticStatus: "REQUESTED" } });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.AI_SCANNER_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, "")}/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: env.AI_CRITIC_MODEL,
          store: false,
          reasoning: { effort: "high" },
          max_output_tokens: 4_000,
          instructions: "You are a narrow dispute critic. Review only the supplied Luna finding and cited first-party evidence. Do not audit the website, add evidence, or calculate a score. Identify whether the cited evidence supports the conclusion. Return strict JSON and no private reasoning.",
          input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ escalationReason: reason, finding: criticFindingPayload(finding) }) }] }],
          text: { format: { type: "json_schema", name: "ai_scanner_critic", strict: true, schema: criticJsonSchema } },
        }),
      });
      const raw = await response.json() as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; usage?: unknown; error?: { message?: string } };
      if (!response.ok) throw new Error(raw.error?.message || `Critic returned HTTP ${response.status}`);
      const result = criticResultSchema.parse(JSON.parse(outputText(raw)));
      const disputed = new Set(result.disputedEvidenceIds);
      const available = new Set(finding.evidence.map((item) => item.evidenceId));
      if ([...disputed].some((id) => !available.has(id))) throw new Error("Critic referenced evidence outside the disputed finding");
      await getDatabase().$transaction([
        getDatabase().aiCriticReview.update({ where: { id: review.id }, data: { status: "COMPLETED", completedAt: new Date(), result: json(result), usage: json(raw.usage ?? {}) } }),
        getDatabase().aiFinding.update({ where: { id: finding.id }, data: { criticStatus: "COMPLETED", ...(result.recommendation === "UPHOLD" ? {} : { status: "NEEDS_REVIEW" }) } }),
      ]);
      outcomes.push({ findingId: finding.id, reason, result });
    } catch (error) {
      await getDatabase().$transaction([
        getDatabase().aiCriticReview.update({ where: { id: review.id }, data: { status: "FAILED", completedAt: new Date(), error: error instanceof Error ? error.message : "Critic failed" } }),
        getDatabase().aiFinding.update({ where: { id: finding.id }, data: { criticStatus: "FAILED", status: "NEEDS_REVIEW" } }),
      ]);
      logger.warn({ scanId, findingId: finding.id, error: serializeErrorForLog(error) }, "Optional AI Scanner critic failed; Luna finding retained for human review");
    } finally { clearTimeout(timer); }
  }
  return outcomes;
}

function criticFindingPayload(finding: FindingWithEvidence) {
  return {
    title: finding.title,
    severity: finding.severity,
    confidence: finding.confidence,
    materiality: finding.materiality,
    explanation: finding.explanation,
    affectedUrl: finding.affectedUrl,
    remediation: finding.remediation,
    evidence: finding.evidence.map((link) => ({
      evidenceId: link.evidenceId,
      role: link.role,
      rationale: link.rationale,
      sourceUrl: link.evidence.sourceUrl,
      kind: link.evidence.kind,
      exactText: link.evidence.exactText?.slice(0, 8_000) ?? null,
      metadata: link.evidence.metadata,
    })),
  };
}
