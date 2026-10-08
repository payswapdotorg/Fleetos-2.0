/**
 * @fleetos/adcos — Wave 5 session trust seam (F250A).
 *
 * LOCAL STRUCTURAL mirror of the F230A trust ladder
 * (apps/agent/src/trust-ladder.ts). This package CANNOT import
 * `@fleetos/agent` (cross-package law), so the ladder vocabulary is
 * mirrored here as structural types with identical semantics:
 *
 *   untrusted  — no capabilities
 *   low        — observe only (CANNOT execute commands)
 *   standard   — observe + execute-routine
 *   elevated   — observe + execute-routine + execute-destructive + manage-trust
 *
 * Upward transitions require typed evidence; downward transitions
 * require a reason. TL adjudication: converge this mirror with the
 * canonical ladder type (see docs/evidence/F250A §seams).
 *
 * Pure deterministic TypeScript.
 */

export type SessionTrustLevel = "untrusted" | "low" | "standard" | "elevated";

export type SessionTrustCapability =
  | "observe"
  | "execute-routine"
  | "execute-destructive"
  | "manage-trust";

export const SESSION_TRUST_CAPABILITIES: Readonly<
  Record<SessionTrustLevel, ReadonlyArray<SessionTrustCapability>>
> = {
  untrusted: [],
  low: ["observe"],
  standard: ["observe", "execute-routine"],
  elevated: ["observe", "execute-routine", "execute-destructive", "manage-trust"],
};

export const SESSION_TRUST_ORDER: Readonly<Record<SessionTrustLevel, number>> = {
  untrusted: 0,
  low: 1,
  standard: 2,
  elevated: 3,
};

export function sessionHasCapability(
  level: SessionTrustLevel,
  capability: SessionTrustCapability,
): boolean {
  return SESSION_TRUST_CAPABILITIES[level].includes(capability);
}

export type SessionTrustGateResult =
  | { readonly ok: true; readonly level: SessionTrustLevel }
  | {
      readonly ok: false;
      readonly reason: "trust-too-low";
      readonly level: SessionTrustLevel;
      readonly required: SessionTrustCapability;
    };

export function gateSessionCapability(
  level: SessionTrustLevel,
  required: SessionTrustCapability,
): SessionTrustGateResult {
  if (sessionHasCapability(level, required)) return { ok: true, level };
  return { ok: false, reason: "trust-too-low", level, required };
}

/** Evidence reference (structural — kind + digest + observedAt). */
export interface SessionEvidenceRef {
  readonly kind: string; // "attestation" | "behavior-record" | "operator-authorization"
  readonly digest: string;
  readonly observedAt: number;
}

export interface SessionEvidenceRequirement {
  readonly requiredKinds: ReadonlyArray<string>;
  readonly minCount: number;
}

/** Evidence requirements per TARGET level (upward only; null = downward). */
export function sessionEvidenceRequirement(
  to: SessionTrustLevel,
): SessionEvidenceRequirement | null {
  switch (to) {
    case "low": return { requiredKinds: ["attestation"], minCount: 1 };
    case "standard": return { requiredKinds: ["attestation", "behavior-record"], minCount: 2 };
    case "elevated":
      return {
        requiredKinds: ["attestation", "behavior-record", "operator-authorization"],
        minCount: 3,
      };
    case "untrusted": return null; // downward — reason required, not evidence
  }
}

export type SessionTrustTransitionRejectionCode =
  | "same-level"
  | "insufficient-evidence"
  | "missing-evidence-kind"
  | "missing-reason";

/**
 * Validate a trust transition (evidence for upward, reason for downward).
 * Pure; returns a typed refusal or null when the transition is admissible.
 */
export function evaluateSessionTrustTransition(
  from: SessionTrustLevel,
  to: SessionTrustLevel,
  evidence: ReadonlyArray<SessionEvidenceRef>,
  reason: string | undefined,
): SessionTrustTransitionRejectionCode | null {
  if (from === to) return "same-level";
  const upward = SESSION_TRUST_ORDER[to] > SESSION_TRUST_ORDER[from];
  if (upward) {
    const req = sessionEvidenceRequirement(to);
    if (req !== null) {
      if (evidence.length < req.minCount) return "insufficient-evidence";
      const kinds = new Set(evidence.map((e) => e.kind));
      for (const kind of req.requiredKinds) {
        if (!kinds.has(kind)) return "missing-evidence-kind";
      }
    }
    return null;
  }
  if (reason === undefined || reason === "") return "missing-reason";
  return null;
}
