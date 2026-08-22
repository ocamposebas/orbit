import { normalizeForHash, splitSentences } from "@/sentinel/extraction/normalize";
import { analyzeClaim } from "./semantic";

export interface DiffPart { type: "equal" | "added" | "removed"; text: string }
export interface SmartDiff { parts: DiffPart[]; additions: string[]; removals: string[]; summary: string; riskImpact: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE" }

export function smartDiff(before: string, after: string): SmartDiff {
  const left = splitSentences(normalizeForHash(before));
  const right = splitSentences(normalizeForHash(after));
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const parts: DiffPart[] = [];
  let i = 0; let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { parts.push({ type: "equal", text: left[i] }); i++; j++; }
    else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) { parts.push({ type: "added", text: right[j++] }); }
    else { parts.push({ type: "removed", text: left[i++] }); }
  }
  const additions = parts.filter((part) => part.type === "added").map((part) => part.text);
  const removals = parts.filter((part) => part.type === "removed").map((part) => part.text);
  const semanticRisk = additions.map(analyzeClaim).reduce((highest, item) => Math.max(highest, item.risk === "critical" ? 4 : item.risk === "high" ? 3 : item.risk === "medium" ? 2 : item.risk === "low" ? 1 : 0), 0);
  const riskImpact = (["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const)[semanticRisk];
  return { parts, additions, removals, summary: `${additions.length} sentence${additions.length === 1 ? "" : "s"} added, ${removals.length} removed.`, riskImpact };
}
