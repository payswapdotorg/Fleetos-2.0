/**
 * @fleetos/assets — F361A marketplace receipt→asset enrollment (Wave 17
 * lane A). The F360 freeze §3.5 second state machine:
 *
 *   AssetEnrollment: candidate → enrolled (links serial/tag + custody +
 *   warranty)
 *
 * The enrollment service CONSUMES the EXISTING ManagedAsset/DeviceTwin
 * registry public APIs (AssetDirectory.admitAsset /
 * AssetDirectory.transitionAsset / applyTwinRevision over the registry's
 * own twin port) — it is NEVER a second asset truth: the enrollment
 * record is a typed LINK (receipt evidence ref + asset id + custody +
 * warranty), while asset identity/lifecycle stays in the registry.
 *
 * Duplicate-serial guard (the freeze law): enrollment is idempotent
 * keyed on tenant+serial — a second attempt for the same serial returns
 * the ORIGINAL enrollment record with duplicate=true (the F351A
 * command-queue pattern) and the registry is left untouched (never a
 * second asset). A same-serial/different-tag attempt refuses with
 * serial-tag-conflict.
 *
 * The authoritative asset record updates ONLY on a VERIFIED receipt
 * (mission §3.6): recorded-only and discrepancy receipts refuse
 * enrollment with distinct machine-stable codes; the asset stays
 * un-enrolled until a verified re-record.
 *
 * Tenant reads fail closed: a foreign tenant sees NOTHING (unknown
 * receipts/enrollments — no existence leak). Pure TypeScript over
 * injected PORT interfaces; no I/O, no servers, no databases.
 */

import {
  applyTwinRevision,
  type AssetId,
  type AssetKind,
  type DeviceId,
  type DeviceTwin,
  type TenantIdLike,
  type TwinRevisionInput,
} from "./assets.js";
import { AssetDirectory } from "./kernel-directory.js";
import type { AuditEventRef } from "./kernel-audit.js";
import {
  recordReceiptEvidence,
  verifyReceiptEvidence,
  type ReceiptEvidence,
  type ReceiptExpectation,
  type ReceiptRecordInput,
  type ReceiptRecordRejectionCode,
} from "./receipt-evidence.js";

// ---------------------------------------------------------------------------
// AssetEnrollmentRecord — the typed link (candidate → enrolled).
// ---------------------------------------------------------------------------

export type AssetEnrollmentState = "candidate" | "enrolled";

export interface AssetEnrollmentRecord {
  /** Deterministic enrollment id (the tenant+serial idempotency key). */
  readonly enrollmentId: string;
  readonly tenantId: TenantIdLike;
  /** The VERIFIED receipt evidence this enrollment consumes. */
  readonly receiptEvidenceRef: string;
  /** The EXISTING registry asset (the authoritative record — never duplicated). */
  readonly assetId: AssetId;
  /** The device twin the enrollment links (optional: laptops/printers may
   * enroll before their telemetry device exists). */
  readonly deviceId: DeviceId | null;
  readonly serial: string;
  readonly assetTag: string;
  /** Custody: the site the equipment was received at. */
  readonly custodySiteId: string;
  readonly warrantyRef: string;
  readonly state: AssetEnrollmentState;
  readonly candidateAt: number;
  readonly enrolledAt: number | null;
}

// ---------------------------------------------------------------------------
// Ports — structural seams (the in-memory references are deterministic).
// ---------------------------------------------------------------------------

export interface ReceiptEnrollmentRegistryPort {
  readonly save: (record: AssetEnrollmentRecord) => void;
  readonly find: (tenantId: TenantIdLike, serial: string) => AssetEnrollmentRecord | null;
}

export class InMemoryReceiptEnrollmentRegistry implements ReceiptEnrollmentRegistryPort {
  private readonly records = new Map<string, AssetEnrollmentRecord>();
  save(r: AssetEnrollmentRecord): void {
    this.records.set(`${r.tenantId}:${r.serial}`, r);
  }
  find(t: TenantIdLike, serial: string): AssetEnrollmentRecord | null {
    return this.records.get(`${t}:${serial}`) ?? null;
  }
}

/** The twin persistence seam — structurally satisfied by the SAME
 * repository port backing the AssetDirectory (the existing registry). */
export interface TwinPort {
  readonly findTwin: (tenantId: TenantIdLike, deviceId: DeviceId) => DeviceTwin | null;
  readonly saveTwin: (twin: DeviceTwin) => void;
}

// ---------------------------------------------------------------------------
// The directory — receipts + enrollments over the REAL registry APIs.
// ---------------------------------------------------------------------------

export type ReceiptEnrollmentRejectionCode =
  | ReceiptRecordRejectionCode
  | "duplicate-evidence-ref"
  | "unknown-receipt"
  | "illegal-transition"
  | "receipt-not-verified"
  | "receipt-discrepancy"
  | "serial-tag-conflict"
  | "unknown-enrollment"
  | "tenant-mismatch"
  // Propagated verbatim from the REAL registry (AssetDirectory):
  | "malformed-asset-id"
  | "missing-display-name"
  | "invalid-created-at"
  | "duplicate-asset"
  | "unknown-asset"
  | "already-in-target-state"
  | "twin-revision-refused"
  | "missing-device-id";

export type ReceiptEnrollOpenResult =
  | { readonly ok: true; readonly enrollment: AssetEnrollmentRecord; readonly duplicate: boolean; readonly audit: AuditEventRef | null }
  | { readonly ok: false; readonly reason: ReceiptEnrollmentRejectionCode };

export type ReceiptEnrollCompleteResult =
  | { readonly ok: true; readonly enrollment: AssetEnrollmentRecord; readonly duplicate: boolean; readonly audit: AuditEventRef | null; readonly twinLinked: boolean }
  | { readonly ok: false; readonly reason: ReceiptEnrollmentRejectionCode };

export type ReceiptVerifyLookupResult =
  | { readonly ok: true; readonly evidence: ReceiptEvidence; readonly duplicate: boolean }
  | { readonly ok: false; readonly reason: ReceiptEnrollmentRejectionCode };

function sameFrozenFields(a: ReceiptEvidence, input: ReceiptRecordInput): boolean {
  return (
    a.evidenceRef === input.evidenceRef &&
    a.tenantId === input.tenantId &&
    a.siteId === input.siteId &&
    a.supplierOrderRef === input.supplierOrderRef &&
    a.serial === input.serial &&
    a.assetTag === input.assetTag &&
    a.conditionOnArrival === input.conditionOnArrival &&
    a.warrantyRef === input.warrantyRef &&
    a.capturedAt === input.capturedAt
  );
}

export class ReceiptEnrollmentDirectory {
  private readonly receipts = new Map<string, ReceiptEvidence>();
  constructor(
    private readonly assets: AssetDirectory,
    private readonly enrollments: ReceiptEnrollmentRegistryPort = new InMemoryReceiptEnrollmentRegistry(),
    private readonly twins: TwinPort | null = null,
  ) {}

  // -------------------------------------------------------------------------
  // Receipts — record (idempotent on identical re-record) + verify.
  // -------------------------------------------------------------------------

  /** Record a receipt. An IDENTICAL re-record of the same evidence ref is
   * an idempotent duplicate (the original returned, duplicate=true); a
   * DIFFERENT payload under the same ref refuses (never mutated). */
  recordReceipt(input: ReceiptRecordInput): ReceiptVerifyLookupResult {
    const existing = this.receipts.get(`${input.tenantId}:${input.evidenceRef}`);
    if (existing) {
      if (sameFrozenFields(existing, input)) {
        return { ok: true, evidence: existing, duplicate: true };
      }
      return { ok: false, reason: "duplicate-evidence-ref" };
    }
    const r = recordReceiptEvidence(input);
    if (!r.ok) return { ok: false, reason: r.reason };
    this.receipts.set(`${input.tenantId}:${input.evidenceRef}`, r.evidence);
    return { ok: true, evidence: r.evidence, duplicate: false };
  }

  /** Verify a recorded receipt against the order expectation. Tenant
   * fail-closed: a foreign tenant's receipt is UNKNOWN (no leak). */
  verifyReceipt(input: {
    readonly tenantId: TenantIdLike;
    readonly evidenceRef: string;
    readonly expectation: ReceiptExpectation;
    readonly decidedAt: number;
  }): ReceiptVerifyLookupResult {
    const evidence = this.receipts.get(`${input.tenantId}:${input.evidenceRef}`);
    if (!evidence) return { ok: false, reason: "unknown-receipt" };
    const r = verifyReceiptEvidence(evidence, input.expectation, input.decidedAt);
    if (!r.ok) return { ok: false, reason: r.reason };
    this.receipts.set(`${input.tenantId}:${input.evidenceRef}`, r.evidence);
    return { ok: true, evidence: r.evidence, duplicate: false };
  }

  /** Tenant-scoped receipt read. A foreign tenant sees NOTHING (null). */
  getReceipt(tenantId: TenantIdLike, evidenceRef: string): ReceiptEvidence | null {
    return this.receipts.get(`${tenantId}:${evidenceRef}`) ?? null;
  }

  // -------------------------------------------------------------------------
  // Enrollment — candidate → enrolled, consuming the REAL registry.
  // -------------------------------------------------------------------------

  /** Open the enrollment candidate for a VERIFIED receipt. The duplicate
   * guard: an existing enrollment for the same tenant+serial returns the
   * ORIGINAL record (duplicate=true, registry untouched); a same-serial
   * different-tag attempt refuses. First opening admits the asset through
   * the REAL AssetDirectory.admitAsset (its refusal codes propagate). */
  openEnrollment(input: {
    readonly tenantId: TenantIdLike;
    readonly evidenceRef: string;
    readonly assetId: string;
    readonly displayName: string;
    readonly kind: AssetKind;
    readonly deviceId?: string;
    readonly at: number;
    readonly actor: string;
  }): ReceiptEnrollOpenResult {
    const evidence = this.receipts.get(`${input.tenantId}:${input.evidenceRef}`);
    if (!evidence) return { ok: false, reason: "unknown-receipt" };
    if (evidence.state === "discrepancy") return { ok: false, reason: "receipt-discrepancy" };
    if (evidence.state !== "verified") return { ok: false, reason: "receipt-not-verified" };
    const existing = this.enrollments.find(input.tenantId, evidence.serial);
    if (existing) {
      if (existing.assetTag === evidence.assetTag) {
        // Idempotent duplicate: the ORIGINAL record, never a second asset.
        return { ok: true, enrollment: existing, duplicate: true, audit: null };
      }
      return { ok: false, reason: "serial-tag-conflict" };
    }
    const admitted = this.assets.admitAsset({
      assetId: input.assetId,
      tenantId: input.tenantId,
      kind: input.kind,
      displayName: input.displayName,
      createdAt: input.at,
      actor: input.actor,
    });
    if (!admitted.ok) return { ok: false, reason: admitted.reason };
    const record: AssetEnrollmentRecord = {
      enrollmentId: `enr_${input.tenantId}_${evidence.serial}`,
      tenantId: input.tenantId,
      receiptEvidenceRef: evidence.evidenceRef,
      assetId: admitted.asset.id,
      deviceId: (input.deviceId as DeviceId | undefined) ?? null,
      serial: evidence.serial,
      assetTag: evidence.assetTag,
      custodySiteId: evidence.siteId,
      warrantyRef: evidence.warrantyRef,
      state: "candidate",
      candidateAt: input.at,
      enrolledAt: null,
    };
    this.enrollments.save(record);
    return { ok: true, enrollment: record, duplicate: false, audit: admitted.audit };
  }

  /** Complete the enrollment (candidate → enrolled): activates the asset
   * through the REAL AssetDirectory.transitionAsset and, when a device id
   * is linked + a twin port is wired, appends the enrollment attributes
   * through the REAL applyTwinRevision (the serial/tag + custody +
   * warranty link). Idempotent: completing an enrolled record returns the
   * ORIGINAL (duplicate=true, no state change). */
  completeEnrollment(input: {
    readonly tenantId: TenantIdLike;
    readonly serial: string;
    readonly deviceId?: string;
    readonly at: number;
    readonly actor: string;
  }): ReceiptEnrollCompleteResult {
    const record = this.enrollments.find(input.tenantId, input.serial);
    if (!record) return { ok: false, reason: "unknown-enrollment" };
    if (record.state === "enrolled") {
      // Idempotent duplicate — the ORIGINAL record, nothing re-executed
      // (audit honestly null: no registry operation ran, never fabricated).
      return { ok: true, enrollment: record, duplicate: true, audit: null, twinLinked: false };
    }
    const activated = this.assets.transitionAsset({
      tenantId: input.tenantId,
      assetId: record.assetId,
      command: "activate",
      at: input.at,
      actor: input.actor,
    });
    if (!activated.ok) return { ok: false, reason: activated.reason };
    const deviceId = (input.deviceId as DeviceId | undefined) ?? record.deviceId;
    let twinLinked = false;
    if (deviceId && this.twins) {
      const current = this.twins.findTwin(input.tenantId, deviceId);
      const twinInput: TwinRevisionInput = {
        deviceId,
        tenantId: input.tenantId,
        seq: (current?.lastSeq ?? 0) + 1,
        observedAt: input.at,
        appliedAt: input.at,
        source: "manual",
        attributes: {
          serial: record.serial,
          assetTag: record.assetTag,
          custodySiteId: record.custodySiteId,
          warrantyRef: record.warrantyRef,
          receiptEvidenceRef: record.receiptEvidenceRef,
        },
      };
      const revised = applyTwinRevision(current, twinInput);
      if (!revised.ok) return { ok: false, reason: "twin-revision-refused" };
      this.twins.saveTwin(revised.twin);
      twinLinked = true;
    }
    const next: AssetEnrollmentRecord = { ...record, state: "enrolled", enrolledAt: input.at, deviceId };
    this.enrollments.save(next);
    return { ok: true, enrollment: next, duplicate: false, audit: activated.audit, twinLinked };
  }

  /** Tenant-scoped enrollment read. A foreign tenant sees NOTHING (null). */
  findEnrollment(tenantId: TenantIdLike, serial: string): AssetEnrollmentRecord | null {
    return this.enrollments.find(tenantId, serial);
  }
}
