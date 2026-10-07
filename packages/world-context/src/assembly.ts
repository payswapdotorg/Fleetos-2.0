/**
 * @fleetos/world-context — tenant-scoped context assembly (Wave 3, F230B).
 *
 * Given a world-state slice (entity snapshots — LOCAL structural shapes; this
 * package stays self-contained, no @fleetos imports) plus a query focus
 * (tenant, entity refs, purpose), assemble a context record: a feature
 * snapshot with provenance refs, deterministic field-level redaction, and an
 * audit digest.
 *
 * PRIVACY LAW (tenant/privacy): assembly is TENANT FAIL-CLOSED —
 *   - an empty focus tenant is rejected ("missing-tenant");
 *   - any entity snapshot from another tenant is rejected with
 *     "cross-tenant-ref" naming the offender — UI-only filtering is never
 *     enough (law: never bypass tenant checks with UI-only filtering);
 *   - field-level redaction is a DECLARATIVE redact-list per purpose,
 *     applied deterministically; redacted values are replaced with the
 *     "[REDACTED]" sentinel and the redacted field names are recorded on the
 *     context so consumers can see WHAT was hidden (not the value).
 *
 * Determinism: no clock, no randomness, no I/O. `computedAt` is
 * caller-supplied. Entity order in the input is irrelevant — entities are
 * processed in entityId order, so the digest is order-independent.
 */

import { WORLD_CONTEXT_SCHEMA_VERSION } from "./index.ts";
import type { TenantScopeLike } from "./index.ts";

// ---------------------------------------------------------------------------
// Inputs (LOCAL structural shapes — compatible with world-model views)
// ---------------------------------------------------------------------------

/**
 * A world-entity snapshot — the world-state slice assembly consumes.
 * LOCAL structural shape (this package imports no @fleetos modules).
 */
export interface WorldEntitySnapshot {
  readonly entityId: string;
  readonly entityType: "asset" | "agent" | "org";
  readonly tenantId: string;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
  readonly lastObservationRef?: string;
  readonly lastObservedAtMs?: number;
}

/** The purpose a context is assembled for — drives the redaction rule. */
export type ContextPurpose =
  | "maintenance-planning"
  | "security-review"
  | "operational-monitoring"
  | "model-input";

export interface ContextQueryFocus {
  readonly tenant: TenantScopeLike;
  readonly entities: readonly WorldEntitySnapshot[];
  readonly purpose: ContextPurpose;
}

// ---------------------------------------------------------------------------
// Declarative redaction rules
// ---------------------------------------------------------------------------

/** Redact-list: field names hidden for a purpose. Declarative + deterministic. */
export interface RedactionRule {
  readonly purpose: ContextPurpose;
  readonly redactFields: readonly string[];
}

/**
 * Default redaction policy (reference): operator-identifying fields are
 * redacted for every purpose; location additionally for security review.
 * Callers may pass their own rule list — assembly never invents rules.
 */
export const DEFAULT_REDACTION_RULES: readonly RedactionRule[] = [
  { purpose: "maintenance-planning", redactFields: ["operatorName", "operatorContact"] },
  { purpose: "security-review", redactFields: ["operatorName", "operatorContact", "location"] },
  { purpose: "operational-monitoring", redactFields: ["operatorContact"] },
  { purpose: "model-input", redactFields: ["operatorName", "operatorContact"] },
];

/** The sentinel replacing redacted values — the value never leaks. */
export const REDACTED_VALUE = "[REDACTED]" as const;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface ContextProvenanceRef {
  readonly entityId: string;
  readonly observationRef: string | null;
  readonly observedAtMs: number | null;
}

export interface AssembledContext {
  readonly schemaVersion: typeof WORLD_CONTEXT_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly purpose: ContextPurpose;
  /** Namespaced feature snapshot: `${entityId}#${field}`. */
  readonly features: Readonly<Record<string, string | number | boolean | null>>;
  readonly entityIds: readonly string[];
  readonly provenance: readonly ContextProvenanceRef[];
  /** Field names (namespaced) whose values were redacted. */
  readonly redactedFields: readonly string[];
  /** Audit digest — deterministic over the assembled (redacted) content. */
  readonly digest: string;
  readonly computedAt: string;
}

export type ContextRejection =
  | "missing-tenant"
  | "no-entities"
  | "cross-tenant-ref"
  | "unknown-purpose";

export type ContextAssemblyResult =
  | { readonly ok: true; readonly context: AssembledContext }
  | { readonly ok: false; readonly rejected: ContextRejection; readonly detail: string };

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function assembleContext(input: {
  readonly focus: ContextQueryFocus;
  readonly rules?: readonly RedactionRule[];
  readonly computedAt: string;
}): ContextAssemblyResult {
  const rules = input.rules ?? DEFAULT_REDACTION_RULES;
  const tenantId = input.focus.tenant.tenantId;
  if (tenantId === "") {
    return { ok: false, rejected: "missing-tenant", detail: "focus tenant identifier is empty" };
  }
  if (input.focus.entities.length === 0) {
    return { ok: false, rejected: "no-entities", detail: "focus contains no entity refs" };
  }
  // Tenant fail-closed: every entity must belong to the focus tenant.
  for (const entity of input.focus.entities) {
    if (entity.tenantId !== tenantId) {
      return {
        ok: false,
        rejected: "cross-tenant-ref",
        detail: `entity ${entity.entityId} belongs to tenant ${entity.tenantId}, not ${tenantId}`,
      };
    }
  }
  // Redact-list for the purpose: union of all matching rules, sorted, deduped.
  const matching = rules.filter((r) => r.purpose === input.focus.purpose);
  if (matching.length === 0) {
    return {
      ok: false,
      rejected: "unknown-purpose",
      detail: `no redaction rule covers purpose ${input.focus.purpose}`,
    };
  }
  const redactSet = new Set<string>();
  for (const rule of matching) {
    for (const field of rule.redactFields) redactSet.add(field);
  }
  const redactFields = [...redactSet].sort();

  // Deterministic assembly: entities in entityId order, fields in key order.
  const entities = [...input.focus.entities].sort((a, b) => (a.entityId < b.entityId ? -1 : 1));
  const features: Record<string, string | number | boolean | null> = {};
  const redactedFields: string[] = [];
  const provenance: ContextProvenanceRef[] = [];
  const entityIds: string[] = [];
  for (const entity of entities) {
    entityIds.push(entity.entityId);
    provenance.push({
      entityId: entity.entityId,
      observationRef: entity.lastObservationRef ?? null,
      observedAtMs: entity.lastObservedAtMs ?? null,
    });
    for (const key of Object.keys(entity.fields).sort()) {
      const namespaced = `${entity.entityId}#${key}`;
      if (redactFields.includes(key)) {
        features[namespaced] = REDACTED_VALUE;
        redactedFields.push(namespaced);
      } else {
        const value = entity.fields[key];
        features[namespaced] =
          value === undefined ? null : (value as string | number | boolean | null);
      }
    }
  }
  redactedFields.sort();

  const context: AssembledContext = {
    schemaVersion: WORLD_CONTEXT_SCHEMA_VERSION,
    tenantId,
    purpose: input.focus.purpose,
    features,
    entityIds,
    provenance,
    redactedFields,
    digest: contextDigestOf({
      tenantId,
      purpose: input.focus.purpose,
      computedAt: input.computedAt,
      entityIds,
      features,
      redactedFields,
      provenance,
    }),
    computedAt: input.computedAt,
  };
  return { ok: true, context };
}

/**
 * Recompute the audit digest of an assembled context. `true` means the
 * context is byte-consistent with its digest stamp; tampering with any
 * assembled field (features, redacted list, provenance, purpose, tenant,
 * computedAt) makes it false.
 */
export function verifyAssembledContextDigest(context: AssembledContext): boolean {
  return (
    contextDigestOf({
      tenantId: context.tenantId,
      purpose: context.purpose,
      computedAt: context.computedAt,
      entityIds: [...context.entityIds],
      features: { ...context.features },
      redactedFields: [...context.redactedFields],
      provenance: [...context.provenance],
    }) === context.digest
  );
}

// ---------------------------------------------------------------------------
// Deterministic digest (private FNV-1a, same family as the lane's others)
// ---------------------------------------------------------------------------

function contextDigestOf(parts: {
  readonly tenantId: string;
  readonly purpose: ContextPurpose;
  readonly computedAt: string;
  readonly entityIds: readonly string[];
  readonly features: Readonly<Record<string, string | number | boolean | null>>;
  readonly redactedFields: readonly string[];
  readonly provenance: readonly ContextProvenanceRef[];
}): string {
  const featureKeys = Object.keys(parts.features).sort();
  const features = featureKeys
    .map((k) => `${k}=${String(parts.features[k])}`)
    .join(",");
  const provenance = parts.provenance
    .map((p) => `${p.entityId}@${p.observationRef ?? ""}#${p.observedAtMs ?? ""}`)
    .join(",");
  return fnv1a(
    `ctx|v1|${parts.tenantId}|${parts.purpose}|${parts.computedAt}|e=${parts.entityIds.join(",")}|f=${features}|r=${parts.redactedFields.join(",")}|p=${provenance}`,
  );
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
