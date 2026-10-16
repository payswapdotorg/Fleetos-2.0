/**
 * @fleetos/acceptance-commerce — F370C (Wave 18 lane C): the verified-
 * deployment step families. The journeys drive the REAL marketplace
 * deployment service (infrastructure/fleetos-marketplace — spawned as a
 * REAL child process on an ephemeral port, REAL PostgreSQL via pglite)
 * through its HTTP boundary: the F362 transaction-spine shape end-to-end,
 * the F370A/F370B authorization refusals at the boundary, and the
 * backup/restore round-trip whose steps ARE the runbook's procedure
 * (docs/evidence/F370C/report.md; infrastructure/fleetos-marketplace/
 * RUNBOOK.md — the doc and the test can never drift).
 *
 * CENSUS CITATION (the F354 lesson; greps at base b6747b3 recorded in
 * docs/evidence/F370C/report.md §1): the mps-* op family and the journey
 * ids `marketplace-persistence-spine` / `marketplace-boundary-
 * authorization` / `marketplace-backup-restore` are NEW at this base; the
 * service's kernels are composed through its HTTP boundary — never
 * re-driven in-process, never re-claimed from the F361A/B/C/F362 corpora.
 *
 * Time law (D13/D14): single-epoch (T0) by construction — every timestamp
 * is literal journey data; the run anchor never reaches the service.
 * PORTS/TIMESTAMPS NEVER IN JOURNEY OUTPUT: the ephemeral port, the data
 * dir and every wall-clock value stay in the harness; only logical facts
 * surface (the fixture-clock law, byte-identical re-runs).
 *
 * File law: this file holds ONLY the typed step data; the harness lives
 * in drivers-mps-harness.ts; the interpreter in drivers-marketplace-
 * service.ts; the journeys in journeys/f370c-*.ts.
 */

import type { JourneyStepBase } from "./journey-contracts.js";

/** The session selector: a named login (the harness keys tokens by it) —
 *  null presents NO token (the unauthenticated refusal surface). */
export type MpsSessionKey = string | null;

/** One caller-composed supplier verification (built through the REAL
 *  @fleetos/vendors machine by the driver — the F361C composition-site
 *  law: the comparison binds the REAL records at the boundary). */
export interface MpsSupplierSeed {
  readonly supplierId: string;
  readonly evidenceId: string;
  readonly verifiedAt: number;
  readonly expiresAt: number;
}

export type MpsEvidenceKind = "offer-snapshot" | "provider-ack";

export type MpsStep =
  // --- the service lifecycle (the REAL child process) ---
  | (JourneyStepBase & {
      readonly kind: "mps-boot";
      readonly factKey: string;
      /** F372: the MarketplaceStore adapter this service boots over —
       *  "pglite" (default; the F370C in-process mode, zero motion when
       *  absent) or "networked" (REAL PostgreSQL as a separate server
       *  process over TCP — requires a provisioned npg-server first). */
      readonly store?: "pglite" | "networked";
    })
  | (JourneyStepBase & {
      readonly kind: "mps-shutdown";
      readonly factKey: string;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-restart";
      readonly factKey: string;
      /** "kill" = SIGKILL + respawn over the SAME data dir (the crash);
       *  "restore" = SIGKILL + the --restore boot from the last backup
       *  (the runbook's recorded incident path). */
      readonly mode: "kill" | "restore";
      readonly at: number;
    })
  // --- the security plane ---
  | (JourneyStepBase & {
      readonly kind: "mps-provision";
      readonly factKey: string;
      readonly credentialId: string;
      readonly actorId: string;
      readonly tenantId: string;
      readonly secret: string;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-login";
      readonly factKey: string;
      readonly sessionKey: string;
      readonly credentialId: string;
      readonly secret: string;
      readonly scopes: readonly string[];
      readonly ttlMs: number;
      readonly jti: string;
      readonly now: number;
    })
  /** Mint a token through the REAL F370B keyring APIs IN THE DRIVER (the
   *  retired-key surface: the service only issues under the current key —
   *  a retired-key token must be composed at the client, exactly like a
   *  stale holder after rotation). */
  | (JourneyStepBase & {
      readonly kind: "mps-mint-keyed-token";
      readonly factKey: string;
      readonly sessionKey: string;
      readonly keyId: string;
      readonly actorId: string;
      readonly tenantId: string;
      readonly scopes: readonly string[];
      readonly issuedAt: number;
      readonly expiresAt: number;
      readonly jti: string;
    })
  /** Derive a corrupted presentation from an existing session's token
   *  (the tamper + KEY_UNKNOWN surfaces — string surgery on the envelope,
   *  exactly the F370A/F370B adversarial battery). */
  | (JourneyStepBase & {
      readonly kind: "mps-token-surgery";
      readonly factKey: string;
      readonly sessionKey: string;
      readonly sourceSessionKey: string;
      readonly mode: "tamper-payload" | "unknown-key-id";
    })
  | (JourneyStepBase & {
      readonly kind: "mps-revoke";
      readonly factKey: string;
      readonly sessionKey: string;
      readonly mode: "jti" | "actor";
      readonly now: number;
    })
  // --- the verb families (the F362 spine shape over HTTP) ---
  | (JourneyStepBase & {
      readonly kind: "mps-request-submit";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly requestId: string;
      readonly naturalKey: string;
      readonly sku: string;
      readonly quantity: number;
      readonly requiredBy: string;
      readonly at: number;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-request-transition";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly requestId: string;
      readonly command: { readonly type: string; readonly at: number; readonly reason?: string; readonly offerId?: string };
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-offer-capture";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly offer: {
        readonly offerId: string;
        readonly supplierId: string;
        readonly sku: string;
        readonly quantity: number;
        readonly unitCostMinor: number;
        readonly totalCostMinor: number;
        readonly currency: string;
        readonly taxMinor: number;
        readonly feesMinor: number;
        readonly deliveryEstimateDays: number;
        readonly condition: "new" | "certified-refurbished" | "used";
        readonly warrantyMonths: number;
        readonly validFrom: number;
        readonly validUntil: number;
        readonly sourceKind: "operator-entered" | "manual-catalogue-export" | "supplier-message-reference";
        readonly sourceReference: string;
        readonly capturedAt: number;
      };
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-offer-sheet";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly at: number;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-comparison";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly demandSku: string;
      readonly demandCurrency: string;
      readonly acceptableConditions: readonly string[];
      readonly suppliers: readonly MpsSupplierSeed[];
      readonly at: number;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-evidence-retain";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly evidenceKind: MpsEvidenceKind;
      readonly providerEventId: string;
      readonly subjectRef: string;
      readonly sourceSystem: string;
      readonly sourceReference: string;
      readonly retrievedVia: "manual" | "export";
      readonly capturedAtIso: string;
      readonly recordedAtIso: string;
      readonly artifactId: string;
      readonly artifactDescription: string;
      readonly artifactJson: string;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-approval";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly requestId: string;
      readonly orderId: string;
      readonly category: "laptops" | "printers";
      readonly transactionKind: "purchase" | "repair-service";
      readonly units: number;
      readonly amountTotal: number;
      readonly currency: string;
      readonly supplierId: string;
      readonly verificationRef: string;
      readonly offerSnapshotFromEvidence: boolean;
      readonly actorAuthority: readonly string[];
      readonly actorAutonomous: boolean;
      readonly at: number;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-order-draft";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly orderId: string;
      readonly requestId: string;
      readonly offerId: string;
      readonly supplierId: string;
      readonly sku: string;
      readonly quantity: number;
      readonly unitCostMinor: number;
      readonly totalCostMinor: number;
      readonly currency: string;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-order-place";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly orderId: string;
      readonly at: number;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-order-ack";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly orderId: string;
      readonly providerEventId: string;
      /** True = cite the retained provider-ack evidence record (the seam). */
      readonly evidenceFromEvidence: boolean;
      readonly channel: "manual-portal-export" | "manual-email-confirmation" | "manual-invoice-reference";
      readonly acknowledgedAt: number;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-order-transition";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly orderId: string;
      readonly command: { readonly type: string; readonly at: number; readonly reason?: string };
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-receipt-record";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly evidenceRef: string;
      readonly siteId: string;
      readonly supplierOrderRef: string;
      readonly serial: string;
      readonly assetTag: string;
      readonly conditionOnArrival: "new" | "good" | "damaged";
      readonly warrantyRef: string;
      readonly capturedAt: number;
      readonly recordedAt: number;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-receipt-verify";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly evidenceRef: string;
      readonly expectSupplierOrderRef: string;
      readonly expectSerial: string;
      readonly expectAssetTag: string;
      readonly expectCondition: string;
      readonly decidedAt: number;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-enrollment-open";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly evidenceRef: string;
      readonly assetId: string;
      readonly displayName: string;
      readonly assetKind: "vehicle" | "handheld" | "fixed" | "sensor" | "robot" | "other";
      readonly deviceId?: string;
      readonly at: number;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-enrollment-complete";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly serial: string;
      readonly deviceId?: string;
      readonly at: number;
      readonly now: number;
    })
  // --- the proof surface + the runbook ---
  | (JourneyStepBase & {
      readonly kind: "mps-digest";
      readonly factKey: string;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-backup";
      readonly factKey: string;
      readonly now: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mps-state";
      readonly factKey: string;
      readonly sessionKey: MpsSessionKey;
      readonly tenantId: string;
      readonly family: string;
      readonly now: number;
    });
