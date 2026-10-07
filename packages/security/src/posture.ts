/**
 * @fleetos/security — Posture aggregation (worst-wins, honest unknown).
 *
 * The posture score is "worst-wins" — the most severe open finding determines
 * the posture. If there are unknown/insufficient-signal findings, the posture
 * is honestly "degraded" (unknown).
 *
 * Law A12: honest degradation — unknown is reported, not silently lowered.
 *
 * Pure types + pure functions.
 */

import type { SecurityFinding, SecuritySeverity, SecurityPosture } from "./index.ts";
import { isEffectivelyOpen } from "./lifecycle.ts";
import type { FindingWithLifecycle } from "./lifecycle.ts";

const SEVERITY_RANK: readonly SecuritySeverity[] = ["info", "low", "medium", "high", "critical"];

function rank(sev: SecuritySeverity): number {
  const idx = SEVERITY_RANK.indexOf(sev);
  return idx === -1 ? -1 : idx;
}

/**
 * Worst-wins posture aggregation.
 *
 * The posture score is determined by the worst (highest-severity) OPEN finding.
 * Suppressed findings are excluded from the score. If any finding has
 * insufficient confidence (tentative), the posture is honestly "degraded".
 *
 * Law A12: honest degradation — unknown is reported.
 */
export function computePostureWorstWins(
  tenantId: string,
  findings: readonly FindingWithLifecycle[],
  computedAt: string = "1970-01-01T00:00:00.000Z",
): SecurityPosture {
  const openFindings = findings.filter(isEffectivelyOpen);
  const bySeverity: Record<SecuritySeverity, number> = {
    info: 0, low: 0, medium: 0, high: 0, critical: 0,
  };

  let worstRank = -1;
  let hasTentative = false;

  for (const fwl of openFindings) {
    const f = fwl.finding;
    bySeverity[f.severity] += 1;
    if (rank(f.severity) > worstRank) worstRank = rank(f.severity);
    if (f.confidence === "tentative") hasTentative = true;
  }

  // Score: 100 if no open findings; drops sharply as worst severity increases.
  let score: number;
  if (worstRank === -1) {
    score = 100; // no open findings
  } else {
    // 100 - (worstRank+1) * 20 => critical=0, high=20, medium=40, low=60, info=80
    score = Math.max(0, 100 - (worstRank + 1) * 20);
  }

  return {
    tenantId,
    computedAt,
    totalFindings: openFindings.length,
    bySeverity,
    postureScore: score,
    degraded: hasTentative, // honest unknown
  };
}

/**
 * Honest unknown posture — when all findings are tentative or there are no
 * confirmed findings at all.
 *
 * Returns a posture with degraded=true and score that reflects uncertainty.
 */
export function honestUnknownPosture(
  tenantId: string,
  findings: readonly SecurityFinding[],
  computedAt: string = "1970-01-01T00:00:00.000Z",
): SecurityPosture {
  const bySeverity: Record<SecuritySeverity, number> = {
    info: 0, low: 0, medium: 0, high: 0, critical: 0,
  };
  for (const f of findings) bySeverity[f.severity] += 1;

  const allTentative = findings.length > 0 && findings.every((f) => f.confidence === "tentative");

  return {
    tenantId,
    computedAt,
    totalFindings: findings.length,
    bySeverity,
    postureScore: allTentative ? 50 : 100, // unknown => 50 (middle), none => 100
    degraded: allTentative, // honest unknown
  };
}
