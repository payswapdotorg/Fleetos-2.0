/**
 * @fleetos/security — Security findings, posture, remediation proposals.
 *
 * Pure types + deterministic severity triage. Honest degradation when input
 * signals are insufficient (law A12). No I/O, no providers.
 */

/** Severity — ordered. */
export type SecuritySeverity = "info" | "low" | "medium" | "high" | "critical";

/** Finding kind — machine-stable. */
export type FindingKind =
  | "auth.weak_credential"
  | "auth.exposed_credential"
  | "auth.missing_mfa"
  | "tenant.cross_tenant_leak"
  | "tenant.isolation_gap"
  | "device.firmware_outdated"
  | "device.unmanaged"
  | "device.compromised_indicator"
  | "policy.guardian_bypass_attempt"
  | "policy.self_authorization_attempt"
  | "policy.fail_open"
  | "evidence.chain_break"
  | "evidence.missing_verification"
  | "execution.unauthorized_dispatch"
  | "network.open_ingress"
  | "supply_chain.unverified_dependency";

/** Confidence the finding is real — not the same as severity. */
export type FindingConfidence = "tentative" | "probable" | "confirmed";

export interface SecurityFinding {
  readonly findingId: string;
  readonly tenantId: string;
  readonly kind: FindingKind;
  readonly severity: SecuritySeverity;
  readonly confidence: FindingConfidence;
  readonly detectedAt: string;
  readonly assetIds: readonly string[];
  readonly description: string;
  readonly evidenceRefs: readonly string[];
  /** Stable digest over the canonical finding fields — for deduplication. */
  readonly findingDigest: string;
}

export interface SecurityPosture {
  readonly tenantId: string;
  readonly computedAt: string;
  readonly totalFindings: number;
  readonly bySeverity: Readonly<Record<SecuritySeverity, number>>;
  readonly postureScore: number; // 0..100, deterministic
  readonly degraded: boolean;
}

export interface RemediationProposal {
  readonly proposalId: string;
  readonly findingIds: readonly string[];
  readonly remediationKind: "patch" | "rotate_credential" | "isolate" | "enforce_mfa" | "revoke_authority" | "manual_review";
  readonly estimatedRiskReduction: SecuritySeverity;
  readonly requiresGuardianAuthorization: boolean;
  readonly description: string;
}

/** Triage result — machine-stable. */
export interface TriageResult {
  readonly severity: SecuritySeverity;
  readonly reasonCode: TriageReasonCode;
  readonly degraded: boolean;
}

export type TriageReasonCode =
  | "triage.confirmed_critical"
  | "triage.confirmed_high"
  | "triage.confirmed_medium"
  | "triage.confirmed_low"
  | "triage.degraded_insufficient_signals"
  | "triage.degraded_low_confidence";

const SEVERITY_RANK: readonly SecuritySeverity[] = ["info", "low", "medium", "high", "critical"];

function rank(sev: SecuritySeverity): number {
  const idx = SEVERITY_RANK.indexOf(sev);
  return idx === -1 ? -1 : idx;
}

/**
 * Deterministic severity triage.
 *
 * Law A12: if signals are insufficient, return a degraded state with
 * `degraded: true` rather than silently lowering severity.
 *
 * Rules (deterministic, no time/random):
 *  - 0 signals => degraded.
 *  - low confidence on a high/critical signal => degraded.
 *  - confirmed => severity stays as declared.
 *  - tentative => downgrade by one step (floor at info), flag degraded.
 */
export function triageSeverity(input: {
  readonly declared: SecuritySeverity;
  readonly confidence: FindingConfidence;
  readonly signalCount: number;
}): TriageResult {
  if (input.signalCount <= 0) {
    return {
      severity: "info",
      reasonCode: "triage.degraded_insufficient_signals",
      degraded: true,
    };
  }
  if (input.confidence === "tentative") {
    if (input.signalCount < 2) {
      return {
        severity: "info",
        reasonCode: "triage.degraded_low_confidence",
        degraded: true,
      };
    }
    const r = rank(input.declared);
    const downgraded = r <= 0 ? "info" : (SEVERITY_RANK[r - 1] ?? "info");
    return {
      severity: downgraded,
      reasonCode: "triage.degraded_low_confidence",
      degraded: true,
    };
  }
  switch (input.declared) {
    case "critical": return { severity: "critical", reasonCode: "triage.confirmed_critical", degraded: false };
    case "high": return { severity: "high", reasonCode: "triage.confirmed_high", degraded: false };
    case "medium": return { severity: "medium", reasonCode: "triage.confirmed_medium", degraded: false };
    case "low": return { severity: "low", reasonCode: "triage.confirmed_low", degraded: false };
    case "info": return { severity: "info", reasonCode: "triage.confirmed_low", degraded: false };
  }
}

/** Deterministic posture score — same inputs => same score. */
export function computePosture(
  tenantId: string,
  findings: readonly SecurityFinding[],
): SecurityPosture {
  const bySeverity: Record<SecuritySeverity, number> = {
    info: 0, low: 0, medium: 0, high: 0, critical: 0,
  };
  let weighted = 0;
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    weighted += rank(f.severity) * rank(f.severity); // quadratic penalty
  }
  const score = Math.max(0, 100 - Math.min(100, weighted * 2));
  return {
    tenantId,
    computedAt: "1970-01-01T00:00:00.000Z",
    totalFindings: findings.length,
    bySeverity,
    postureScore: score,
    degraded: findings.some((f) => f.confidence === "tentative"),
  };
}

/** Build a remediation proposal for a set of findings — never auto-applies. */
export function proposeRemediation(
  findings: readonly SecurityFinding[],
): RemediationProposal {
  const maxSeverity = findings.reduce<SecuritySeverity>(
    (acc, f) => (rank(f.severity) > rank(acc) ? f.severity : acc),
    "info",
  );
  const needsGuardian = rank(maxSeverity) >= rank("high");
  return {
    proposalId: `remediation-${findings.map((f) => f.findingId).sort().join("|")}`,
    findingIds: findings.map((f) => f.findingId),
    remediationKind: maxSeverity === "critical" ? "isolate" : "patch",
    estimatedRiskReduction: maxSeverity,
    requiresGuardianAuthorization: needsGuardian,
    description: `Remediate ${findings.length} findings (max severity ${maxSeverity})`,
  };
}

// ---------- Wave 1 (F210B) kernel extensions ----------

export * from "./lifecycle.ts";
export * from "./posture.ts";

// ---------- Wave 2 (F220B) operational extensions ----------

export * from "./intake.ts";
export * from "./posture-fold.ts";
export * from "./remediation.ts";
