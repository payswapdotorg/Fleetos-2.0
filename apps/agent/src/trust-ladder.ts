/**
 * @fleetos/agent — Wave 3 trust ladder (F230A).
 *
 * The trust ladder is the agent's explicit trust level with per-level
 * capability grants. The spec requires:
 *
 *   - explicit trust levels with per-level capability grants
 *   - a low-trust agent CANNOT execute commands
 *   - trust transitions are typed with evidence requirements and refusal
 *     reasons
 *
 * Levels (ordered, ascending):
 *   1. `untrusted` — no capabilities (initial state).
 *   2. `low` — observe-only (can submit observations; cannot execute
 *      commands).
 *   3. `standard` — observe + execute routine commands.
 *   4. `elevated` — observe + execute all commands (including destructive).
 *
 * Transitions:
 *   - `untrusted -> low` requires attestation evidence.
 *   - `low -> standard` requires sustained-good-behavior evidence (a
 *     time-since-enrolled threshold + a clean-health record).
 *   - `standard -> elevated` requires operator-authorization evidence
 *     (an explicit operator token).
 *   - Downward transitions (revocation) require a typed reason and emit
 *     an audit event. Downward transitions can skip levels (e.g.,
 *     `standard -> untrusted` on a security incident).
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type { AgentIdLike, TenantIdLike } from "./agent.js";
import type { AuditEventRef } from "./kernel.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Trust levels + capabilities
// ---------------------------------------------------------------------------

export type TrustLevel = "untrusted" | "low" | "standard" | "elevated";

export const TRUST_LEVEL_ORDER: Readonly<Record<TrustLevel, number>> = {
  untrusted: 0,
  low: 1,
  standard: 2,
  elevated: 3,
};

export function trustGe(a: TrustLevel, b: TrustLevel): boolean {
  return TRUST_LEVEL_ORDER[a] >= TRUST_LEVEL_ORDER[b];
}

export type Capability =
  | "observe" // submit observations
  | "execute-routine" // execute routine (non-destructive) commands
  | "execute-destructive" // execute destructive commands (reboot, wipe, etc.)
  | "manage-trust"; // change other agents' trust levels

export const CAPABILITIES_BY_LEVEL: Readonly<Record<TrustLevel, ReadonlyArray<Capability>>> = {
  untrusted: [],
  low: ["observe"],
  standard: ["observe", "execute-routine"],
  elevated: ["observe", "execute-routine", "execute-destructive", "manage-trust"],
};

export function capabilitiesFor(level: TrustLevel): ReadonlyArray<Capability> {
  return CAPABILITIES_BY_LEVEL[level];
}

export function hasCapability(level: TrustLevel, cap: Capability): boolean {
  return CAPABILITIES_BY_LEVEL[level].includes(cap);
}

// ---------------------------------------------------------------------------
// Evidence requirements — each upward transition requires a typed set of
// evidence refs. The kernel exposes the requirement as a pure function;
// the caller supplies the evidence.
// ---------------------------------------------------------------------------

export interface EvidenceRef {
  readonly kind: string; // e.g., "attestation", "operator-authorization", "behavior-record"
  readonly digest: string; // sha-256 of the evidence payload
  readonly observedAt: number;
}

export interface EvidenceRequirement {
  readonly requiredKinds: ReadonlyArray<string>;
  readonly minCount: number;
}

export function evidenceRequirementFor(from: TrustLevel, to: TrustLevel): EvidenceRequirement | null {
  // Only UPWARD transitions have evidence requirements. Downward transitions
  // (revocations) require a reason, not evidence.
  if (!trustGe(to, from)) return null;
  if (from === to) return null;
  switch (to) {
    case "low": return { requiredKinds: ["attestation"], minCount: 1 };
    case "standard": return { requiredKinds: ["attestation", "behavior-record"], minCount: 2 };
    case "elevated": return { requiredKinds: ["attestation", "behavior-record", "operator-authorization"], minCount: 3 };
    case "untrusted": return null; // downward — no evidence required
  }
}

// ---------------------------------------------------------------------------
// Trust transitions
// ---------------------------------------------------------------------------

export interface TrustTransitionInput {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly from: TrustLevel;
  readonly to: TrustLevel;
  readonly evidence: ReadonlyArray<EvidenceRef>;
  readonly reason?: string; // required for downward transitions
  readonly at: number;
}

export type TrustTransitionRejectionCode =
  | "illegal-transition"
  | "insufficient-evidence"
  | "missing-evidence-kind"
  | "missing-reason"
  | "same-level";

export type TrustTransitionResult =
  | {
      readonly ok: true;
      readonly from: TrustLevel;
      readonly to: TrustLevel;
      readonly grantedCapabilities: ReadonlyArray<Capability>;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: TrustTransitionRejectionCode };

export function evaluateTrustTransition(input: TrustTransitionInput): TrustTransitionResult {
  if (input.from === input.to) return { ok: false, reason: "same-level" };

  const isUpward = trustGe(input.to, input.from);
  if (!isUpward) {
    // Downward transition (revocation) — requires a reason.
    if (input.reason === undefined || input.reason === "") {
      return { ok: false, reason: "missing-reason" };
    }
  } else {
    // Upward transition — check evidence requirements.
    const req = evidenceRequirementFor(input.from, input.to);
    if (req !== null) {
      if (input.evidence.length < req.minCount) {
        return { ok: false, reason: "insufficient-evidence" };
      }
      const presentKinds = new Set(input.evidence.map((e) => e.kind));
      for (const kind of req.requiredKinds) {
        if (!presentKinds.has(kind)) {
          return { ok: false, reason: "missing-evidence-kind" };
        }
      }
    }
  }

  const granted = capabilitiesFor(input.to);
  const audit: AuditEventRef = {
    actor: input.agentId,
    intent: isUpward ? `agent:trust:up:${input.from}->${input.to}` : `agent:trust:down:${input.from}->${input.to}`,
    tenant: input.tenantId,
    timestamp: input.at,
    digest: digestOf(input.agentId, input.tenantId, input.from, input.to, input.at, isUpward ? "up" : "down", input.reason ?? ""),
  };
  return { ok: true, from: input.from, to: input.to, grantedCapabilities: granted, audit };
}

// ---------------------------------------------------------------------------
// Capability gate — the canonical check the command inbox consults before
// applying a command. A low-trust agent CANNOT execute commands.
// ---------------------------------------------------------------------------

export type CapabilityGateResult =
  | { readonly ok: true; readonly level: TrustLevel; readonly granted: Capability }
  | { readonly ok: false; readonly reason: "trust-too-low"; readonly level: TrustLevel; readonly required: Capability };

export function gateCapability(
  level: TrustLevel,
  required: Capability,
): CapabilityGateResult {
  if (hasCapability(level, required)) {
    return { ok: true, level, granted: required };
  }
  return { ok: false, reason: "trust-too-low", level, required };
}

// ---------------------------------------------------------------------------
// TrustState — the agent's current trust level + transition history (bound).
// ---------------------------------------------------------------------------

export interface TrustState {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly level: TrustLevel;
  readonly establishedAt: number;
  readonly transitionCount: number;
  readonly lastTransitionAt: number;
}

export function initialTrustState(
  agentId: AgentIdLike,
  tenantId: TenantIdLike,
  at: number,
): TrustState {
  return {
    agentId,
    tenantId,
    level: "untrusted",
    establishedAt: at,
    transitionCount: 0,
    lastTransitionAt: at,
  };
}

export function applyTrustTransition(
  state: TrustState,
  result: TrustTransitionResult,
  at: number,
): TrustState {
  if (!result.ok) return state;
  return {
    ...state,
    level: result.to,
    transitionCount: state.transitionCount + 1,
    lastTransitionAt: at,
  };
}
