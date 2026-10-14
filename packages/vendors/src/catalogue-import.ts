/**
 * @fleetos/vendors — The manually-operated catalogue import seam (F361C,
 * Wave 17 lane C; the F360 freeze §3.3, mission §4).
 *
 * PLAINLY LABELLED: this is a MANUALLY-OPERATED, OPERATOR-REVIEWED
 * catalogue import. The label constant below travels onto every batch
 * result and every entry — `MANUAL_CATALOGUE_IMPORT_LABEL`. A "live
 * supplier API" source kind is deliberately UNREPRESENTABLE in the
 * type: this seam NEVER claims live-API connectivity. The freeze
 * sanctions exactly this manual seam as the pilot's first supplier
 * catalogue path; the live-pilot gate stays BLOCKED on F369 (real
 * supplier acquisition).
 *
 * Documented laws (machine-tested in tests/supplier-verification.test.ts):
 *   - SOURCE/FRESHNESS TRACKED: every imported entry carries its import
 *     source (manual kind + operator id + export id) and a captured-at
 *     timestamp — operator-auditable provenance, never anonymous data.
 *   - WHOLE-BATCH DISCIPLINE (law A4): one malformed entry refuses the
 *     ENTIRE import with a per-entry reason report — never a partial
 *     import. Duplicate supplier+SKU entries within a batch refuse
 *     DUPLICATE_CATALOGUE_ENTRY.
 *   - FAIL-CLOSED (law A8): a foreign-tenant entry in the input REFUSES
 *     the whole import (TENANT_MISMATCH) — never silently filtered.
 *   - DETERMINISM: entries are returned in supplierId-then-SKU lexical
 *     order; input order never leaks into the output.
 *
 * Laws: A1, A4, A8, A13, A20. Pure deterministic TS; time is an
 * explicit `number` input (epoch ms).
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// The plainly-labelled manual import source.
// ---------------------------------------------------------------------------

/** THE LABEL — carried verbatim on every import result and entry. */
export const MANUAL_CATALOGUE_IMPORT_LABEL =
  "manual-operator-catalogue-import (NOT a live supplier API; source and freshness tracked per entry)" as const;

/**
 * MANUAL provenance kinds only — a live-API kind is deliberately
 * UNREPRESENTABLE (the honest-labelling law).
 */
export type CatalogueImportSourceKind =
  | "manual-operator-export"
  | "operator-entered"
  | "supplier-price-list-document";

export interface CatalogueImportSource {
  readonly kind: CatalogueImportSourceKind;
  readonly operatorId: string;
  readonly exportId: string;
  readonly capturedAt: number;
}

export type CatalogueEntryCondition = "new" | "certified-refurbished" | "used";

export interface CatalogueEntry {
  readonly entryId: string;
  readonly tenant: TenantScope;
  readonly supplierId: string;
  readonly sku: string;
  /** Integer minor units, > 0. */
  readonly unitCostMinor: number;
  readonly currency: string;
  readonly condition: CatalogueEntryCondition;
  /** Warranty term in whole months, >= 0. */
  readonly warrantyMonths: number;
  /** Delivery estimate in whole days, >= 0. */
  readonly deliveryEstimateDays: number;
  /** The plainly-labelled manual import provenance — tracked on EVERY entry. */
  readonly importSource: CatalogueImportSource;
  /** The entry's own freshness anchor (when the operator captured this line). */
  readonly capturedAt: number;
}

// ---------------------------------------------------------------------------
// The import operation.
// ---------------------------------------------------------------------------

export type CatalogueEntryReasonCode =
  | "SUPPLIER_ID_REQUIRED"
  | "SKU_REQUIRED"
  | "INVALID_UNIT_COST"
  | "CURRENCY_REQUIRED"
  | "INVALID_WARRANTY"
  | "INVALID_DELIVERY_ESTIMATE"
  | "DUPLICATE_CATALOGUE_ENTRY";

export interface CatalogueEntryReport {
  readonly index: number;
  readonly supplierId: string;
  readonly sku: string;
  readonly reasonCode: CatalogueEntryReasonCode | null;
}

export type CatalogueImportReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "OPERATOR_ID_REQUIRED"
  | "EXPORT_ID_REQUIRED"
  | "INVALID_SOURCE_CAPTURE_TIME"
  | "ENTRY_VALIDATION_FAILED"
  | "DUPLICATE_CATALOGUE_ENTRY";

export type CatalogueImportResult =
  | {
      readonly ok: true;
      /** The plainly-labelled manual seam — verbatim on every result. */
      readonly label: typeof MANUAL_CATALOGUE_IMPORT_LABEL;
      readonly source: CatalogueImportSource;
      /** Deterministic order: supplierId then SKU lexical. */
      readonly entries: readonly CatalogueEntry[];
      readonly entryCount: number;
    }
  | {
      readonly ok: false;
      readonly reasonCode: CatalogueImportReasonCode;
      readonly label: typeof MANUAL_CATALOGUE_IMPORT_LABEL;
      /** Verbatim per-entry validation report (the honest refusal evidence). */
      readonly entryReports: readonly CatalogueEntryReport[];
    };

export interface CatalogueEntryInput {
  readonly supplierId: string;
  readonly sku: string;
  readonly unitCostMinor: number;
  readonly currency: string;
  readonly condition: CatalogueEntryCondition;
  readonly warrantyMonths: number;
  readonly deliveryEstimateDays: number;
  /** The entry's own captured-at (defaults to the source's when absent). */
  readonly capturedAt?: number;
}

/**
 * importCatalogueBatch — the manually-operated, operator-reviewed
 * catalogue import. Validates EVERY entry; one failure refuses the whole
 * batch with the per-entry report (never a partial import). The result
 * (success or refusal) carries the plainly-labelled seam label verbatim.
 */
export function importCatalogueBatch(
  tenant: TenantScope,
  source: CatalogueImportSource,
  entries: readonly CatalogueEntryInput[],
  existingEntries: readonly CatalogueEntry[] = [],
): CatalogueImportResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", label: MANUAL_CATALOGUE_IMPORT_LABEL, entryReports: [] };
  }
  if (source.operatorId.length === 0) {
    return { ok: false, reasonCode: "OPERATOR_ID_REQUIRED", label: MANUAL_CATALOGUE_IMPORT_LABEL, entryReports: [] };
  }
  if (source.exportId.length === 0) {
    return { ok: false, reasonCode: "EXPORT_ID_REQUIRED", label: MANUAL_CATALOGUE_IMPORT_LABEL, entryReports: [] };
  }
  if (!Number.isInteger(source.capturedAt) || source.capturedAt < 0) {
    return { ok: false, reasonCode: "INVALID_SOURCE_CAPTURE_TIME", label: MANUAL_CATALOGUE_IMPORT_LABEL, entryReports: [] };
  }
  const reports: CatalogueEntryReport[] = [];
  const accepted: CatalogueEntry[] = [];
  const seenKeys = new Set<string>();
  for (const existing of existingEntries) {
    // FAIL-CLOSED (law A8): a foreign-tenant entry in the input REFUSES
    // the whole import — never silently filtered out.
    if (existing.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return {
        ok: false,
        reasonCode: "TENANT_MISMATCH",
        label: MANUAL_CATALOGUE_IMPORT_LABEL,
        entryReports: [],
      };
    }
    seenKeys.add(`${existing.tenant.tenantId}::${existing.supplierId}::${existing.sku}`);
  }
  let refused = false;
  let duplicate = false;
  entries.forEach((entry, index) => {
    const entryTenantId = tenantCheck.scope.tenantId;
    const key = `${entryTenantId}::${entry.supplierId}::${entry.sku}`;
    let reasonCode: CatalogueEntryReasonCode | null = null;
    if (entry.supplierId.length === 0) reasonCode = "SUPPLIER_ID_REQUIRED";
    else if (entry.sku.length === 0) reasonCode = "SKU_REQUIRED";
    else if (!Number.isInteger(entry.unitCostMinor) || entry.unitCostMinor <= 0) {
      reasonCode = "INVALID_UNIT_COST";
    } else if (entry.currency.length === 0) reasonCode = "CURRENCY_REQUIRED";
    else if (!Number.isInteger(entry.warrantyMonths) || entry.warrantyMonths < 0) {
      reasonCode = "INVALID_WARRANTY";
    } else if (!Number.isInteger(entry.deliveryEstimateDays) || entry.deliveryEstimateDays < 0) {
      reasonCode = "INVALID_DELIVERY_ESTIMATE";
    } else if (seenKeys.has(key)) reasonCode = "DUPLICATE_CATALOGUE_ENTRY";
    if (reasonCode !== null) {
      refused = true;
      if (reasonCode === "DUPLICATE_CATALOGUE_ENTRY") duplicate = true;
    } else {
      seenKeys.add(key);
    }
    reports.push({ index, supplierId: entry.supplierId, sku: entry.sku, reasonCode });
    if (reasonCode === null) {
      const capturedAt = entry.capturedAt ?? source.capturedAt;
      accepted.push({
        entryId: `cat_${entryTenantId}_${entry.supplierId}_${entry.sku}`,
        tenant: { tenantId: entryTenantId },
        supplierId: entry.supplierId,
        sku: entry.sku,
        unitCostMinor: entry.unitCostMinor,
        currency: entry.currency,
        condition: entry.condition,
        warrantyMonths: entry.warrantyMonths,
        deliveryEstimateDays: entry.deliveryEstimateDays,
        importSource: source,
        capturedAt,
      });
    }
  });
  if (refused) {
    return {
      ok: false,
      reasonCode: duplicate ? "DUPLICATE_CATALOGUE_ENTRY" : "ENTRY_VALIDATION_FAILED",
      label: MANUAL_CATALOGUE_IMPORT_LABEL,
      entryReports: reports,
    };
  }
  accepted.sort((a, b) =>
    a.supplierId === b.supplierId ? a.sku.localeCompare(b.sku) : a.supplierId.localeCompare(b.supplierId),
  );
  return {
    ok: true,
    label: MANUAL_CATALOGUE_IMPORT_LABEL,
    source,
    entries: accepted,
    entryCount: accepted.length,
  };
}
