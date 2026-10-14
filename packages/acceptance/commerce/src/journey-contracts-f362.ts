/**
 * @fleetos/acceptance-commerce — F362 (Wave 17, the TL-delegated E2E lane):
 * the transaction-spine step families. The deterministic E2E journey
 * (docs/tech-lead/packets/f362.md §2) through the REAL public APIs of ALL
 * THREE Wave-17 lanes:
 *
 *   real need (F361C request contract)
 *     → seeded supplier catalogue (verified suppliers, plainly-labelled
 *       manual import)
 *     → two offers (F361C offer schema, freshness law asserted)
 *     → explainable comparison (hard constraints vs preference weights)
 *     → Guardian approval (F361B approval contract, advisory-never-authorizes)
 *     → order placement + manual provider-ack seam (idempotent, dedup-refusing)
 *     → receipt evidence (F361A ReceiptEvidence)
 *     → asset enrollment (F361A duplicate guard; the authoritative record)
 *
 * CENSUS CITATION (the F354 lesson; machine greps at base d714616 recorded
 * in docs/evidence/F362/report.md §1): the spn-* op family and the journey
 * id `marketplace-transaction-spine` are NEW at this base; the F361C chain
 * kinds (mreq-/moff-/mver-/mord-) are COMPOSED verbatim through their
 * existing census-certified drivers, never re-claimed; the F361B surfaces
 * (evaluateMarketplaceOrderApproval / assertAdvisoryNeverAuthorizes /
 * InMemoryMarketplaceEvidenceStore / buildArtifact) and the F361A surfaces
 * (ReceiptEnrollmentDirectory / AssetDirectory / InMemoryAssetRepository /
 * applyTwinRevision) exist ONLY in the security/field corpora — ZERO
 * commerce-corpus coverage — so the spn-* kinds that drive them are this
 * lane's NEW composition angle.
 *
 * Time law (D13/D14): single-epoch (T0) by construction — no step consumes
 * the run anchor; every timestamp is literal journey data or a fixed ISO
 * fixture string (the F361B corpus convention, cited per step).
 *
 * File law: this file holds ONLY the typed step data; the drivers live in
 * drivers-spine-guardian.ts / drivers-spine-receipt.ts; the journey lives
 * in journeys/f362-spine.ts.
 */

import type { JourneyStepBase } from "./journey-contracts.js";

// ---------------------------------------------------------------------------
// The F361B segment — marketplace evidence retention (the four frozen kinds
// are narrowed here to the two the spine retains: the offer snapshot and the
// provider-ack reference) + the Guardian approval contract.
// ---------------------------------------------------------------------------

export type SpineEvidenceKind = "offer-snapshot" | "provider-ack";

export type SpineEvidenceStep =
  | (JourneyStepBase & {
      readonly kind: "spn-evidence-retain";
      readonly factKey: string;
      readonly evidenceKind: SpineEvidenceKind;
      /** The EXTERNAL provider's event id — the duplicate-refusal identity. */
      readonly providerEventId: string;
      /** The marketplace subject the evidence belongs to (offer id or order id). */
      readonly subjectRef: string;
      readonly sourceSystem: string;
      readonly sourceReference: string;
      readonly retrievedVia: "manual" | "export";
      /** Fixed ISO fixture strings (the F361B corpus convention — no wall clock). */
      readonly capturedAtIso: string;
      readonly recordedAtIso: string;
      readonly artifactId: string;
      readonly artifactDescription: string;
      /** The canonical JSON payload (deterministic content digest input). */
      readonly artifactJson: string;
    })
  | (JourneyStepBase & {
      readonly kind: "spn-evidence-read";
      readonly factKey: string;
      readonly evidenceKind: SpineEvidenceKind;
      /** "foreign" reads through the OTHER tenant's scope (must see nothing). */
      readonly callerTenant?: "own" | "foreign";
    });

export type SpineGuardianApprovalMode =
  | "in-limits"
  | "over-limit"
  | "missing-human-approval"
  | "advisory";

export type SpineGuardianApprovalStep = JourneyStepBase & {
  readonly kind: "spn-guardian-approval";
  readonly factKey: string;
  readonly mode: SpineGuardianApprovalMode;
  readonly orderId: string;
  readonly category: "laptops" | "printers";
  readonly transactionKind: "purchase" | "repair-service";
  readonly units: number;
  /** The order amount total in the same unit as the fixture ceiling. */
  readonly amountTotal: number;
  readonly currency: string;
  readonly supplierId: string;
  /** The verification evidence reference (the F361C §3.3 seam). */
  readonly verificationRef: string;
  /** True = bind the retained offer-snapshot evidence id (the seam record). */
  readonly offerSnapshotFromEvidence: boolean;
  readonly actorId: string;
  readonly actorAuthority: readonly string[];
  readonly actorAutonomous: boolean;
  /** Present only in mode "advisory" (input data only — never an authority). */
  readonly advisorySource?: string;
  readonly advisoryRecommendation?: "approve" | "refuse" | "defer";
  readonly advisoryRationale?: string;
};

// ---------------------------------------------------------------------------
// The F361A segment — receipt evidence (recorded → verified | discrepancy)
// and asset enrollment (candidate → enrolled) over the REAL registry.
// ---------------------------------------------------------------------------

export type SpineReceiptCondition = "new" | "good" | "damaged";

export type SpineReceiptStep =
  | (JourneyStepBase & {
      readonly kind: "spn-receipt-record";
      readonly factKey: string;
      readonly evidenceRef: string;
      readonly serial: string;
      readonly assetTag: string;
      readonly conditionOnArrival: SpineReceiptCondition;
      /** The supplier order this receipt claims to fulfil (the §3.4 seam). */
      readonly supplierOrderRef: string;
      readonly siteId: string;
      readonly warrantyRef: string;
      readonly capturedAt: number;
      readonly recordedAt: number;
    })
  | (JourneyStepBase & {
      readonly kind: "spn-receipt-verify";
      readonly factKey: string;
      readonly evidenceRef: string;
      readonly expectSupplierOrderRef: string;
      readonly expectSerial: string;
      readonly expectAssetTag: string;
      readonly expectCondition: SpineReceiptCondition;
      readonly decidedAt: number;
    })
  | (JourneyStepBase & {
      readonly kind: "spn-receipt-read";
      readonly factKey: string;
      readonly evidenceRef: string;
      /** "foreign" reads through the OTHER tenant's scope (must see nothing). */
      readonly callerTenant?: "own" | "foreign";
    });

export type SpineEnrollmentStep =
  | (JourneyStepBase & {
      readonly kind: "spn-enrollment-open";
      readonly factKey: string;
      readonly evidenceRef: string;
      readonly assetId: string;
      readonly displayName: string;
      readonly assetKind: "vehicle" | "handheld" | "fixed" | "sensor" | "robot" | "other";
      readonly deviceId?: string;
      readonly at: number;
      readonly actor: string;
    })
  | (JourneyStepBase & {
      readonly kind: "spn-enrollment-complete";
      readonly factKey: string;
      readonly serial: string;
      readonly at: number;
      readonly actor: string;
    })
  | (JourneyStepBase & {
      readonly kind: "spn-enrollment-read";
      readonly factKey: string;
      readonly serial: string;
      /** "foreign" reads through the OTHER tenant's scope (must see nothing). */
      readonly callerTenant?: "own" | "foreign";
    })
  | (JourneyStepBase & {
      readonly kind: "spn-registry-read";
      readonly factKey: string;
      readonly assetId: string;
      /** The enrollment lookup key (the twin link is keyed by its device id). */
      readonly serial: string;
      /** "foreign" reads through the OTHER tenant's scope (must see nothing). */
      readonly callerTenant?: "own" | "foreign";
    });
