/**
 * @fleetos/adcos — Wave 2 provider-degradation honesty (F220A).
 *
 *   - Provider-degradation posture: the kernel exposes a typed contract
 *     for the ADCOS provider's honest posture. A provider that has had
 *     N consecutive failures is marked "degraded"; one that has been
 *     unreachable for longer than the dead threshold is "unavailable".
 *     The kernel never reports "online" when it doesn't know.
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import type { AdcosHealth } from "./adcos.js";

// ---------------------------------------------------------------------------
// Provider degradation tracking — counts consecutive successes/failures.
// ---------------------------------------------------------------------------

export interface ProviderPostureState {
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
}

export function emptyProviderPosture(): ProviderPostureState {
  return {
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
  };
}

export type ProviderPosture = "healthy" | "degraded" | "unavailable";

export interface ProviderPostureThresholds {
  readonly degradedAfterFailures: number;
  readonly unavailableAfterFailures: number;
}

export function defaultPostureThresholds(): ProviderPostureThresholds {
  return { degradedAfterFailures: 2, unavailableAfterFailures: 5 };
}

export function classifyPosture(
  state: ProviderPostureState,
  thresholds: ProviderPostureThresholds,
  now: number,
  unavailableAfterMs: number = 60_000,
): ProviderPosture {
  if (state.consecutiveFailures >= thresholds.unavailableAfterFailures) return "unavailable";
  if (state.lastSuccessAt !== null && now - state.lastSuccessAt > unavailableAfterMs && state.lastFailureAt !== null) {
    return "unavailable";
  }
  if (state.consecutiveFailures >= thresholds.degradedAfterFailures) return "degraded";
  return "healthy";
}

export function recordSuccess(state: ProviderPostureState, at: number): ProviderPostureState {
  return {
    consecutiveFailures: 0,
    consecutiveSuccesses: state.consecutiveSuccesses + 1,
    lastSuccessAt: at,
    lastFailureAt: state.lastFailureAt,
  };
}

export function recordFailure(state: ProviderPostureState, at: number): ProviderPostureState {
  return {
    consecutiveFailures: state.consecutiveFailures + 1,
    consecutiveSuccesses: 0,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: at,
  };
}

// ---------------------------------------------------------------------------
// Honest health posture — translate the provider posture into the ADCOS
// health vocabulary, never exaggerating.
// ---------------------------------------------------------------------------

export function honestAdcosHealth(posture: ProviderPosture): AdcosHealth {
  switch (posture) {
    case "healthy": return "healthy";
    case "degraded": return "degraded";
    case "unavailable": return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// Circuit-breaker contract — when the provider is unavailable, the kernel
// refuses to dispatch commands (returning a typed refusal rather than
// attempting the call).
// ---------------------------------------------------------------------------

export type CircuitBreakerDecision =
  | { readonly ok: true; readonly posture: ProviderPosture }
  | { readonly ok: false; readonly reason: "circuit-open"; readonly posture: ProviderPosture };

export function circuitBreakerDecide(
  posture: ProviderPosture,
): CircuitBreakerDecision {
  if (posture === "unavailable") {
    return { ok: false, reason: "circuit-open", posture };
  }
  return { ok: true, posture };
}
