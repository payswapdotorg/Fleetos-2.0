/**
 * infrastructure/fleetos-marketplace/store.ts — the MarketplaceStore PORT
 * (F370C, Wave 18 lane C).
 *
 * THE frozen operation set over the marketplace transaction-spine state —
 * the EXACT F361A/B/C/F362 record shapes, never re-shaped (the packet's
 * law): requests, offers + retained snapshots, comparison sheets, orders,
 * provider acks, receipts, enrollments, approvals, evidence records, and
 * the F361A authoritative registry (assets + device twins) the enrollment
 * machine consumes through its REAL ports.
 *
 * Architecture laws implemented by EVERY adapter:
 *   - A1 (Architecture Lock): the store IS the authoritative business
 *     truth. This port's pglite adapter runs REAL PostgreSQL (the official
 *     WASM build, in-process); the PORT stays swappable — a networked-PG
 *     adapter at the host boundary is the recorded follow-up, never
 *     pretended here. The F351A JSONL segments are NOT used for
 *     marketplace transaction state (the catalog's standing warning).
 *   - A8: the caller tenant context (from the VERIFIED session, never the
 *     request body alone) is carried through EVERY operation; cross-tenant
 *     reads find NOTHING (null / empty), cross-tenant writes REFUSE.
 *   - A19: the audit journal is append-only, tenant-scoped and covered by
 *     the digest envelope (hash-verifiable).
 *   - WRITE-BEFORE-ACK: every mutating operation commits its PostgreSQL
 *     transaction BEFORE the call resolves — callers only respond to HTTP
 *     after the store returns.
 *
 * Digests (the proof surface): sha-256 over canonical JSON (sorted keys,
 * array order preserved) of each record set in its NATURAL-KEY order —
 * byte-stable across restarts and dump/restore round-trips. The DIGEST
 * ENVELOPE covers the business record sets + the audit and revocation
 * journals (all logical-clocked, caller-supplied time — never a wall
 * clock). The credentials table (host-generated scrypt salts — real
 * entropy, the F370B host-boundary law) and the backups journal (metadata
 * ABOUT the envelope) are persisted and dumped but deliberately NOT part
 * of the envelope — recorded in docs/evidence/F370C/report.md.
 */

import { createHash } from "node:crypto";
import type { EquipmentRequest, MarketplaceEquipmentOrder, MarketplaceOffer } from "@fleetos/procurement";
import type {
  AssetEnrollmentRecord,
  DeviceTwin,
  ManagedAssetRecord,
  ReceiptEvidence,
  ReceiptExpectation,
} from "@fleetos/assets";
import type { MarketplaceOrderApproval } from "@fleetos/policy";
import type { MarketplaceEvidenceRecord } from "@fleetos/evidence";
import type { CredentialRecord } from "@fleetos/identity";

// ---------------------------------------------------------------------------
// The caller scope (A8 — from the VERIFIED session)
// ---------------------------------------------------------------------------

/** The tenant scope every business operation is fail-closed against. */
export interface MarketplaceStoreCaller {
  readonly tenantId: string;
}

// ---------------------------------------------------------------------------
// The persisted wrappers (the F351A Durable*Record precedent: the kernel
// record travels verbatim inside; the wrapper adds only the keys the
// durable plane needs — never a re-shape of the domain record)
// ---------------------------------------------------------------------------

/** A retained comparison sheet — the explainable comparison as data. */
export interface RetainedComparisonSheet {
  /** Content-addressed, deterministic: `mcs-` + digest prefix. */
  readonly sheetId: string;
  readonly tenantId: string;
  readonly demand: { readonly sku: string; readonly currency: string; readonly acceptableConditions: readonly string[] };
  readonly comparedAt: number;
  readonly rankedOfferIds: readonly string[];
  readonly eligibleCount: number;
  readonly ineligibleCount: number;
  readonly topOfferId: string | null;
}

/** The provider-ack journal entry — append-only (A19). */
export interface ProviderAckJournalEntry {
  readonly tenantId: string;
  readonly orderId: string;
  readonly providerEventId: string;
  readonly evidenceId: string;
  readonly channel: string;
  readonly acknowledgedAt: number;
  readonly duplicate: boolean;
}

/** A receipt + (once decided) the verify inputs needed for replay-on-start. */
export interface PersistedReceipt {
  readonly evidence: ReceiptEvidence;
  /** Present once the receipt was decided (verified | discrepancy). */
  readonly verify?: { readonly expectation: ReceiptExpectation; readonly decidedAt: number };
}

/** One boundary/attempt audit entry — append-only (A19), logical time only. */
export interface MarketplaceAuditEntry {
  /** Logical epoch ms (caller-supplied — the corpus law, never a wall clock). */
  readonly at: number;
  readonly tenantId: string;
  readonly actorId: string;
  readonly family: string;
  readonly op: string;
  readonly ok: boolean;
  readonly duplicate: boolean;
  /** Machine-stable detail (reason codes / ids) — never token or key material. */
  readonly detail: string;
}

/** A persisted session revocation (the F370B registry's durable feed). */
export interface RevocationJournalEntry {
  readonly cause: "jti" | "actor";
  readonly jti: string | null;
  readonly actorId: string;
  readonly tenantId: string;
  readonly revokedAt: number;
}

/** One backup/restore event — journaled as data (the runbook's ledger). */
export interface BackupJournalEntry {
  readonly kind: "dump" | "restore";
  readonly at: number;
  readonly recordCounts: Readonly<Record<string, number>>;
  readonly envelopeDigest: string;
}

// ---------------------------------------------------------------------------
// Digests + counts (the operator proof surface)
// ---------------------------------------------------------------------------

/** The record sets covered by the digest envelope (machine-stable order). */
export const DIGEST_RECORD_SETS: readonly string[] = [
  "requests", "offers", "comparisonSheets", "orders", "providerAcks", "receipts",
  "enrollments", "approvals", "evidence", "assets", "twins", "audit", "revocations",
] as const;

export type MarketplaceStoreDigests = Readonly<Record<string, string>> & { readonly total: string };

export type MarketplaceStoreCounts = Readonly<Record<string, number>>;

/** The boot verification report (observability as data — no records). */
export interface StoreVerifyReport {
  readonly ok: boolean;
  readonly receiptsReplayed: number;
  readonly receiptsVerifiedByteExact: number;
  readonly revocationsReplayed: number;
  readonly recordsLoaded: number;
}

// ---------------------------------------------------------------------------
// The backup/restore contract
// ---------------------------------------------------------------------------

/** The single-file dump format — canonical JSON, deterministic byte form. */
export const DUMP_FORMAT = "fleetos-marketplace-dump/1" as const;

export interface StoreDumpEnvelope {
  readonly counts: Readonly<Record<string, number>>;
  readonly digests: MarketplaceStoreDigests;
}

export interface RestoreReport {
  readonly ok: boolean;
  /** The record-set digests recomputed from the RESTORED store (must equal the file's envelope). */
  readonly digests: MarketplaceStoreDigests;
  readonly counts: Readonly<Record<string, number>>;
}

export type RestoreRefusalReason = "malformed-dump" | "envelope-mismatch" | "record-set-mismatch";

export type RestoreResult =
  | { readonly ok: true; readonly report: RestoreReport }
  | { readonly ok: false; readonly reason: RestoreRefusalReason; readonly detail: string };

// ---------------------------------------------------------------------------
// The PORT
// ---------------------------------------------------------------------------

/**
 * MarketplaceStore — the frozen operation set. The pglite adapter
 * (pglite-store.ts) is the reference implementation; a networked-PostgreSQL
 * adapter at the host boundary implements the same port (the recorded
 * follow-up). All operations are asynchronous (a real database); all
 * business operations are caller-tenant fail-closed (A8).
 */
export interface MarketplaceStore {
  // --- F361C requests (EquipmentRequest — latest state per natural key) ---
  saveRequest(caller: MarketplaceStoreCaller, record: EquipmentRequest): Promise<void>;
  listRequests(caller: MarketplaceStoreCaller): Promise<readonly EquipmentRequest[]>;

  // --- F361C offers (MarketplaceOffer) ---
  saveOffer(caller: MarketplaceStoreCaller, offer: MarketplaceOffer): Promise<void>;
  listOffers(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceOffer[]>;

  // --- retained comparison sheets (append-only, content-addressed) ---
  appendComparisonSheet(caller: MarketplaceStoreCaller, sheet: RetainedComparisonSheet): Promise<{ readonly duplicate: boolean }>;
  listComparisonSheets(caller: MarketplaceStoreCaller): Promise<readonly RetainedComparisonSheet[]>;

  // --- F361C orders (MarketplaceEquipmentOrder — latest state) ---
  saveOrder(caller: MarketplaceStoreCaller, order: MarketplaceEquipmentOrder): Promise<void>;
  findOrder(caller: MarketplaceStoreCaller, orderId: string): Promise<MarketplaceEquipmentOrder | null>;
  listOrders(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceEquipmentOrder[]>;

  // --- provider-ack journal (append-only) ---
  appendProviderAck(caller: MarketplaceStoreCaller, entry: ProviderAckJournalEntry): Promise<void>;
  listProviderAcks(caller: MarketplaceStoreCaller): Promise<readonly ProviderAckJournalEntry[]>;

  // --- F361A receipts (ReceiptEvidence + replay inputs) ---
  saveReceipt(caller: MarketplaceStoreCaller, record: PersistedReceipt): Promise<void>;
  listReceipts(caller: MarketplaceStoreCaller): Promise<readonly PersistedReceipt[]>;
  /** Boot-only maintenance read (the service's own rehydration). */
  listAllReceipts(): Promise<readonly PersistedReceipt[]>;

  // --- F361A enrollments (AssetEnrollmentRecord — the registry key) ---
  saveEnrollment(caller: MarketplaceStoreCaller, record: AssetEnrollmentRecord): Promise<void>;
  findEnrollment(caller: MarketplaceStoreCaller, serial: string): Promise<AssetEnrollmentRecord | null>;
  listEnrollments(caller: MarketplaceStoreCaller): Promise<readonly AssetEnrollmentRecord[]>;

  // --- F361B approvals (MarketplaceOrderApproval — evaluated data, approve OR refuse) ---
  appendApproval(caller: MarketplaceStoreCaller, approval: MarketplaceOrderApproval): Promise<void>;
  listApprovals(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceOrderApproval[]>;

  // --- marketplace evidence (MarketplaceEvidenceRecord — content-addressed, provider-event dedup) ---
  insertEvidenceIfAbsent(caller: MarketplaceStoreCaller, record: MarketplaceEvidenceRecord): Promise<{ readonly inserted: boolean }>;
  findEvidenceByProviderEvent(caller: MarketplaceStoreCaller, providerEventId: string): Promise<MarketplaceEvidenceRecord | null>;
  listEvidence(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceEvidenceRecord[]>;

  // --- the F361A authoritative registry (the REAL ports' backing) ---
  saveAsset(caller: MarketplaceStoreCaller, asset: ManagedAssetRecord): Promise<void>;
  findAsset(caller: MarketplaceStoreCaller, assetId: string): Promise<ManagedAssetRecord | null>;
  listAssets(caller: MarketplaceStoreCaller): Promise<readonly ManagedAssetRecord[]>;
  saveTwin(caller: MarketplaceStoreCaller, twin: DeviceTwin): Promise<void>;
  findTwin(caller: MarketplaceStoreCaller, deviceId: string): Promise<DeviceTwin | null>;
  /** Boot-only maintenance reads (the service's own rehydration — the
   *  single-writer operator context; never exposed over HTTP). */
  listAllAssets(): Promise<readonly ManagedAssetRecord[]>;
  listAllEnrollments(): Promise<readonly AssetEnrollmentRecord[]>;
  listAllTwins(): Promise<readonly DeviceTwin[]>;

  // --- operational identity (credential records — host-generated salts, NOT in the digest envelope) ---
  saveCredential(record: CredentialRecord): Promise<void>;
  findCredential(credentialId: string): Promise<CredentialRecord | null>;

  // --- journals (append-only; audit + revocations ARE in the digest envelope) ---
  appendAudit(caller: MarketplaceStoreCaller, entry: MarketplaceAuditEntry): Promise<void>;
  listAudit(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceAuditEntry[]>;
  listAllAudit(): Promise<readonly MarketplaceAuditEntry[]>;
  appendRevocation(entry: RevocationJournalEntry): Promise<void>;
  listRevocations(): Promise<readonly RevocationJournalEntry[]>;
  appendBackupJournal(entry: BackupJournalEntry): Promise<void>;
  listBackupJournal(): Promise<readonly BackupJournalEntry[]>;

  // --- the proof surface ---
  /** Full-store record-set digests + counts (the digest envelope — deterministic). */
  digestReport(): Promise<{ readonly digests: MarketplaceStoreDigests; readonly counts: MarketplaceStoreCounts }>;

  // --- backup/restore (the runbook's recorded path — never ad-hoc SQL) ---
  /** Produce the single-file dump (canonical JSON, deterministic byte form). */
  dumpStore(): Promise<string>;
  /** Wipe + import + re-verify. Fail-closed: refuses to serve mutated history. */
  restoreStore(dump: string): Promise<RestoreResult>;

  // --- lifecycle ---
  /** One atomic boundary for a request's multi-record writes (the business
   *  record + its journal entries commit together or not at all). */
  transact<T>(fn: (tx: MarketplaceStore) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Canonical JSON + digests (the repo convention family, sha-256)
// ---------------------------------------------------------------------------

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Digests over the envelope's record sets — machine-stable per-set order. */
export function digestsOfRecordSets(recordSets: Readonly<Record<string, readonly unknown[]>>): MarketplaceStoreDigests {
  const digests: Record<string, string> = {};
  let totalInput = "";
  for (const name of DIGEST_RECORD_SETS) {
    const records = recordSets[name] ?? [];
    digests[name] = sha256Hex(canonicalJson(records));
    totalInput += `${name}:${digests[name]}\n`;
  }
  digests["total"] = sha256Hex(totalInput);
  return digests as MarketplaceStoreDigests;
}
