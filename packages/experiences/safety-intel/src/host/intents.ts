/**
 * @fleetos/experience-safety-intel — host intents (F300B deliverable 1).
 *
 * The HostSurface's intent seam: UI events (catalogued in `./contract.ts`)
 * dispatch to the lane's EXISTING inert CommandDraft builders
 * (`../command-intents.ts`). Everything the packet's inert-intent law
 * requires is preserved here:
 *
 *  - a host intent produces a `CommandDraft` — typed, inert, never executed;
 *  - there is NO submit/execute/dispatch function on this module or on the
 *    surface — binding a draft into the real control-plane submit is TL
 *    composition (machine-tested: the surface carries no such member);
 *  - a draft carries `intent.draft: true` machine-carried;
 *  - unknown event ids are refused (`intent.unknown-event`) — the catalog is
 *    the truth, and untrusted ids never fall through to a builder.
 *
 * Determinism: the dispatcher is a pure function of its input; drafts are
 * byte-identical for identical inputs (the builders' own law).
 */

import {
  proposeActionPlanStep,
  requestAdvisoryRefresh,
  requestRemediation,
} from "../command-intents.ts";
import type {
  CommandDraft,
  IntentBuildResult,
  IntentRefusalCode,
} from "../command-intents.ts";
import { SAFETY_INTEL_INTENTS as INTENT_CATALOG, isKnownIntentEvent } from "./contract.ts";
import type { HostIntentEventId } from "./contract.ts";

// ---------------------------------------------------------------------------
// The request union — eventId discriminates the builder input
// ---------------------------------------------------------------------------

/**
 * LOCAL structural mirror of the builders' intent-identity block
 * (`IntentBase` in ../command-intents.ts — module-private there, mirrored
 * here field-for-field; the builders' own validation still applies).
 */
export interface HostIntentBase {
  readonly intentId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly requiredCapabilityId: string;
  readonly reason: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
}

export interface RemediationIntentRequest extends HostIntentBase {
  readonly eventId: "security.findings.request-remediation";
  readonly proposalId: string;
  readonly findingIds: readonly string[];
  readonly remediationKind: string;
}

export interface PlanStepIntentRequest extends HostIntentBase {
  readonly eventId: "security.plans.propose-step";
  readonly planId: string;
  readonly stepId: string;
  readonly stepCapabilityId: string;
  readonly stepInputs: Readonly<Record<string, unknown>>;
}

export interface AdvisoryRefreshIntentRequest extends HostIntentBase {
  readonly eventId: "security.advisory.request-refresh";
  readonly assetId: string;
  readonly metric: string;
  readonly horizonSteps: number;
  readonly horizonStepMs: number;
}

export type HostIntentRequest =
  | RemediationIntentRequest
  | PlanStepIntentRequest
  | AdvisoryRefreshIntentRequest;

export type HostIntentRefusalCode = IntentRefusalCode | "intent.unknown-event" | "intent.missing-required-input";

export type HostIntentResult =
  | { readonly ok: true; readonly draft: CommandDraft }
  | { readonly ok: false; readonly refused: HostIntentRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------
// The dispatcher — typed + untyped (untrusted input) forms
// ---------------------------------------------------------------------------

/**
 * Build the inert CommandDraft for a catalogued UI event. PURE: the draft is
 * a value; nothing is submitted, executed, or stored.
 */
export function buildHostIntentDraft(request: HostIntentRequest): IntentBuildResult {
  switch (request.eventId) {
    case "security.findings.request-remediation":
      return requestRemediation(request);
    case "security.plans.propose-step":
      return proposeActionPlanStep(request);
    case "security.advisory.request-refresh":
      return requestAdvisoryRefresh(request);
  }
}

/**
 * Untyped form for host-shell event wiring: the event id is validated
 * against the catalog FIRST (unknown ids refused — never a fall-through),
 * then the typed dispatcher runs. The payload is UNTRUSTED input — every
 * builder validation still applies to it (fail-loud on malformed payloads).
 */
export function buildHostIntentDraftUntyped(eventId: string, payload: unknown): HostIntentResult {
  if (!isKnownIntentEvent(eventId)) {
    return {
      ok: false,
      refused: "intent.unknown-event",
      detail: `event id "${eventId}" is not in the safety-intel intent catalog`,
    };
  }
  const source = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const descriptor = INTENT_CATALOG[eventId];
  for (const key of descriptor.requiredInputs) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      return {
        ok: false,
        refused: "intent.missing-required-input",
        detail: `event "${eventId}" requires input "${key}" which the payload does not carry`,
      };
    }
  }
  // Untrusted values: cast through unknown to the builder input shape and
  // let the REAL builder validation refuse malformed values (fail-loud,
  // never fabricated). The presence check above already guaranteed the
  // catalogued keys exist; value-level validation stays in the builders.
  switch (eventId) {
    case "security.findings.request-remediation":
      return requestRemediation(
        { ...source, ...pick(source, ["proposalId", "findingIds", "remediationKind"]) } as unknown as Parameters<typeof requestRemediation>[0],
      );
    case "security.plans.propose-step":
      return proposeActionPlanStep(
        { ...source, ...pick(source, ["planId", "stepId", "stepCapabilityId", "stepInputs"]) } as unknown as Parameters<typeof proposeActionPlanStep>[0],
      );
    case "security.advisory.request-refresh":
      return requestAdvisoryRefresh(
        { ...source, ...pick(source, ["assetId", "metric", "horizonSteps", "horizonStepMs"]) } as unknown as Parameters<typeof requestAdvisoryRefresh>[0],
      );
  }
}

/** Pick the declared subset of keys from an untrusted record (absent keys stay absent). */
function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  }
  return out;
}

/** The catalogued event ids in stable order (presentation convenience). */
export function hostIntentEventIds(): readonly HostIntentEventId[] {
  return [
    "security.findings.request-remediation",
    "security.plans.propose-step",
    "security.advisory.request-refresh",
  ];
}
