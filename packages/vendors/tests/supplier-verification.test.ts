/**
 * @fleetos/vendors — F361C §3.3: the supplier verification contract + the
 * manually-operated catalogue import seam. Machine tests of the
 * pending -> verified | expired | suspended machine (evidence laws, the
 * honest expiry, the verified-only matching gate with per-supplier
 * exclusion reasons, fail-closed tenancy) and the plainly-labelled
 * catalogue import (source/freshness tracked, whole-batch refusals,
 * duplicate-entry refusal, deterministic ordering).
 */

import { describe, expect, it } from "vitest";
import {
  openSupplierVerification,
  transitionSupplierVerification,
  supplierVerificationGate,
  isSupplierVerificationCurrent,
  findSupplierVerification,
  SUPPLIER_VERIFICATION_ALLOWED,
  importCatalogueBatch,
  MANUAL_CATALOGUE_IMPORT_LABEL,
  type SupplierVerificationRecord,
  type CatalogueEntryInput,
  type CatalogueImportSource,
  type CatalogueEntry,
} from "../src/index.js";

const TENANT = { tenantId: "acme" } as const;
const FOREIGN = { tenantId: "globex" } as const;
const T0 = 1_774_000_000_000;
const DAY = 86_400_000;

function pending(overrides: Partial<SupplierVerificationRecord> = {}): SupplierVerificationRecord {
  const result = openSupplierVerification(TENANT, "sup-1");
  if (!result.ok) throw new Error("fixture: open refused");
  return { ...result.next, ...overrides };
}

function verified(overrides: Partial<SupplierVerificationRecord> = {}): SupplierVerificationRecord {
  const result = transitionSupplierVerification(pending(), {
    type: "verify",
    evidence: { evidenceId: "ev-sup-1", tenantId: "acme" },
    verifiedAt: T0,
    expiresAt: T0 + 90 * DAY,
  });
  if (!result.ok) throw new Error("fixture: verify refused");
  return { ...result.next, ...overrides };
}

function suspended(overrides: Partial<SupplierVerificationRecord> = {}): SupplierVerificationRecord {
  const result = transitionSupplierVerification(pending(), { type: "suspend", reason: "audit hold" });
  if (!result.ok) throw new Error("fixture: suspend refused");
  return { ...result.next, ...overrides };
}

describe("the §3.3 verification machine", () => {
  it("pending -> verified REQUIRES same-tenant evidence + a strictly-later expiry", () => {
    const result = transitionSupplierVerification(pending(), {
      type: "verify",
      evidence: { evidenceId: "ev-sup-1", tenantId: "acme" },
      verifiedAt: T0,
      expiresAt: T0 + 90 * DAY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.status).toBe("verified");
    expect(result.next.evidence?.evidenceId).toBe("ev-sup-1");
    expect(result.next.verifiedAt).toBe(T0);
    expect(result.next.expiresAt).toBe(T0 + 90 * DAY);
  });

  it("verification refusals: missing evidence, foreign evidence tenant, expiry sanity", () => {
    expect(
      transitionSupplierVerification(pending(), {
        type: "verify",
        evidence: { evidenceId: "", tenantId: "acme" },
        verifiedAt: T0,
        expiresAt: T0 + DAY,
      }),
    ).toEqual({ ok: false, reasonCode: "VERIFICATION_EVIDENCE_REQUIRED" });
    expect(
      transitionSupplierVerification(pending(), {
        type: "verify",
        evidence: { evidenceId: "ev-x", tenantId: "globex" },
        verifiedAt: T0,
        expiresAt: T0 + DAY,
      }),
    ).toEqual({ ok: false, reasonCode: "VERIFICATION_EVIDENCE_TENANT_MISMATCH" });
    expect(
      transitionSupplierVerification(pending(), {
        type: "verify",
        evidence: { evidenceId: "ev-x", tenantId: "acme" },
        verifiedAt: T0,
        expiresAt: T0,
      }),
    ).toEqual({ ok: false, reasonCode: "EXPIRY_BEFORE_VERIFICATION" });
    expect(openSupplierVerification(TENANT, "")).toEqual({ ok: false, reasonCode: "SUPPLIER_ID_REQUIRED" });
  });

  it("suspend requires a reason; the terminal states never re-transition", () => {
    const suspended = transitionSupplierVerification(pending(), { type: "suspend", reason: "delivery fraud investigation" });
    expect(suspended.ok).toBe(true);
    if (!suspended.ok) return;
    expect(suspended.next.status).toBe("suspended");
    expect(suspended.next.suspendedReason).toBe("delivery fraud investigation");
    expect(
      transitionSupplierVerification(suspended.next, {
        type: "verify",
        evidence: { evidenceId: "ev-x", tenantId: "acme" },
        verifiedAt: T0,
        expiresAt: T0 + DAY,
      }),
    ).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
    expect(transitionSupplierVerification(pending(), { type: "suspend", reason: " " })).toEqual({
      ok: false,
      reasonCode: "SUSPEND_REASON_REQUIRED",
    });
  });

  it("the honest expiry: NOT_EXPIRED_YET before the lapse, expired after (boundary inclusive)", () => {
    const record = verified();
    expect(transitionSupplierVerification(record, { type: "expire", at: record.expiresAt as number })).toEqual({
      ok: false,
      reasonCode: "NOT_EXPIRED_YET",
    });
    const expired = transitionSupplierVerification(record, { type: "expire", at: (record.expiresAt as number) + 1 });
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    expect(expired.next.status).toBe("expired");
    // EXPIRED is terminal.
    expect(
      transitionSupplierVerification(expired.next, {
        type: "verify",
        evidence: { evidenceId: "ev-x", tenantId: "acme" },
        verifiedAt: T0,
        expiresAt: T0 + DAY,
      }),
    ).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
    expect(transitionSupplierVerification(expired.next, { type: "suspend", reason: "x" })).toEqual({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
  });

  it("the allowed matrix is the frozen law", () => {
    expect([...SUPPLIER_VERIFICATION_ALLOWED.pending].sort()).toEqual(["expire", "suspend", "verify"]);
    expect([...SUPPLIER_VERIFICATION_ALLOWED.verified].sort()).toEqual(["expire", "suspend"]);
    expect(SUPPLIER_VERIFICATION_ALLOWED.expired).toEqual([]);
    expect(SUPPLIER_VERIFICATION_ALLOWED.suspended).toEqual([]);
  });
});

describe("the verified-only matching gate", () => {
  it("admits ONLY verified+current suppliers; every exclusion carries its reason", () => {
    const records = [
      verified({ supplierId: "sup-ok" }),
      pending({ supplierId: "sup-pend" }),
      suspended({ supplierId: "sup-susp" }),
      verified({ supplierId: "sup-lapsed", expiresAt: T0 - DAY }),
    ];
    const gate = supplierVerificationGate(TENANT, records, T0);
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.admittedSupplierIds).toEqual(["sup-ok"]);
    expect(gate.admittedCount).toBe(1);
    expect(gate.excluded.map((e) => `${e.supplierId}:${e.exclusionReason}`)).toEqual([
      "sup-lapsed:VERIFICATION_EXPIRED",
      "sup-pend:SUPPLIER_PENDING",
      "sup-susp:SUPPLIER_SUSPENDED",
    ]);
  });

  it("isSupplierVerificationCurrent is the pure currency check (boundary inclusive)", () => {
    const record = verified();
    expect(isSupplierVerificationCurrent(record, T0)).toBe(true);
    expect(isSupplierVerificationCurrent(record, record.expiresAt as number)).toBe(true);
    expect(isSupplierVerificationCurrent(record, (record.expiresAt as number) + 1)).toBe(false);
    expect(isSupplierVerificationCurrent(pending(), T0)).toBe(false);
  });

  it("a foreign-tenant record in the gate input REFUSES the whole gate (fail-closed)", () => {
    const foreignRecord = verified({ tenant: FOREIGN, supplierId: "sup-f" });
    expect(supplierVerificationGate(TENANT, [foreignRecord], T0)).toEqual({
      ok: false,
      reasonCode: "TENANT_MISMATCH",
    });
  });

  it("fail-closed tenant read: findSupplierVerification", () => {
    const record = verified();
    expect(findSupplierVerification(TENANT, [record], "sup-1")?.status).toBe("verified");
    expect(findSupplierVerification(FOREIGN, [record], "sup-1")).toBeNull();
  });
});

describe("the manually-operated catalogue import seam (PLAINLY LABELLED)", () => {
  function source(overrides: Partial<CatalogueImportSource> = {}): CatalogueImportSource {
    return {
      kind: "manual-operator-export",
      operatorId: "act_operator-ada-01",
      exportId: "exp-2026-10-01",
      capturedAt: T0,
      ...overrides,
    };
  }

  function entry(overrides: Partial<CatalogueEntryInput> = {}): CatalogueEntryInput {
    return {
      supplierId: "sup-1",
      sku: "LT-5540",
      unitCostMinor: 1_200_000,
      currency: "GHS",
      condition: "new",
      warrantyMonths: 24,
      deliveryEstimateDays: 10,
      ...overrides,
    };
  }

  it("imports a batch with the LABEL verbatim and tracked source/freshness on every entry", () => {
    const result = importCatalogueBatch(
      TENANT,
      source(),
      [entry(), entry({ supplierId: "sup-2", sku: "PR-3300", unitCostMinor: 800_000 })],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.label).toBe(MANUAL_CATALOGUE_IMPORT_LABEL);
    expect(result.label).toContain("NOT a live supplier API");
    expect(result.entryCount).toBe(2);
    expect(result.entries.map((e) => `${e.supplierId}:${e.sku}`)).toEqual([
      "sup-1:LT-5540",
      "sup-2:PR-3300",
    ]);
    for (const imported of result.entries) {
      expect(imported.importSource.operatorId).toBe("act_operator-ada-01");
      expect(imported.importSource.exportId).toBe("exp-2026-10-01");
      expect(imported.capturedAt).toBe(T0);
    }
  });

  it("a duplicate supplier+SKU within the batch REFUSES the whole import (per-entry report)", () => {
    const result = importCatalogueBatch(TENANT, source(), [entry(), entry()]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe("DUPLICATE_CATALOGUE_ENTRY");
    expect(result.entryReports[1]?.reasonCode).toBe("DUPLICATE_CATALOGUE_ENTRY");
    expect(result.entryReports[0]?.reasonCode).toBeNull();
  });

  it("a duplicate against EXISTING entries refuses; a malformed entry refuses the whole batch", () => {
    const first = importCatalogueBatch(TENANT, source(), [entry()]);
    if (!first.ok) throw new Error("fixture");
    const existing: readonly CatalogueEntry[] = first.entries;
    expect(importCatalogueBatch(TENANT, source({ exportId: "exp-2" }), [entry()], existing).ok).toBe(false);
    const malformed = importCatalogueBatch(TENANT, source({ exportId: "exp-3" }), [
      entry(),
      entry({ supplierId: "sup-2", unitCostMinor: 0 }),
    ]);
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.reasonCode).toBe("ENTRY_VALIDATION_FAILED");
    expect(malformed.entryReports[1]?.reasonCode).toBe("INVALID_UNIT_COST");
    expect(malformed.entryReports[0]?.reasonCode).toBeNull();
  });

  it("source validation and fail-closed tenancy refusals", () => {
    expect(importCatalogueBatch(TENANT, source({ operatorId: "" }), [entry()]).ok).toBe(false);
    expect(importCatalogueBatch(TENANT, source({ exportId: "" }), [entry()]).ok).toBe(false);
    expect(importCatalogueBatch(TENANT, source({ capturedAt: -1 }), [entry()]).ok).toBe(false);
    const foreignExisting: readonly CatalogueEntry[] = [
      {
        entryId: "cat_foreign",
        tenant: FOREIGN,
        supplierId: "sup-f",
        sku: "LT-5540",
        unitCostMinor: 1,
        currency: "GHS",
        condition: "new",
        warrantyMonths: 0,
        deliveryEstimateDays: 0,
        importSource: source(),
        capturedAt: T0,
      },
    ];
    const refused = importCatalogueBatch(TENANT, source({ exportId: "exp-4" }), [entry()], foreignExisting);
    expect(refused).toEqual({
      ok: false,
      reasonCode: "TENANT_MISMATCH",
      label: MANUAL_CATALOGUE_IMPORT_LABEL,
      entryReports: [],
    });
  });

  it("the entry ids are deterministic (tenant + supplier + sku)", () => {
    const result = importCatalogueBatch(TENANT, source(), [entry()]);
    if (!result.ok) throw new Error("fixture");
    expect(result.entries[0]?.entryId).toBe("cat_acme_sup-1_LT-5540");
  });
});
