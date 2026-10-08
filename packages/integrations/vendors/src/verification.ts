/**
 * @fleetos/external-vendors — capability verification workflow (Wave 5).
 *
 * Evidence-referenced verification records over catalog capability claims:
 *   - `verifyCapability` moves a claim claimed → verified and REQUIRES a
 *     same-tenant evidence ref (verification never self-attests — law A5:
 *     the evidence context is worker B's lane; here it is a structural ref).
 *   - EXPIRY CLASSIFICATION BY LOGICAL TIME: `classifyVerificationExpiry`
 *     is a pure read (active vs expired at a caller-supplied `now`);
 *     `expireDueVerifications` enforces it on the catalog + registry.
 *   - REVOCATION: `revokeVerification` moves a verified record to revoked
 *     with a required reason and forces the claim to `expired`. It returns
 *     a `RevocationNotice` for propagation to dependent vendor KPI rollups
 *     (`applyRevocationToMetrics` in `./scorecards.js` — fail-closed, no
 *     partial rollups; the notice itself never executes anything).
 *
 * Pure, deterministic, tenant fail-closed; logical times are caller-supplied.
 */
import { validateTenantScope, type TenantScope } from "./tenant.js";
import { fnv1a32Hex } from "./digest.js";
import { computeCatalogDigest, computeEntryDigest, type VendorCatalog } from "./catalog-sync.js";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface VerificationEvidenceRef {
  readonly evidenceId: string;
  readonly tenantId: string;
}

export type VerificationRecordState = "verified" | "expired" | "revoked";

export interface VerificationRecord {
  readonly externalId: string;
  readonly capability: string;
  readonly tenant: TenantScope;
  readonly evidence: VerificationEvidenceRef;
  readonly verifiedAt: number;
  readonly expiresAt: number;
  readonly state: VerificationRecordState;
  readonly revokedReason: string | null;
  readonly digest: string;
}

export interface VerificationRegistry {
  readonly tenant: TenantScope;
  readonly records: ReadonlyMap<string, VerificationRecord>; // key: externalId::capability
}

export type VerificationRefusalCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "CATALOG_ENTRY_UNKNOWN"
  | "CAPABILITY_NOT_CLAIMED"
  | "ALREADY_VERIFIED"
  | "CLAIM_EXPIRED"
  | "VERIFICATION_RECORD_UNKNOWN"
  | "VERIFICATION_RECORD_REVOKED"
  | "VERIFICATION_ALREADY_EXPIRED"
  | "VERIFICATION_EVIDENCE_REQUIRED"
  | "EVIDENCE_TENANT_MISMATCH"
  | "EVIDENCE_ID_EMPTY"
  | "EXPIRY_NOT_AFTER_VERIFICATION"
  | "REVOCATION_REASON_REQUIRED"
  | "LOGICAL_TIME_INVALID";

export type VerifyResult =
  | { readonly ok: true; readonly catalog: VendorCatalog; readonly registry: VerificationRegistry; readonly record: VerificationRecord }
  | { readonly ok: false; readonly reasonCode: VerificationRefusalCode; readonly detail: string };

export type RevokeResult =
  | { readonly ok: true; readonly catalog: VendorCatalog; readonly registry: VerificationRegistry; readonly notice: RevocationNotice }
  | { readonly ok: false; readonly reasonCode: VerificationRefusalCode; readonly detail: string };

export type ExpireResult =
  | { readonly ok: true; readonly catalog: VendorCatalog; readonly registry: VerificationRegistry; readonly expired: readonly string[] }
  | { readonly ok: false; readonly reasonCode: VerificationRefusalCode; readonly detail: string };

/** Inert data consumed by `applyRevocationToMetrics` — never executes anything. */
export interface RevocationNotice {
  readonly kind: "revocation-notice";
  readonly tenant: TenantScope;
  readonly externalId: string;
  readonly capability: string;
  readonly revokedAt: number;
  readonly reason: string;
}

export type ExpiryClassification = "active" | "expired";

// ---------------------------------------------------------------------------
// Registry construction + digests.
// ---------------------------------------------------------------------------

export type OpenRegistryResult =
  | { readonly ok: true; readonly registry: VerificationRegistry }
  | { readonly ok: false; reasonCode: "TENANT_SCOPE_MISSING" };

export function openVerificationRegistry(tenant: TenantScope): OpenRegistryResult {
  const scope = validateTenantScope(tenant);
  if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  return { ok: true, registry: { tenant: scope.scope, records: new Map() } };
}

export function verificationKey(externalId: string, capability: string): string {
  return `${externalId}::${capability}`;
}

export function computeVerificationDigest(record: Omit<VerificationRecord, "digest">): string {
  return fnv1a32Hex(
    "verify",
    [
      record.tenant.tenantId,
      record.externalId,
      record.capability,
      record.evidence.evidenceId,
      String(record.verifiedAt),
      String(record.expiresAt),
      record.state,
      record.revokedReason ?? "",
    ].join("\u241f"),
  );
}

export function findVerification(
  registry: VerificationRegistry,
  tenant: TenantScope,
  externalId: string,
  capability: string,
): VerificationRecord | null {
  const scope = validateTenantScope(tenant);
  if (!scope.ok) return null;
  if (registry.tenant.tenantId !== scope.scope.tenantId) return null; // fail-closed, no leak
  return registry.records.get(verificationKey(externalId, capability)) ?? null;
}

// ---------------------------------------------------------------------------
// verifyCapability — claimed → verified (evidence-referenced).
// ---------------------------------------------------------------------------

export interface VerifyCapabilityInput {
  readonly tenant: TenantScope;
  readonly externalId: string;
  readonly capability: string;
  readonly evidence: VerificationEvidenceRef | null;
  readonly verifiedAt: number;
  readonly expiresAt: number;
}

export function verifyCapability(
  catalog: VendorCatalog,
  registry: VerificationRegistry,
  input: VerifyCapabilityInput,
): VerifyResult {
  const catalogTenant = validateTenantScope(catalog.tenant);
  const registryTenant = validateTenantScope(registry.tenant);
  const inputTenant = validateTenantScope(input.tenant);
  if (!catalogTenant.ok || !registryTenant.ok || !inputTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  }
  if (catalogTenant.scope.tenantId !== inputTenant.scope.tenantId || registryTenant.scope.tenantId !== inputTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "catalog/registry tenant differs from the verifying tenant" };
  }
  if (input.evidence === null || typeof input.evidence !== "object") {
    return { ok: false, reasonCode: "VERIFICATION_EVIDENCE_REQUIRED", detail: "verification requires an evidence ref" };
  }
  if (typeof input.evidence.evidenceId !== "string" || input.evidence.evidenceId.trim().length === 0) {
    return { ok: false, reasonCode: "EVIDENCE_ID_EMPTY", detail: "evidenceId is empty" };
  }
  if (input.evidence.tenantId !== inputTenant.scope.tenantId) {
    return { ok: false, reasonCode: "EVIDENCE_TENANT_MISMATCH", detail: "evidence belongs to another tenant" };
  }
  if (!Number.isInteger(input.verifiedAt) || input.verifiedAt < 0 || !Number.isInteger(input.expiresAt)) {
    return { ok: false, reasonCode: "LOGICAL_TIME_INVALID", detail: "verifiedAt/expiresAt must be integers" };
  }
  if (input.expiresAt <= input.verifiedAt) {
    return { ok: false, reasonCode: "EXPIRY_NOT_AFTER_VERIFICATION", detail: "expiresAt must be strictly after verifiedAt" };
  }
  const entry = catalog.entries.get(input.externalId);
  if (entry === undefined) {
    return { ok: false, reasonCode: "CATALOG_ENTRY_UNKNOWN", detail: `no catalog entry "${input.externalId}"` };
  }
  const claim = entry.capabilityClaims.find((c) => c.capability === input.capability);
  if (claim === undefined) {
    return { ok: false, reasonCode: "CAPABILITY_NOT_CLAIMED", detail: `capability "${input.capability}" is not claimed by "${input.externalId}"` };
  }
  if (claim.state === "verified") return { ok: false, reasonCode: "ALREADY_VERIFIED", detail: "claim is already verified" };
  if (claim.state === "expired") return { ok: false, reasonCode: "CLAIM_EXPIRED", detail: "claim is expired — re-import to re-claim" };

  const recordDraft = {
    externalId: input.externalId,
    capability: input.capability,
    tenant: inputTenant.scope,
    evidence: input.evidence,
    verifiedAt: input.verifiedAt,
    expiresAt: input.expiresAt,
    state: "verified" as VerificationRecordState,
    revokedReason: null,
  };
  const record: VerificationRecord = { ...recordDraft, digest: computeVerificationDigest(recordDraft) };
  const claims = entry.capabilityClaims.map((c) => (c.capability === input.capability ? { ...c, state: "verified" as const } : c));
  const entries = new Map(catalog.entries);
  entries.set(input.externalId, {
    ...entry,
    capabilityClaims: claims,
    entryDigest: computeEntryDigest({
      externalId: entry.externalId,
      vendorExternalId: entry.vendorExternalId,
      displayName: entry.displayName,
      capabilityClaims: claims,
      logicalTime: entry.logicalTime,
    }),
  });
  const updatedCatalog: VendorCatalog = {
    ...catalog,
    entries,
    catalogDigest: computeCatalogDigest({ entries }),
  };
  const records = new Map(registry.records);
  records.set(verificationKey(input.externalId, input.capability), record);
  return { ok: true, catalog: updatedCatalog, registry: { tenant: registry.tenant, records }, record };
}

// ---------------------------------------------------------------------------
// Expiry classification by logical time.
// ---------------------------------------------------------------------------

export function classifyVerificationExpiry(
  registry: VerificationRegistry,
  now: number,
): readonly { readonly externalId: string; readonly capability: string; readonly classification: ExpiryClassification }[] {
  const out: { externalId: string; capability: string; classification: ExpiryClassification }[] = [];
  for (const record of registry.records.values()) {
    if (record.state === "revoked") continue;
    out.push({
      externalId: record.externalId,
      capability: record.capability,
      classification: now >= record.expiresAt ? "expired" : "active",
    });
  }
  return out.sort((a, b) => (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : a.capability < b.capability ? -1 : 1));
}

export function expireDueVerifications(
  catalog: VendorCatalog,
  registry: VerificationRegistry,
  now: number,
): ExpireResult {
  const catalogTenant = validateTenantScope(catalog.tenant);
  const registryTenant = validateTenantScope(registry.tenant);
  if (!catalogTenant.ok || !registryTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  }
  if (catalogTenant.scope.tenantId !== registryTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "catalog and registry tenants differ" };
  }
  if (!Number.isInteger(now) || now < 0) {
    return { ok: false, reasonCode: "LOGICAL_TIME_INVALID", detail: "now is not a non-negative integer" };
  }
  const records = new Map(registry.records);
  const entries = new Map(catalog.entries);
  const expiredKeys: string[] = [];
  for (const [key, record] of registry.records) {
    if (record.state !== "verified" || now < record.expiresAt) continue;
    const draft = { ...record, state: "expired" as VerificationRecordState };
    records.set(key, { ...draft, digest: computeVerificationDigest(draft) });
    expiredKeys.push(key);
    const entry = entries.get(record.externalId);
    if (entry === undefined) continue;
    const claims = entry.capabilityClaims.map((c) => (c.capability === record.capability ? { ...c, state: "expired" as const } : c));
    entries.set(record.externalId, {
      ...entry,
      capabilityClaims: claims,
      entryDigest: computeEntryDigest({
        externalId: entry.externalId,
        vendorExternalId: entry.vendorExternalId,
        displayName: entry.displayName,
        capabilityClaims: claims,
        logicalTime: entry.logicalTime,
      }),
    });
  }
  const updatedCatalog: VendorCatalog = { ...catalog, entries, catalogDigest: computeCatalogDigest({ entries }) };
  return {
    ok: true,
    catalog: updatedCatalog,
    registry: { tenant: registry.tenant, records },
    expired: expiredKeys.sort(),
  };
}

// ---------------------------------------------------------------------------
// Revocation — returns an inert notice for KPI-rollup propagation.
// ---------------------------------------------------------------------------

export interface RevokeInput {
  readonly tenant: TenantScope;
  readonly externalId: string;
  readonly capability: string;
  readonly reason: string;
}

export function revokeVerification(
  catalog: VendorCatalog,
  registry: VerificationRegistry,
  input: RevokeInput,
  now: number,
): RevokeResult {
  const catalogTenant = validateTenantScope(catalog.tenant);
  const registryTenant = validateTenantScope(registry.tenant);
  const inputTenant = validateTenantScope(input.tenant);
  if (!catalogTenant.ok || !registryTenant.ok || !inputTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  }
  if (catalogTenant.scope.tenantId !== inputTenant.scope.tenantId || registryTenant.scope.tenantId !== inputTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "catalog/registry tenant differs from the revoking tenant" };
  }
  if (input.reason.trim().length === 0) {
    return { ok: false, reasonCode: "REVOCATION_REASON_REQUIRED", detail: "revocation reason is required" };
  }
  if (!Number.isInteger(now) || now < 0) {
    return { ok: false, reasonCode: "LOGICAL_TIME_INVALID", detail: "now is not a non-negative integer" };
  }
  const record = registry.records.get(verificationKey(input.externalId, input.capability));
  if (record === undefined) {
    return { ok: false, reasonCode: "VERIFICATION_RECORD_UNKNOWN", detail: "no verification record for the pair" };
  }
  if (record.state === "revoked") return { ok: false, reasonCode: "VERIFICATION_RECORD_REVOKED", detail: "already revoked" };
  if (record.state === "expired") return { ok: false, reasonCode: "VERIFICATION_ALREADY_EXPIRED", detail: "already expired" };

  const draft = { ...record, state: "revoked" as VerificationRecordState, revokedReason: input.reason };
  const records = new Map(registry.records);
  records.set(verificationKey(input.externalId, input.capability), { ...draft, digest: computeVerificationDigest(draft) });
  const entries = new Map(catalog.entries);
  const entry = entries.get(input.externalId);
  if (entry !== undefined) {
    const claims = entry.capabilityClaims.map((c) => (c.capability === input.capability ? { ...c, state: "expired" as const } : c));
    entries.set(input.externalId, {
      ...entry,
      capabilityClaims: claims,
      entryDigest: computeEntryDigest({
        externalId: entry.externalId,
        vendorExternalId: entry.vendorExternalId,
        displayName: entry.displayName,
        capabilityClaims: claims,
        logicalTime: entry.logicalTime,
      }),
    });
  }
  const updatedCatalog: VendorCatalog = { ...catalog, entries, catalogDigest: computeCatalogDigest({ entries }) };
  return {
    ok: true,
    catalog: updatedCatalog,
    registry: { tenant: registry.tenant, records },
    notice: {
      kind: "revocation-notice",
      tenant: inputTenant.scope,
      externalId: input.externalId,
      capability: input.capability,
      revokedAt: now,
      reason: input.reason,
    },
  };
}
