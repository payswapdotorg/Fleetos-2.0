/**
 * @fleetos/external-vendors — external vendor catalog sync (Wave 5).
 *
 * Batch import of external vendor catalog entries with DEDUPE BY EXTERNAL
 * ID and capability CLAIM records (claimed → verified → expired lifecycle —
 * verification itself lives in `./verification.js`).
 *
 * - WITHIN-BATCH DEDUPE: two entries with the same external id and identical
 *   content collapse to one (counted in `duplicatesSkipped`); the same id
 *   with DIFFERENT content refuses the WHOLE batch (atomic —
 *   DUPLICATE_EXTERNAL_ID_CONFLICT).
 * - RE-IMPORT (LWW, documented): an entry with a NEWER logicalTime replaces
 *   the stored one and RESETS its capability claims to `claimed` (a fresh
 *   import is a fresh claim); an OLDER logical time is skipped as stale;
 *   equal logical time with identical content is an idempotent skip; equal
 *   logical time with different content refuses the batch (atomic).
 * - DETERMINISTIC CATALOG DIGESTS over the canonically-ordered entry set
 *   (law A19); `verifyCatalogDigest` recomputes and detects tampering.
 * - FAIL-CLOSED TENANCY throughout.
 *
 * Pure, deterministic; logical `now` is caller-supplied; inputs never mutated.
 */
import { validateTenantScope, type TenantScope } from "./tenant.js";
import { canonicalJson, fnv1a32Hex } from "./digest.js";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type CapabilityClaimState = "claimed" | "verified" | "expired";

export interface CapabilityClaim {
  readonly capability: string;
  readonly state: CapabilityClaimState;
}

export interface ExternalCatalogEntry {
  readonly externalId: string;
  readonly vendorExternalId: string;
  readonly displayName: string;
  readonly capabilities: readonly string[];
  readonly logicalTime: number;
}

export interface CatalogEntryRecord {
  readonly externalId: string;
  readonly vendorExternalId: string;
  readonly displayName: string;
  readonly capabilityClaims: readonly CapabilityClaim[];
  readonly logicalTime: number;
  readonly importedAt: number;
  readonly entryDigest: string;
}

export interface VendorCatalog {
  readonly tenant: TenantScope;
  readonly source: string;
  readonly entries: ReadonlyMap<string, CatalogEntryRecord>;
  readonly catalogDigest: string;
  readonly importCount: number;
}

export type CatalogRefusalCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "SOURCE_EMPTY"
  | "SOURCE_MISMATCH"
  | "EMPTY_BATCH"
  | "MALFORMED_CATALOG_ENTRY"
  | "DUPLICATE_EXTERNAL_ID_CONFLICT"
  | "ENTRY_LOGICAL_TIME_CONFLICT";

export type ImportResult =
  | {
      readonly ok: true;
      readonly catalog: VendorCatalog;
      readonly imported: readonly string[];
      readonly duplicatesSkipped: readonly string[];
      readonly staleSkipped: readonly string[];
    }
  | { readonly ok: false; readonly reasonCode: CatalogRefusalCode; readonly detail: string };

export type OpenCatalogResult =
  | { readonly ok: true; readonly catalog: VendorCatalog }
  | { readonly ok: false; readonly reasonCode: "TENANT_SCOPE_MISSING" | "SOURCE_EMPTY" };

// ---------------------------------------------------------------------------
// Construction + digests.
// ---------------------------------------------------------------------------

export function openVendorCatalog(tenant: TenantScope, source: string): OpenCatalogResult {
  const scope = validateTenantScope(tenant);
  if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (source.trim().length === 0) return { ok: false, reasonCode: "SOURCE_EMPTY" };
  return {
    ok: true,
    catalog: { tenant: scope.scope, source, entries: new Map(), catalogDigest: "catalog_genesis", importCount: 0 },
  };
}

export function computeEntryDigest(entry: Omit<CatalogEntryRecord, "entryDigest" | "importedAt">): string {
  const claims = [...entry.capabilityClaims]
    .map((c) => `${c.capability}:${c.state}`)
    .sort()
    .join(",");
  return fnv1a32Hex(
    "entry",
    [entry.externalId, entry.vendorExternalId, entry.displayName, String(entry.logicalTime), claims].join("\u241f"),
  );
}

export function computeCatalogDigest(catalog: Pick<VendorCatalog, "entries">): string {
  let digest = "catalog_genesis";
  const ids = [...catalog.entries.keys()].sort();
  for (const id of ids) {
    digest = fnv1a32Hex("catalog", `${digest}\u241f${id}\u241f${catalog.entries.get(id)?.entryDigest ?? ""}`);
  }
  return digest;
}

export function verifyCatalogDigest(catalog: VendorCatalog): { ok: boolean; expected: string } {
  for (const entry of catalog.entries.values()) {
    const recomputed = computeEntryDigest(entry);
    if (recomputed !== entry.entryDigest) return { ok: false, expected: "entry-integrity" };
  }
  const expected = computeCatalogDigest(catalog);
  return { ok: expected === catalog.catalogDigest, expected };
}

export function findEntry(
  catalog: VendorCatalog,
  tenant: TenantScope,
  externalId: string,
): CatalogEntryRecord | null {
  const scope = validateTenantScope(tenant);
  if (!scope.ok) return null;
  if (catalog.tenant.tenantId !== scope.scope.tenantId) return null; // fail-closed, no leak
  return catalog.entries.get(externalId) ?? null;
}

// ---------------------------------------------------------------------------
// Batch import.
// ---------------------------------------------------------------------------

export function importCatalogBatch(
  catalog: VendorCatalog,
  entries: readonly ExternalCatalogEntry[],
  now: number,
): ImportResult {
  const catalogTenant = validateTenantScope(catalog.tenant);
  if (!catalogTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "catalog tenant invalid" };
  if (!Number.isInteger(now) || now < 0) {
    return { ok: false, reasonCode: "MALFORMED_CATALOG_ENTRY", detail: "now is not a non-negative integer" };
  }
  if (entries.length === 0) {
    return { ok: false, reasonCode: "EMPTY_BATCH", detail: "batch carries no entries" };
  }

  // Structural validation + within-batch dedupe by external id (atomic).
  const seenContent = new Map<string, string>();
  const ordered: ExternalCatalogEntry[] = [];
  const batchDuplicates: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === null || typeof entry !== "object") {
      return { ok: false, reasonCode: "MALFORMED_CATALOG_ENTRY", detail: `entry at index ${String(i)} is malformed` };
    }
    if (
      typeof entry.externalId !== "string" ||
      entry.externalId.trim().length === 0 ||
      typeof entry.vendorExternalId !== "string" ||
      entry.vendorExternalId.trim().length === 0 ||
      typeof entry.displayName !== "string" ||
      entry.displayName.trim().length === 0
    ) {
      return { ok: false, reasonCode: "MALFORMED_CATALOG_ENTRY", detail: `entry at index ${String(i)} has empty ids or name` };
    }
    if (!Number.isInteger(entry.logicalTime) || entry.logicalTime < 0) {
      return {
        ok: false,
        reasonCode: "MALFORMED_CATALOG_ENTRY",
        detail: `entry "${entry.externalId}" has invalid logicalTime ${String(entry.logicalTime)}`,
      };
    }
    const capabilities = [...new Set(entry.capabilities.filter((c) => typeof c === "string" && c.trim().length > 0))].sort();
    if (capabilities.length !== entry.capabilities.length) {
      return {
        ok: false,
        reasonCode: "MALFORMED_CATALOG_ENTRY",
        detail: `entry "${entry.externalId}" carries empty/duplicate capability codes`,
      };
    }
    const content = canonicalJson({ ...entry, capabilities });
    const prior = seenContent.get(entry.externalId);
    if (prior !== undefined && prior !== content) {
      return {
        ok: false,
        reasonCode: "DUPLICATE_EXTERNAL_ID_CONFLICT",
        detail: `externalId "${entry.externalId}" carries two different payloads in one batch`,
      };
    }
    if (prior === undefined) {
      seenContent.set(entry.externalId, content);
      ordered.push({ ...entry, capabilities });
    } else {
      // Identical content (conflicting content refused above): dedupe.
      batchDuplicates.push(entry.externalId);
    }
  }

  const next = new Map(catalog.entries);
  const imported: string[] = [];
  const duplicatesSkipped: string[] = [];
  const staleSkipped: string[] = [];
  for (const entry of ordered) {
    const current = next.get(entry.externalId);
    const claims: CapabilityClaim[] = entry.capabilities.map((capability) => ({ capability, state: "claimed" }));
    const draft = {
      externalId: entry.externalId,
      vendorExternalId: entry.vendorExternalId,
      displayName: entry.displayName,
      capabilityClaims: claims,
      logicalTime: entry.logicalTime,
    };
    if (current === undefined) {
      next.set(entry.externalId, { ...draft, importedAt: now, entryDigest: computeEntryDigest(draft) });
      imported.push(entry.externalId);
      continue;
    }
    if (entry.logicalTime > current.logicalTime) {
      next.set(entry.externalId, { ...draft, importedAt: now, entryDigest: computeEntryDigest(draft) });
      imported.push(entry.externalId);
      continue;
    }
    if (entry.logicalTime < current.logicalTime) {
      staleSkipped.push(entry.externalId);
      continue;
    }
    if (computeEntryDigest(draft) === current.entryDigest) {
      duplicatesSkipped.push(entry.externalId);
      continue;
    }
    return {
      ok: false,
      reasonCode: "ENTRY_LOGICAL_TIME_CONFLICT",
      detail: `entry "${entry.externalId}" re-imported at equal logical time with different content`,
    };
  }

  const updated: Omit<VendorCatalog, "catalogDigest"> = {
    tenant: catalog.tenant,
    source: catalog.source,
    entries: next,
    importCount: catalog.importCount + 1,
  };
  return {
    ok: true,
    catalog: { ...updated, catalogDigest: computeCatalogDigest({ entries: next }) },
    imported,
    duplicatesSkipped: [...batchDuplicates, ...duplicatesSkipped],
    staleSkipped,
  };
}
