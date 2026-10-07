/**
 * @fleetos/model-gateway — the model REGISTRY (F230C, Wave 3 lane C).
 *
 * Model descriptors: id, provider, capability tags, cost per usage unit
 * in INTEGER minor units, context limit in units. Registry validation is
 * deterministic with machine-stable reason codes.
 *
 * Laws: A7 (provider neutrality — descriptors name a providerId but no
 * provider SDK type leaks), A12 (deterministic reference path),
 * A20 (no cross-boundary imports). Pure deterministic TS.
 */

// ---------------------------------------------------------------------------
// Model descriptors.
// ---------------------------------------------------------------------------

export interface ModelDescriptor {
  readonly id: string;
  readonly providerId: string;
  readonly capabilityTags: readonly string[];
  /** Cost per usage unit, integer minor units (e.g. cents). */
  readonly costPerUnitMinor: number;
  /** Maximum context in usage units (tokens). */
  readonly maxContextUnits: number;
}

export type RegistryReasonCode =
  | "REGISTRY_EMPTY"
  | "MODEL_ID_EMPTY"
  | "MODEL_ID_DUPLICATED"
  | "PROVIDER_ID_EMPTY"
  | "CAPABILITY_TAGS_EMPTY"
  | "CAPABILITY_TAG_DUPLICATED"
  | "NEGATIVE_COST"
  | "NON_INTEGER_COST"
  | "NEGATIVE_CONTEXT"
  | "NON_INTEGER_CONTEXT";

export type RegistryValidation =
  | { readonly ok: true; readonly models: readonly ModelDescriptor[] }
  | {
      readonly ok: false;
      readonly reasonCode: RegistryReasonCode;
      readonly modelId: string | null;
      readonly detail: string | null;
    };

/**
 * Validate a model registry: non-empty, unique model ids, non-empty
 * provider ids, non-empty + duplicate-free capability tags, non-negative
 * INTEGER cost (minor units) and context. Pure; no mutation.
 */
export function validateModelRegistry(models: readonly ModelDescriptor[]): RegistryValidation {
  if (!Array.isArray(models) || models.length === 0) {
    return { ok: false, reasonCode: "REGISTRY_EMPTY", modelId: null, detail: null };
  }
  const seenIds = new Set<string>();
  for (const model of models) {
    if (typeof model.id !== "string" || model.id.length === 0) {
      return { ok: false, reasonCode: "MODEL_ID_EMPTY", modelId: null, detail: null };
    }
    if (seenIds.has(model.id)) {
      return { ok: false, reasonCode: "MODEL_ID_DUPLICATED", modelId: model.id, detail: null };
    }
    seenIds.add(model.id);
    if (typeof model.providerId !== "string" || model.providerId.length === 0) {
      return { ok: false, reasonCode: "PROVIDER_ID_EMPTY", modelId: model.id, detail: null };
    }
    if (!Array.isArray(model.capabilityTags) || model.capabilityTags.length === 0) {
      return { ok: false, reasonCode: "CAPABILITY_TAGS_EMPTY", modelId: model.id, detail: null };
    }
    const dupTag = firstDuplicate(model.capabilityTags);
    if (dupTag !== null) {
      return { ok: false, reasonCode: "CAPABILITY_TAG_DUPLICATED", modelId: model.id, detail: dupTag };
    }
    if (!Number.isInteger(model.costPerUnitMinor)) {
      return { ok: false, reasonCode: "NON_INTEGER_COST", modelId: model.id, detail: null };
    }
    if (model.costPerUnitMinor < 0) {
      return { ok: false, reasonCode: "NEGATIVE_COST", modelId: model.id, detail: null };
    }
    if (!Number.isInteger(model.maxContextUnits)) {
      return { ok: false, reasonCode: "NON_INTEGER_CONTEXT", modelId: model.id, detail: null };
    }
    if (model.maxContextUnits < 0) {
      return { ok: false, reasonCode: "NEGATIVE_CONTEXT", modelId: model.id, detail: null };
    }
  }
  return { ok: true, models };
}

/** Deterministic lookup by exact id (null when absent). Pure. */
export function findModelById(
  registry: readonly ModelDescriptor[],
  modelId: string,
): ModelDescriptor | null {
  for (const model of registry) {
    if (model.id === modelId) return model;
  }
  return null;
}

/**
 * Deterministic capability query: models having ALL the required tags,
 * sorted lexically by model id (input order never leaks). Pure.
 */
export function findModelsByCapabilities(
  registry: readonly ModelDescriptor[],
  required: readonly string[],
): readonly ModelDescriptor[] {
  const requiredSet = new Set(required);
  return registry
    .filter((model) => {
      const tags = new Set(model.capabilityTags);
      for (const tag of requiredSet) {
        if (!tags.has(tag)) return false;
      }
      return true;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function firstDuplicate(items: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) return item;
    seen.add(item);
  }
  return null;
}
