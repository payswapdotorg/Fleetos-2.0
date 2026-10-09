/**
 * @fleetos/assets — Wave 9 lineage versioned-method domain (F290A).
 *
 * Methods = operational/maintenance procedures with `(methodId, version)`
 * identity and parameter schemas. Method application records are bound to
 * REAL assets (validated against the assets kernel's AssetDirectory), with
 * outcomes. Deprecated versions stay READABLE (lineage is append-only
 * history) but are REFUSED for NEW applications with a REAL reason code.
 *
 * The method registry is a small in-memory store of method definitions
 * keyed by `(methodId, version)`. Method versions are dotted triples
 * `MAJOR.MINOR.PATCH` (a normalized string with no leading zeros, no "v"
 * prefix); the registry treats them as opaque strings — ordering is the
 * caller's responsibility (the deprecation path is explicit, not derived).
 *
 * Pure TypeScript, no I/O, no Date.now, no Math.random, no timers, no network.
 * Logical `now` is caller-supplied at every consequential operation.
 */

import { fnv1a32, canonicalJson } from "./digest.js";
import type { AssetId, TenantIdLike } from "../assets.js";
import type { AuditEventRef } from "../kernel-audit.js";
import { digestOf } from "../kernel-audit.js";

// ---------------------------------------------------------------------------
// Branded ids — local to the lineage method domain.
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type MethodId = Brand<string, "MethodId">;
export type MethodApplicationId = Brand<string, "MethodApplicationId">;

const METHOD_ID_RE = /^mth_[A-Za-z0-9_-]{4,128}$/;
const APPLICATION_ID_RE = /^app_[A-Za-z0-9_-]{8,128}$/;
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export const isMethodId = (v: string): v is MethodId =>
  typeof v === "string" && METHOD_ID_RE.test(v);

export const isMethodApplicationId = (v: string): v is MethodApplicationId =>
  typeof v === "string" && APPLICATION_ID_RE.test(v);

export const isMethodVersion = (v: string): boolean => VERSION_RE.test(v);

// ---------------------------------------------------------------------------
// Vocabulary — method kinds + parameter types + application outcomes.
// ---------------------------------------------------------------------------

export type MethodKind =
  | "maintenance"
  | "operation"
  | "inspection"
  | "calibration"
  | "repair"
  | "commissioning";

const METHOD_KINDS: ReadonlyArray<MethodKind> = [
  "maintenance",
  "operation",
  "inspection",
  "calibration",
  "repair",
  "commissioning",
];

export type MethodParameterType = "string" | "number" | "boolean" | "text" | "enum";

export interface MethodParameterSchema {
  readonly name: string;
  readonly type: MethodParameterType;
  readonly required: boolean;
  /** For enum: the allowed values. For others: ignored. */
  readonly enumValues?: ReadonlyArray<string>;
  /** Default value used when the parameter is omitted AND not required. */
  readonly defaultValue?: string | number | boolean | null;
}

export type MethodStatus = "active" | "deprecated";

export interface MethodDefinition {
  readonly methodId: MethodId;
  readonly version: string;
  readonly kind: MethodKind;
  readonly displayName: string;
  readonly parameterSchema: ReadonlyArray<MethodParameterSchema>;
  readonly status: MethodStatus;
  readonly createdAt: number;
  /** Set when the method is deprecated. null while active. */
  readonly deprecatedAt: number | null;
  /** Caller-supplied free-form description (provenance). */
  readonly description: string;
}

// ---------------------------------------------------------------------------
// MethodRegistry — in-memory store keyed by `${methodId}@${version}`.
// ---------------------------------------------------------------------------

export interface MethodRegistry {
  readonly byKey: ReadonlyMap<string, MethodDefinition>;
  /** byMethod: methodId → set of versions ever registered (for history reads). */
  readonly byMethod: ReadonlyMap<string, ReadonlySet<string>>;
}

export function emptyMethodRegistry(): MethodRegistry {
  return { byKey: new Map(), byMethod: new Map() };
}

export type MethodRegistrationRejectionCode =
  | "malformed-method-id"
  | "invalid-version"
  | "unknown-kind"
  | "missing-display-name"
  | "malformed-parameter-schema"
  | "duplicate-method-version"
  | "invalid-created-at";

export type MethodRegistrationResult =
  | { readonly ok: true; readonly registry: MethodRegistry; readonly method: MethodDefinition }
  | { readonly ok: false; readonly reason: MethodRegistrationRejectionCode };

function validateSchema(
  schema: ReadonlyArray<MethodParameterSchema>,
): boolean {
  if (!Array.isArray(schema)) return false;
  const seen = new Set<string>();
  for (const p of schema) {
    if (typeof p.name !== "string" || p.name === "") return false;
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    if (
      p.type !== "string" &&
      p.type !== "number" &&
      p.type !== "boolean" &&
      p.type !== "text" &&
      p.type !== "enum"
    ) {
      return false;
    }
    if (p.type === "enum") {
      if (!Array.isArray(p.enumValues) || p.enumValues.length === 0) return false;
      for (const ev of p.enumValues) {
        if (typeof ev !== "string") return false;
      }
    }
  }
  return true;
}

export function registerMethod(
  registry: MethodRegistry,
  input: {
    readonly methodId: string;
    readonly version: string;
    readonly kind: MethodKind;
    readonly displayName: string;
    readonly parameterSchema: ReadonlyArray<MethodParameterSchema>;
    readonly createdAt: number;
    readonly description?: string;
  },
): MethodRegistrationResult {
  if (!isMethodId(input.methodId)) return { ok: false, reason: "malformed-method-id" };
  if (!isMethodVersion(input.version)) return { ok: false, reason: "invalid-version" };
  if (!METHOD_KINDS.includes(input.kind)) return { ok: false, reason: "unknown-kind" };
  if (typeof input.displayName !== "string" || input.displayName === "") {
    return { ok: false, reason: "missing-display-name" };
  }
  if (!validateSchema(input.parameterSchema)) {
    return { ok: false, reason: "malformed-parameter-schema" };
  }
  if (!Number.isFinite(input.createdAt) || input.createdAt <= 0) {
    return { ok: false, reason: "invalid-created-at" };
  }
  const key = `${input.methodId}@${input.version}`;
  if (registry.byKey.has(key)) {
    return { ok: false, reason: "duplicate-method-version" };
  }
  const def: MethodDefinition = {
    methodId: input.methodId,
    version: input.version,
    kind: input.kind,
    displayName: input.displayName,
    parameterSchema: input.parameterSchema,
    status: "active",
    createdAt: input.createdAt,
    deprecatedAt: null,
    description: input.description ?? "",
  };
  const byKey = new Map(registry.byKey);
  byKey.set(key, def);
  const byMethod = new Map(registry.byMethod);
  const prior = byMethod.get(input.methodId) ?? new Set<string>();
  const nextVersions = new Set(prior);
  nextVersions.add(input.version);
  byMethod.set(input.methodId, nextVersions);
  return { ok: true, registry: { byKey, byMethod }, method: def };
}

// ---------------------------------------------------------------------------
// Deprecation — append-only history; deprecated versions stay readable.
// ---------------------------------------------------------------------------

export type MethodDeprecationRejectionCode =
  | "unknown-method"
  | "already-deprecated"
  | "stale-deprecated-at";

export type MethodDeprecationResult =
  | { readonly ok: true; readonly registry: MethodRegistry; readonly method: MethodDefinition }
  | { readonly ok: false; readonly reason: MethodDeprecationRejectionCode };

export function deprecateMethod(
  registry: MethodRegistry,
  input: {
    readonly methodId: MethodId;
    readonly version: string;
    readonly deprecatedAt: number;
  },
): MethodDeprecationResult {
  const key = `${input.methodId}@${input.version}`;
  const existing = registry.byKey.get(key);
  if (!existing) return { ok: false, reason: "unknown-method" };
  if (existing.status === "deprecated") return { ok: false, reason: "already-deprecated" };
  if (!Number.isFinite(input.deprecatedAt) || input.deprecatedAt < existing.createdAt) {
    return { ok: false, reason: "stale-deprecated-at" };
  }
  const next: MethodDefinition = {
    ...existing,
    status: "deprecated",
    deprecatedAt: input.deprecatedAt,
  };
  const byKey = new Map(registry.byKey);
  byKey.set(key, next);
  return { ok: true, registry: { byKey, byMethod: registry.byMethod }, method: next };
}

export function lookupMethod(
  registry: MethodRegistry,
  methodId: MethodId,
  version: string,
): MethodDefinition | null {
  return registry.byKey.get(`${methodId}@${version}`) ?? null;
}

// ---------------------------------------------------------------------------
// Method application — bound to REAL assets via AssetDirectoryPort.
// ---------------------------------------------------------------------------

export type MethodApplicationOutcome = "succeeded" | "failed" | "skipped";

export interface MethodApplication {
  readonly id: MethodApplicationId;
  readonly tenantId: TenantIdLike;
  readonly methodId: MethodId;
  readonly methodVersion: string;
  readonly assetId: AssetId;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly outcome: MethodApplicationOutcome;
  readonly appliedAt: number;
  readonly audit: AuditEventRef;
  /** Optional observation anchor (verified separately in anchor.ts). */
  readonly observationAnchor?: { readonly observationId: string };
  /** Deterministic digest of the application record. */
  readonly applicationDigest: string;
}

export type MethodApplicationRejectionCode =
  | "malformed-application-id"
  | "missing-tenant-id"
  | "unknown-method"
  | "method-deprecated"
  | "unknown-asset"
  | "asset-tenant-mismatch"
  | "missing-parameter"
  | "invalid-parameter-type"
  | "invalid-enum-value"
  | "invalid-applied-at";

/** Structural port — the assets kernel's `AssetDirectory.findAsset(tenantId, id)`. */
export interface AssetLookupPort {
  readonly findAsset: (
    tenantId: TenantIdLike,
    assetId: AssetId,
  ) => { readonly tenantId: TenantIdLike; readonly id: AssetId } | null;
}

export type MethodApplicationResult =
  | { readonly ok: true; readonly application: MethodApplication }
  | { readonly ok: false; readonly reason: MethodApplicationRejectionCode };

function coerceParam(
  raw: unknown,
  schema: MethodParameterSchema,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: MethodApplicationRejectionCode } {
  // Apply default if absent.
  let v = raw;
  if ((v === undefined || v === null) && schema.defaultValue !== undefined) {
    v = schema.defaultValue;
  }
  // Required check.
  if ((v === undefined || v === null) && schema.required) {
    return { ok: false, reason: "missing-parameter" };
  }
  if (v === undefined || v === null) {
    return { ok: true, value: null };
  }
  // Type check.
  switch (schema.type) {
    case "string":
    case "text":
      if (typeof v !== "string") return { ok: false, reason: "invalid-parameter-type" };
      break;
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) {
        return { ok: false, reason: "invalid-parameter-type" };
      }
      break;
    case "boolean":
      if (typeof v !== "boolean") return { ok: false, reason: "invalid-parameter-type" };
      break;
    case "enum": {
      if (typeof v !== "string") return { ok: false, reason: "invalid-parameter-type" };
      if (!schema.enumValues || !schema.enumValues.includes(v)) {
        return { ok: false, reason: "invalid-enum-value" };
      }
      break;
    }
    default:
      return { ok: false, reason: "invalid-parameter-type" };
  }
  return { ok: true, value: v };
}

export function applyMethodToAsset(
  registry: MethodRegistry,
  assetLookup: AssetLookupPort,
  input: {
    readonly applicationId: string;
    readonly tenantId: TenantIdLike;
    readonly methodId: MethodId;
    readonly methodVersion: string;
    readonly assetId: AssetId;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly outcome: MethodApplicationOutcome;
    readonly appliedAt: number;
    readonly actor: string;
    readonly observationAnchor?: { readonly observationId: string };
  },
): MethodApplicationResult {
  if (!isMethodApplicationId(input.applicationId)) {
    return { ok: false, reason: "malformed-application-id" };
  }
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    return { ok: false, reason: "missing-tenant-id" };
  }
  const method = lookupMethod(registry, input.methodId, input.methodVersion);
  if (!method) return { ok: false, reason: "unknown-method" };
  if (method.status === "deprecated") return { ok: false, reason: "method-deprecated" };
  if (!Number.isFinite(input.appliedAt) || input.appliedAt <= 0) {
    return { ok: false, reason: "invalid-applied-at" };
  }
  const asset = assetLookup.findAsset(input.tenantId, input.assetId);
  if (!asset) return { ok: false, reason: "unknown-asset" };
  if (asset.tenantId !== input.tenantId) return { ok: false, reason: "asset-tenant-mismatch" };

  // Validate parameters against the schema.
  const coerced: Record<string, unknown> = {};
  for (const p of method.parameterSchema) {
    const raw = input.parameters[p.name];
    const r = coerceParam(raw, p);
    if (!r.ok) return { ok: false, reason: r.reason };
    coerced[p.name] = r.value;
  }
  // Reject unknown parameters (fail-closed — schema is the contract).
  const knownNames = new Set(method.parameterSchema.map((p) => p.name));
  for (const k of Object.keys(input.parameters)) {
    if (!knownNames.has(k)) {
      return { ok: false, reason: "invalid-parameter-type" };
    }
  }

  const audit: AuditEventRef = {
    actor: input.actor,
    intent: "method:apply",
    tenant: input.tenantId,
    timestamp: input.appliedAt,
    digest: digestOf(input.applicationId, input.methodId, input.methodVersion, input.assetId, input.appliedAt),
  };
  const application: MethodApplication = {
    id: input.applicationId,
    tenantId: input.tenantId,
    methodId: input.methodId,
    methodVersion: input.methodVersion,
    assetId: input.assetId,
    parameters: coerced,
    outcome: input.outcome,
    appliedAt: input.appliedAt,
    audit,
    observationAnchor: input.observationAnchor,
    applicationDigest: methodApplicationDigest({
      id: input.applicationId,
      tenantId: input.tenantId,
      methodId: input.methodId,
      methodVersion: input.methodVersion,
      assetId: input.assetId,
      parameters: coerced,
      outcome: input.outcome,
      appliedAt: input.appliedAt,
      observationAnchor: input.observationAnchor,
    }),
  };
  return { ok: true, application };
}

export function methodApplicationDigest(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly assetId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly outcome: string;
  readonly appliedAt: number;
  readonly observationAnchor?: { readonly observationId: string };
}): string {
  return fnv1a32([
    "method-application",
    input.id,
    input.tenantId,
    input.methodId,
    input.methodVersion,
    input.assetId,
    input.outcome,
    input.appliedAt,
    canonicalJson(input.parameters),
    input.observationAnchor?.observationId ?? "",
  ]);
}
