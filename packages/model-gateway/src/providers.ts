/**
 * @fleetos/model-gateway — provider fallback chains + degraded-mode
 * classification (F230C, Wave 3 lane C).
 *
 * Provider records declare their models and a health state. The fallback
 * ladder resolution walks the DECLARED order (primary → secondary →
 * tertiary → …) and records a reason code at EVERY hop — selected,
 * skipped-down, skipped-model-missing, not-attempted. Degraded mode is
 * classified deterministically over provider health: full / partial /
 * emergency-only.
 *
 * Laws: A7 (provider neutrality — records are adapters-level data, no SDK
 * types), A12 (deterministic reference path), A19 (digest-stamped).
 * Pure deterministic TS.
 */

import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// Provider records.
// ---------------------------------------------------------------------------

export type ProviderHealthState = "healthy" | "degraded" | "down";

export interface ProviderRecord {
  readonly id: string;
  /** Model ids this provider declares it can serve. */
  readonly declaredModels: readonly string[];
  readonly health: ProviderHealthState;
}

export type ProviderRecordReasonCode =
  | "PROVIDER_ID_EMPTY"
  | "PROVIDER_ID_DUPLICATED"
  | "DECLARED_MODELS_EMPTY"
  | "DECLARED_MODEL_DUPLICATED"
  | "DECLARED_MODEL_EMPTY";

export type ProviderRegistryValidation =
  | { readonly ok: true; readonly providers: readonly ProviderRecord[] }
  | { readonly ok: false; readonly reasonCode: ProviderRecordReasonCode; readonly providerId: string | null };

/** Deterministic validation of provider records. Pure. */
export function validateProviderRecords(
  providers: readonly ProviderRecord[],
): ProviderRegistryValidation {
  const seen = new Set<string>();
  for (const provider of providers) {
    if (typeof provider.id !== "string" || provider.id.length === 0) {
      return { ok: false, reasonCode: "PROVIDER_ID_EMPTY", providerId: null };
    }
    if (seen.has(provider.id)) {
      return { ok: false, reasonCode: "PROVIDER_ID_DUPLICATED", providerId: provider.id };
    }
    seen.add(provider.id);
    if (!Array.isArray(provider.declaredModels) || provider.declaredModels.length === 0) {
      return { ok: false, reasonCode: "DECLARED_MODELS_EMPTY", providerId: provider.id };
    }
    const models = new Set<string>();
    for (const modelId of provider.declaredModels) {
      if (typeof modelId !== "string" || modelId.length === 0) {
        return { ok: false, reasonCode: "DECLARED_MODEL_EMPTY", providerId: provider.id };
      }
      if (models.has(modelId)) {
        return { ok: false, reasonCode: "DECLARED_MODEL_DUPLICATED", providerId: provider.id };
      }
      models.add(modelId);
    }
  }
  return { ok: true, providers };
}

// ---------------------------------------------------------------------------
// Fallback ladder resolution.
// ---------------------------------------------------------------------------

export type FallbackHopReasonCode =
  | "SELECTED"
  | "PROVIDER_DOWN"
  | "PROVIDER_MISSING_MODEL"
  | "NOT_ATTEMPTED"
  | "UNKNOWN_PROVIDER";

export interface FallbackHop {
  readonly rank: number;
  readonly providerId: string;
  readonly health: ProviderHealthState | null;
  readonly reasonCode: FallbackHopReasonCode;
}

export interface FallbackResolution {
  readonly ok: boolean;
  readonly selectedProviderId: string | null;
  readonly reasonCode: "LADDER_EMPTY" | "NO_PROVIDER_CAN_SERVE" | null;
  readonly hops: readonly FallbackHop[];
  readonly digest: string;
}

/**
 * Resolve the fallback ladder for one model over an ordered provider
 * chain. The FIRST provider that is not down AND declares the model is
 * SELECTED; every earlier hop records why it was skipped; every later
 * hop records NOT_ATTEMPTED. Deterministic: identical inputs → identical
 * ladder and digest. Pure.
 */
export function resolveFallbackLadder(
  providers: readonly ProviderRecord[],
  chainOrder: readonly string[],
  modelId: string,
): FallbackResolution {
  if (chainOrder.length === 0) {
    return {
      ok: false,
      selectedProviderId: null,
      reasonCode: "LADDER_EMPTY",
      hops: [],
      digest: computeLadderDigest(chainOrder, modelId, "LADDER_EMPTY"),
    };
  }
  const byId = new Map(providers.map((p) => [p.id, p]));
  const hops: FallbackHop[] = [];
  let selected: string | null = null;
  for (let i = 0; i < chainOrder.length; i++) {
    const providerId = chainOrder[i] as string;
    const provider = byId.get(providerId);
    if (provider === undefined) {
      hops.push({ rank: i + 1, providerId, health: null, reasonCode: "UNKNOWN_PROVIDER" });
      continue;
    }
    if (selected !== null) {
      hops.push({ rank: i + 1, providerId, health: provider.health, reasonCode: "NOT_ATTEMPTED" });
      continue;
    }
    if (provider.health === "down") {
      hops.push({ rank: i + 1, providerId, health: provider.health, reasonCode: "PROVIDER_DOWN" });
      continue;
    }
    if (!provider.declaredModels.includes(modelId)) {
      hops.push({ rank: i + 1, providerId, health: provider.health, reasonCode: "PROVIDER_MISSING_MODEL" });
      continue;
    }
    selected = provider.id;
    hops.push({ rank: i + 1, providerId, health: provider.health, reasonCode: "SELECTED" });
  }
  if (selected === null) {
    return {
      ok: false,
      selectedProviderId: null,
      reasonCode: "NO_PROVIDER_CAN_SERVE",
      hops,
      digest: computeLadderDigest(chainOrder, modelId, "NO_PROVIDER_CAN_SERVE"),
    };
  }
  return {
    ok: true,
    selectedProviderId: selected,
    reasonCode: null,
    hops,
    digest: computeLadderDigest(chainOrder, modelId, selected),
  };
}

function computeLadderDigest(chainOrder: readonly string[], modelId: string, result: string): string {
  return `mladder_${fnv1a32([chainOrder.join(","), modelId, result])}`;
}

// ---------------------------------------------------------------------------
// Degraded-mode classification: full → partial → emergency-only.
// ---------------------------------------------------------------------------

export type DegradedMode = "full" | "partial" | "emergency-only";

export interface DegradedModeClassification {
  readonly mode: DegradedMode;
  readonly healthyProviders: number;
  readonly degradedProviders: number;
  readonly downProviders: number;
  readonly servingProviders: number;
  readonly digest: string;
}

/**
 * Classify the gateway's degraded mode over provider health:
 *   full          — every provider healthy;
 *   partial       — at least one healthy AND at least one not;
 *   emergency-only — NO healthy provider; serving continues only through
 *                   degraded providers (servingProviders may be 0 when
 *                   everything is down — the classification stays honest).
 * Empty input is emergency-only with 0 serving providers. Deterministic,
 * pure; digest-stamped (law A19).
 */
export function classifyDegradedMode(
  providers: readonly ProviderRecord[],
): DegradedModeClassification {
  let healthy = 0;
  let degraded = 0;
  let down = 0;
  for (const provider of providers) {
    if (provider.health === "healthy") healthy++;
    else if (provider.health === "degraded") degraded++;
    else down++;
  }
  let mode: DegradedMode;
  if (providers.length > 0 && healthy === providers.length) {
    mode = "full";
  } else if (healthy > 0) {
    mode = "partial";
  } else {
    mode = "emergency-only";
  }
  const serving = healthy + degraded;
  return {
    mode,
    healthyProviders: healthy,
    degradedProviders: degraded,
    downProviders: down,
    servingProviders: serving,
    digest: computeDegradedDigest(providers, mode),
  };
}

function computeDegradedDigest(providers: readonly ProviderRecord[], mode: DegradedMode): string {
  const healthParts = providers.map((p) => `${p.id}=${p.health}`).sort().join(";");
  return `mdegrade_${fnv1a32([healthParts, mode])}`;
}
