/**
 * @fleetos/assets — F361A marketplace receipt evidence tests (Wave 17
 * lane A; the f361a packet is the binding contract).
 *
 * The pure state-machine battery: recorded → verified | discrepancy with
 * the FROZEN fields, machine-stable refusal codes for every missing
 * field, the deterministic discrepancy reasons in the fixed vocabulary
 * order, and the terminal-state law (a decided receipt is NEVER
 * re-decided — the append-only law; a corrected receipt is a NEW
 * record).
 */

import { describe, expect, it } from "vitest";
import {
  recordReceiptEvidence,
  verifyReceiptEvidence,
  type ReceiptRecordInput,
} from "./receipt-evidence.js";

const T = 1_774_000_000_000;
const TENANT = "tnt_accra-01";

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

describe("F361A ReceiptEvidence — the pure recorded → verified | discrepancy machine", () => {
  it("records a receipt with every frozen field and the recorded state", () => {
    const r = recordReceiptEvidence(validReceipt());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evidence.state).toBe("recorded");
    expect(r.evidence.serial).toBe("SN-LT-4401-ACCRA");
    expect(r.evidence.assetTag).toBe("TAG-ACCRA-04401");
    expect(r.evidence.siteId).toBe("site_accra-hq");
    expect(r.evidence.supplierOrderRef).toBe("po-2026-0001");
    expect(r.evidence.conditionOnArrival).toBe("new");
    expect(r.evidence.warrantyRef).toBe("war-24m-accra-01");
    expect(r.evidence.capturedAt).toBe(T);
    expect(r.evidence.decidedAt).toBeNull();
    expect(r.evidence.discrepancyReasons).toEqual([]);
  });

  it("refuses recording with machine-stable codes for every missing frozen field", () => {
    expect(recordReceiptEvidence(validReceipt({ evidenceRef: "" }))).toEqual({ ok: false, reason: "missing-evidence-ref" });
    expect(recordReceiptEvidence(validReceipt({ tenantId: "" }))).toEqual({ ok: false, reason: "missing-tenant-id" });
    expect(recordReceiptEvidence(validReceipt({ siteId: "" }))).toEqual({ ok: false, reason: "missing-site-id" });
    expect(recordReceiptEvidence(validReceipt({ supplierOrderRef: "" }))).toEqual({ ok: false, reason: "missing-supplier-order-ref" });
    expect(recordReceiptEvidence(validReceipt({ serial: "" }))).toEqual({ ok: false, reason: "missing-serial" });
    expect(recordReceiptEvidence(validReceipt({ assetTag: "" }))).toEqual({ ok: false, reason: "missing-asset-tag" });
    expect(recordReceiptEvidence(validReceipt({ conditionOnArrival: "sparkling" as never }))).toEqual({ ok: false, reason: "unknown-condition-on-arrival" });
    expect(recordReceiptEvidence(validReceipt({ warrantyRef: "" }))).toEqual({ ok: false, reason: "missing-warranty-ref" });
    expect(recordReceiptEvidence(validReceipt({ capturedAt: 0 }))).toEqual({ ok: false, reason: "invalid-captured-at" });
    expect(recordReceiptEvidence(validReceipt({ recordedAt: -1 }))).toEqual({ ok: false, reason: "invalid-recorded-at" });
  });

  it("verifies a matching receipt (recorded → verified)", () => {
    const recorded = recordReceiptEvidence(validReceipt());
    if (!recorded.ok) throw new Error("unreachable");
    const v = verifyReceiptEvidence(
      recorded.evidence,
      {
        supplierOrderRef: "po-2026-0001",
        expectedSerial: "SN-LT-4401-ACCRA",
        expectedAssetTag: "TAG-ACCRA-04401",
        expectedCondition: "new",
      },
      T + 2_000,
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.evidence.state).toBe("verified");
    expect(v.evidence.decidedAt).toBe(T + 2_000);
    expect(v.evidence.discrepancyReasons).toEqual([]);
  });

  it("records a discrepancy with the deterministic reasons in the fixed vocabulary order", () => {
    const recorded = recordReceiptEvidence(
      validReceipt({ serial: "SN-LT-4402-XXXX", assetTag: "TAG-OTHER-1", conditionOnArrival: "damaged" }),
    );
    if (!recorded.ok) throw new Error("unreachable");
    const v = verifyReceiptEvidence(
      recorded.evidence,
      {
        supplierOrderRef: "po-2026-0002",
        expectedSerial: "SN-LT-4402-YYYY",
        expectedAssetTag: "TAG-OTHER-1",
        expectedCondition: "new",
      },
      T + 2_000,
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.evidence.state).toBe("discrepancy");
    expect(v.evidence.discrepancyReasons).toEqual([
      "supplier-order-mismatch",
      "serial-mismatch",
      "condition-mismatch",
    ]);
  });

  it("terminal states refuse re-decision (illegal-transition, append-only law)", () => {
    const recorded = recordReceiptEvidence(validReceipt());
    if (!recorded.ok) throw new Error("unreachable");
    const expectation = {
      supplierOrderRef: "po-2026-0001",
      expectedSerial: "SN-LT-4401-ACCRA",
      expectedAssetTag: "TAG-ACCRA-04401",
      expectedCondition: "new" as const,
    };
    const first = verifyReceiptEvidence(recorded.evidence, expectation, T + 1);
    expect(first.ok).toBe(true);
    const second = verifyReceiptEvidence(
      (first as { ok: true; evidence: typeof recorded.evidence }).evidence,
      expectation,
      T + 2,
    );
    expect(second).toEqual({ ok: false, reason: "illegal-transition" });
  });
});
