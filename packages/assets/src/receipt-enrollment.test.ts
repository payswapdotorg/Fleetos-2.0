/**
 * @fleetos/assets — F361A marketplace receipt→asset enrollment tests
 * (Wave 17 lane A; the f361a packet is the binding contract). The pure
 * state-machine battery lives in receipt-evidence.test.ts (the file-law
 * split); this file proves the ENROLLMENT laws against the REAL public
 * APIs: candidate → enrolled consuming the EXISTING registry, the
 * duplicate-serial guard (the ORIGINAL record returns with
 * duplicate=true, the registry never gains a second asset), the
 * discrepancy path (the asset stays un-enrolled until a verified
 * re-record), and tenant fail-closed reads (a foreign tenant sees
 * NOTHING).
 */

import { describe, expect, it } from "vitest";
import type { ReceiptRecordInput } from "./receipt-evidence.js";
import {
  InMemoryReceiptEnrollmentRegistry,
  ReceiptEnrollmentDirectory,
  type AssetEnrollmentRecord,
} from "./receipt-enrollment.js";
import { AssetDirectory, InMemoryAssetRepository } from "./kernel-directory.js";

const T = 1_774_000_000_000;
const TENANT = "tnt_accra-01";
const FOREIGN = "tnt_other-99";

function validReceipt(overrides: Partial<ReceiptRecordInput> = {}): ReceiptRecordInput {
  return {
    evidenceRef: "rev_po-2026-0001-01",
    tenantId: TENANT,
    siteId: "site_accra-hq",
    supplierOrderRef: "po-2026-0001",
    serial: "SN-LT-4401-ACCRA",
    assetTag: "TAG-ACCRA-04401",
    conditionOnArrival: "new",
    warrantyRef: "war-24m-accra-01",
    capturedAt: T,
    recordedAt: T + 1_000,
    ...overrides,
  };
}

function wiredDirectory(twins = true) {
  const repo = new InMemoryAssetRepository();
  const assets = new AssetDirectory(repo);
  const directory = new ReceiptEnrollmentDirectory(
    assets,
    new InMemoryReceiptEnrollmentRegistry(),
    twins ? repo : null,
  );
  return { repo, assets, directory };
}

/** Record + verify a receipt through the directory (the verified path). */
function verifiedReceipt(directory: ReceiptEnrollmentDirectory, input: ReceiptRecordInput) {
  const recorded = directory.recordReceipt(input);
  if (!recorded.ok) throw new Error(`record failed: ${recorded.reason}`);
  const verified = directory.verifyReceipt({
    tenantId: input.tenantId,
    evidenceRef: input.evidenceRef,
    expectation: {
      supplierOrderRef: input.supplierOrderRef,
      expectedSerial: input.serial,
      expectedAssetTag: input.assetTag,
      expectedCondition: input.conditionOnArrival,
    },
    decidedAt: input.recordedAt + 1,
  });
  if (!verified.ok) throw new Error(`verify failed: ${verified.reason}`);
  return verified.evidence;
}

describe("F361A AssetEnrollment — candidate → enrolled over the EXISTING registry", () => {
  it("enrolls a verified receipt: admit + activate through the REAL registry, twin linked", () => {
    const { repo, directory } = wiredDirectory();
    const evidence = verifiedReceipt(directory, validReceipt());
    const open = directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: evidence.evidenceRef,
      assetId: "ast_mkt-lt-0001",
      displayName: "Dell Latitude 5540 (marketplace)",
      kind: "other",
      deviceId: "dev_mkt-lt-0001",
      at: T + 3_000,
      actor: "act_operator-ada-01",
    });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.duplicate).toBe(false);
    expect(open.enrollment.state).toBe("candidate");
    expect(open.enrollment.receiptEvidenceRef).toBe("rev_po-2026-0001-01");
    expect(open.enrollment.custodySiteId).toBe("site_accra-hq");
    expect(open.enrollment.warrantyRef).toBe("war-24m-accra-01");
    expect(repo.findAsset(TENANT, "ast_mkt-lt-0001" as never)?.lifecycle).toBe("admitted");

    const complete = directory.completeEnrollment({
      tenantId: TENANT,
      serial: "SN-LT-4401-ACCRA",
      at: T + 4_000,
      actor: "act_operator-ada-01",
    });
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect(complete.duplicate).toBe(false);
    expect(complete.enrollment.state).toBe("enrolled");
    expect(complete.enrollment.enrolledAt).toBe(T + 4_000);
    expect(complete.twinLinked).toBe(true);
    const asset = repo.findAsset(TENANT, "ast_mkt-lt-0001" as never);
    expect(asset?.lifecycle).toBe("active");
    expect(asset?.enrolledAt).toBe(T + 4_000);
    const twin = repo.findTwin(TENANT, "dev_mkt-lt-0001" as never);
    expect(twin?.revisions.length).toBe(1);
    expect(twin?.revisions[0]?.attributes).toEqual({
      serial: "SN-LT-4401-ACCRA",
      assetTag: "TAG-ACCRA-04401",
      custodySiteId: "site_accra-hq",
      warrantyRef: "war-24m-accra-01",
      receiptEvidenceRef: "rev_po-2026-0001-01",
    });
  });

  it("the duplicate-serial guard: a second attempt returns the ORIGINAL record, never a second asset", () => {
    const { repo, directory } = wiredDirectory();
    const evidence = verifiedReceipt(directory, validReceipt());
    const first = directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: evidence.evidenceRef,
      assetId: "ast_mkt-lt-0001",
      displayName: "Dell Latitude 5540 (marketplace)",
      kind: "other",
      at: T + 3_000,
      actor: "act_operator-ada-01",
    });
    expect(first.ok).toBe(true);
    const second = directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: evidence.evidenceRef,
      assetId: "ast_mkt-lt-DIFFERENT",
      displayName: "Dell Latitude 5540 (duplicate attempt)",
      kind: "other",
      at: T + 5_000,
      actor: "act_operator-ada-01",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.enrollment.enrollmentId).toBe(
      (first as { ok: true; enrollment: AssetEnrollmentRecord }).enrollment.enrollmentId,
    );
    expect(second.enrollment.assetId).toBe("ast_mkt-lt-0001");
    expect(repo.listAssetsByTenant(TENANT).length).toBe(1);
    expect(repo.findAsset(TENANT, "ast_mkt-lt-DIFFERENT" as never)).toBeNull();
  });

  it("the duplicate-serial guard refuses a same-serial/different-tag conflict", () => {
    const { directory } = wiredDirectory();
    const first = verifiedReceipt(directory, validReceipt());
    directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: first.evidenceRef,
      assetId: "ast_mkt-lt-0001",
      displayName: "Dell Latitude 5540",
      kind: "other",
      at: T + 3_000,
      actor: "act_operator-ada-01",
    });
    const second = verifiedReceipt(
      directory,
      validReceipt({ evidenceRef: "rev_po-2026-0001-02", assetTag: "TAG-CONFLICT-9" }),
    );
    const conflict = directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: second.evidenceRef,
      assetId: "ast_mkt-lt-0002",
      displayName: "Conflicting attempt",
      kind: "other",
      at: T + 4_000,
      actor: "act_operator-ada-01",
    });
    expect(conflict).toEqual({ ok: false, reason: "serial-tag-conflict" });
  });

  it("an unverified (recorded-only) receipt refuses enrollment; a discrepancy refuses with its distinct code", () => {
    const { directory } = wiredDirectory();
    directory.recordReceipt(validReceipt());
    expect(directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: "rev_po-2026-0001-01",
      assetId: "ast_mkt-lt-0001",
      displayName: "Dell Latitude 5540",
      kind: "other",
      at: T + 3_000,
      actor: "act_operator-ada-01",
    })).toEqual({ ok: false, reason: "receipt-not-verified" });
    directory.recordReceipt(validReceipt({ evidenceRef: "rev_po-2026-0001-03", serial: "SN-WRONG-1", conditionOnArrival: "damaged" }));
    directory.verifyReceipt({
      tenantId: TENANT,
      evidenceRef: "rev_po-2026-0001-03",
      expectation: {
        supplierOrderRef: "po-2026-0001",
        expectedSerial: "SN-LT-4401-ACCRA",
        expectedAssetTag: "TAG-ACCRA-04401",
        expectedCondition: "new",
      },
      decidedAt: T + 2_000,
    });
    expect(directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: "rev_po-2026-0001-03",
      assetId: "ast_mkt-lt-0001",
      displayName: "Dell Latitude 5540",
      kind: "other",
      at: T + 3_000,
      actor: "act_operator-ada-01",
    })).toEqual({ ok: false, reason: "receipt-discrepancy" });
  });

  it("the discrepancy path: asset stays un-enrolled until a VERIFIED re-record", () => {
    const { repo, directory } = wiredDirectory();
    directory.recordReceipt(validReceipt({ serial: "SN-TYPO-0001" }));
    directory.verifyReceipt({
      tenantId: TENANT,
      evidenceRef: "rev_po-2026-0001-01",
      expectation: {
        supplierOrderRef: "po-2026-0001",
        expectedSerial: "SN-LT-4401-ACCRA",
        expectedAssetTag: "TAG-ACCRA-04401",
        expectedCondition: "new",
      },
      decidedAt: T + 2_000,
    });
    expect(directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: "rev_po-2026-0001-01",
      assetId: "ast_mkt-lt-0001",
      displayName: "Dell Latitude 5540",
      kind: "other",
      at: T + 3_000,
      actor: "act_operator-ada-01",
    })).toEqual({ ok: false, reason: "receipt-discrepancy" });
    expect(repo.listAssetsByTenant(TENANT).length).toBe(0);
    const corrected = verifiedReceipt(
      directory,
      validReceipt({ evidenceRef: "rev_po-2026-0001-01-r2" }),
    );
    const open = directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: corrected.evidenceRef,
      assetId: "ast_mkt-lt-0001",
      displayName: "Dell Latitude 5540 (marketplace)",
      kind: "other",
      at: T + 6_000,
      actor: "act_operator-ada-01",
    });
    expect(open.ok).toBe(true);
    const complete = directory.completeEnrollment({
      tenantId: TENANT,
      serial: "SN-LT-4401-ACCRA",
      at: T + 7_000,
      actor: "act_operator-ada-01",
    });
    expect(complete.ok && complete.enrollment.state).toBe("enrolled");
    expect(repo.listAssetsByTenant(TENANT).length).toBe(1);
  });

  it("identical receipt re-record is an idempotent duplicate; a conflicting one refuses", () => {
    const { directory } = wiredDirectory();
    const input = validReceipt();
    const first = directory.recordReceipt(input);
    expect(first.ok && first.duplicate).toBe(false);
    const again = directory.recordReceipt(input);
    expect(again.ok && again.duplicate).toBe(true);
    if (!again.ok) return;
    expect(again.evidence).toEqual((first as { ok: true; evidence: typeof again.evidence }).evidence);
    expect(directory.recordReceipt(validReceipt({ conditionOnArrival: "damaged" }))).toEqual({
      ok: false,
      reason: "duplicate-evidence-ref",
    });
  });

  it("completing an enrolled record is an idempotent duplicate (no re-execution, audit honestly null)", () => {
    const { directory } = wiredDirectory();
    const evidence = verifiedReceipt(directory, validReceipt());
    directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: evidence.evidenceRef,
      assetId: "ast_mkt-lt-0001",
      displayName: "Dell Latitude 5540",
      kind: "other",
      at: T + 3_000,
      actor: "act_operator-ada-01",
    });
    const first = directory.completeEnrollment({
      tenantId: TENANT,
      serial: "SN-LT-4401-ACCRA",
      at: T + 4_000,
      actor: "act_operator-ada-01",
    });
    expect(first.ok && first.duplicate).toBe(false);
    const second = directory.completeEnrollment({
      tenantId: TENANT,
      serial: "SN-LT-4401-ACCRA",
      at: T + 9_000,
      actor: "act_operator-ada-01",
    });
    expect(second.ok && second.duplicate).toBe(true);
    if (!second.ok) return;
    expect(second.enrollment.enrolledAt).toBe(T + 4_000);
    expect(second.audit).toBeNull();
    expect(second.twinLinked).toBe(false);
  });

  it("completing an unknown serial refuses; a malformed asset id propagates the REAL registry reason", () => {
    const { directory } = wiredDirectory();
    expect(directory.completeEnrollment({
      tenantId: TENANT,
      serial: "SN-NEVER-RECORDED",
      at: T + 4_000,
      actor: "act_operator-ada-01",
    })).toEqual({ ok: false, reason: "unknown-enrollment" });
    const evidence = verifiedReceipt(directory, validReceipt());
    expect(directory.openEnrollment({
      tenantId: TENANT,
      evidenceRef: evidence.evidenceRef,
      assetId: "not-an-asset-id",
      displayName: "Dell Latitude 5540",
      kind: "other",
      at: T + 3_000,
      actor: "act_operator-ada-01",
    })).toEqual({ ok: false, reason: "malformed-asset-id" });
  });

  it("a foreign tenant sees NOTHING: receipts, enrollments and the registry all fail closed", () => {
    const { repo, directory } = wiredDirectory();
    const evidence = verifiedReceipt(directory, validReceipt());
    expect(directory.getReceipt(FOREIGN, evidence.evidenceRef)).toBeNull();
    expect(directory.verifyReceipt({
      tenantId: FOREIGN,
      evidenceRef: evidence.evidenceRef,
      expectation: {
        supplierOrderRef: "po-2026-0001",
        expectedSerial: "SN-LT-4401-ACCRA",
        expectedAssetTag: "TAG-ACCRA-04401",
        expectedCondition: "new",
      },
      decidedAt: T + 2_000,
    })).toEqual({ ok: false, reason: "unknown-receipt" });
    expect(directory.openEnrollment({
      tenantId: FOREIGN,
      evidenceRef: evidence.evidenceRef,
      assetId: "ast_foreign-0001",
      displayName: "Foreign attempt",
      kind: "other",
      at: T + 3_000,
      actor: "act_foreign-actor",
    })).toEqual({ ok: false, reason: "unknown-receipt" });
    expect(directory.findEnrollment(FOREIGN, "SN-LT-4401-ACCRA")).toBeNull();
    expect(directory.completeEnrollment({
      tenantId: FOREIGN,
      serial: "SN-LT-4401-ACCRA",
      at: T + 4_000,
      actor: "act_foreign-actor",
    })).toEqual({ ok: false, reason: "unknown-enrollment" });
    // The owning tenant still reads its receipt; the registries are untouched.
    expect(directory.getReceipt(TENANT, evidence.evidenceRef)?.state).toBe("verified");
    expect(repo.listAssetsByTenant(FOREIGN).length).toBe(0);
    expect(repo.listAssetsByTenant(TENANT).length).toBe(0);
  });
});
