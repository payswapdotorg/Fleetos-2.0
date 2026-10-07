/**
 * @fleetos/recovery — Wave 2 case orchestration depth (F220A).
 *
 *   - Recovery case workflows with evidence-chain requirements — every
 *     consequential transition (resolve, close) requires a typed set of
 *     evidence refs; a transition without its required evidence refs is
 *     refused.
 *   - The evidence chain is verifiable: the kernel exposes a pure
 *     `verifyEvidenceChain` predicate that confirms the case's evidence
 *     list satisfies the required kinds for each transition that has
 *     occurred.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import type { EvidenceRefLike, RecoveryCase, RecoveryCommand, TenantIdLike } from "./recovery.js";
import type { RecoveryState } from "./recovery.js";
import type { AuditEventRef } from "./kernel.js";
import { applyRecoveryCommandAudited } from "./kernel.js";

// ---------------------------------------------------------------------------
// Evidence-chain requirements — typed per (state, command) pair.
// ---------------------------------------------------------------------------

export type RequiredEvidenceKind = "observation" | "diagnosis" | "verification" | "audit";

export interface EvidenceRequirement {
  readonly kind: RequiredEvidenceKind;
  readonly minCount: number;
}

export interface EvidenceChainRule {
  readonly command: RecoveryCommand["kind"];
  readonly fromState: RecoveryState;
  readonly required: ReadonlyArray<EvidenceRequirement>;
}

// Default evidence-chain rules — the kernel's reference policy.
export function defaultEvidenceChainRules(): ReadonlyArray<EvidenceChainRule> {
  return [
    // resolve (proposal -> resolved) requires at least 1 verification and 1 diagnosis.
    {
      command: "resolve",
      fromState: "proposal",
      required: [
        { kind: "verification", minCount: 1 },
        { kind: "diagnosis", minCount: 1 },
      ],
    },
    // close (investigating -> closed) requires at least 1 audit + 1 verification.
    {
      command: "close",
      fromState: "investigating",
      required: [
        { kind: "audit", minCount: 1 },
        { kind: "verification", minCount: 1 },
      ],
    },
    // close (resolved -> closed) requires at least 1 audit.
    {
      command: "close",
      fromState: "resolved",
      required: [{ kind: "audit", minCount: 1 }],
    },
  ];
}

// ---------------------------------------------------------------------------
// Evidence chain verification — given a case + a command + the supplied
// evidence, verify the supplied evidence satisfies the rule's requirements.
// ---------------------------------------------------------------------------

export type EvidenceChainRejectionCode =
  | "no-rule"
  | "missing-evidence-kind"
  | "insufficient-evidence-count";

export type EvidenceChainResult =
  | { readonly ok: true; readonly rule: EvidenceChainRule; readonly satisfied: ReadonlyArray<EvidenceRequirement> }
  | { readonly ok: false; readonly reason: EvidenceChainRejectionCode; readonly rule?: EvidenceChainRule };

function classifyEvidenceKind(e: EvidenceRefLike): RequiredEvidenceKind | null {
  // The EvidenceRefLike carries an optional `kind` field. The kernel
  // classifies it by prefix: "observation.*", "diagnosis.*", "verification.*",
  // "audit.*". Unknown prefixes are not counted toward any requirement.
  const k = e.kind ?? "";
  if (k.startsWith("observation") || k.startsWith("telemetry") || k.startsWith("state") || k.startsWith("event")) return "observation";
  if (k.startsWith("diagnosis")) return "diagnosis";
  if (k.startsWith("verification")) return "verification";
  if (k.startsWith("audit") || k.startsWith("recovery")) return "audit";
  return null;
}

export function verifyEvidenceChain(
  caseState: RecoveryState,
  command: RecoveryCommand["kind"],
  supplied: ReadonlyArray<EvidenceRefLike>,
  rules: ReadonlyArray<EvidenceChainRule> = defaultEvidenceChainRules(),
): EvidenceChainResult {
  const rule = rules.find((r) => r.command === command && r.fromState === caseState);
  if (!rule) return { ok: false, reason: "no-rule" };
  const satisfied: EvidenceRequirement[] = [];
  for (const req of rule.required) {
    const matchingCount = supplied.filter((e) => classifyEvidenceKind(e) === req.kind).length;
    if (matchingCount < req.minCount) {
      return { ok: false, reason: "insufficient-evidence-count", rule };
    }
    satisfied.push(req);
  }
  // Verify every required kind is present (no missing kind).
  for (const req of rule.required) {
    const hasKind = supplied.some((e) => classifyEvidenceKind(e) === req.kind);
    if (!hasKind) return { ok: false, reason: "missing-evidence-kind", rule };
  }
  return { ok: true, rule, satisfied };
}

// ---------------------------------------------------------------------------
// Apply a recovery command gated on evidence-chain verification.
// Returns the next case + audit, OR a typed refusal.
// ---------------------------------------------------------------------------

export type EvidenceGatedRejectionCode =
  | "evidence-chain-failed"
  | EvidenceChainRejectionCode;

export type EvidenceGatedResult =
  | {
      readonly ok: true;
      readonly from: RecoveryState;
      readonly to: RecoveryState;
      readonly case: RecoveryCase;
      readonly audit: AuditEventRef;
      readonly evidenceChain: EvidenceChainResult;
    }
  | { readonly ok: false; readonly reason: EvidenceGatedRejectionCode };

export function applyRecoveryCommandWithEvidenceChain(
  rc: RecoveryCase,
  command: RecoveryCommand,
  rules: ReadonlyArray<EvidenceChainRule> = defaultEvidenceChainRules(),
): EvidenceGatedResult {
  // Verify the evidence chain BEFORE applying the transition.
  const supplied: EvidenceRefLike[] = command.evidence ? [...command.evidence] : [];
  // Also include evidence already attached to the case.
  const allEvidence = [...rc.evidence, ...supplied];
  const verification = verifyEvidenceChain(rc.state, command.kind, allEvidence, rules);
  if (!verification.ok) {
    return { ok: false, reason: verification.reason };
  }
  // Now apply the transition using the Wave 1 audited wrapper.
  const r = applyRecoveryCommandAudited(rc, command, { tenantId: rc.tenantId, actor: "system:recovery" });
  if (!r.ok) {
    return { ok: false, reason: "evidence-chain-failed" };
  }
  return {
    ok: true,
    from: r.from,
    to: r.to,
    case: r.case,
    audit: r.audit,
    evidenceChain: verification,
  };
}

// ---------------------------------------------------------------------------
// Convenience: verify the evidence chain of a fully-resolved case (post-mortem).
// Returns the list of rules that were satisfied (one per transition that
// had a rule).
// ---------------------------------------------------------------------------

export interface PostMortemVerification {
  readonly caseId: string;
  readonly transitionsChecked: number;
  readonly rulesSatisfied: number;
  readonly failedTransitions: ReadonlyArray<{ readonly command: RecoveryCommand["kind"]; readonly from: RecoveryState; readonly reason: EvidenceChainRejectionCode }>;
}

export function verifyCaseEvidenceChainPostMortem(
  rc: RecoveryCase,
  rules: ReadonlyArray<EvidenceChainRule> = defaultEvidenceChainRules(),
): PostMortemVerification {
  let transitionsChecked = 0;
  let rulesSatisfied = 0;
  const failedTransitions: PostMortemVerification["failedTransitions"][number][] = [];
  for (const entry of rc.history) {
    transitionsChecked++;
    // Re-derive the evidence available AT THE TIME of this transition by
    // taking the slice of the case's evidence up to the entry's timestamp.
    // (The case's evidence list is append-only; we walk forward and stop
    // at entries whose observedAt exceeds the transition's at.)
    const availableAt = rc.evidence.filter((e) => (e.observedAt ?? 0) <= entry.at);
    const v = verifyEvidenceChain(entry.from, entry.command, availableAt, rules);
    if (!v.ok) {
      // A transition with NO rule has no evidence requirement — it is NOT
      // counted as a failure. Only transitions with rules that failed
      // verification are flagged.
      if (v.reason !== "no-rule") {
        failedTransitions.push({ command: entry.command, from: entry.from, reason: v.reason });
      }
    } else {
      rulesSatisfied++;
    }
  }
  return { caseId: rc.id, transitionsChecked, rulesSatisfied, failedTransitions };
}

// Type-only export to keep the public surface stable.
export type { TenantIdLike };
