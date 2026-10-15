/**
 * infrastructure/fleetos-marketplace/recovery.ts — replay/verify-on-start
 * (F370C, Wave 18 lane C; the F351A law).
 *
 * On every boot the service rebuilds its operational state FROM the
 * authoritative PostgreSQL store and VERIFIES it:
 *
 *   - the F361A registry ports rehydrate (assets, twins, enrollments) —
 *     the mirrors are born empty and loaded from the database;
 *   - the F361A receipts replay through the REAL
 *     ReceiptEnrollmentDirectory: each persisted receipt is re-recorded
 *     (and re-decided, when it was decided) through the directory's own
 *     public methods, and the regenerated ReceiptEvidence is verified
 *     BYTE-EXACT (canonical JSON) against the persisted record — any
 *     mismatch is a corrupted or incompatible history and the service
 *     REFUSES TO START (fail-closed, never silently serving a mutated
 *     record set);
 *   - the F370B session-revocation journal replays into the in-memory
 *     registry (the F370B "persistent revocation is F370C/server-wiring
 *     class" limitation — closed here: revocations survive restarts).
 *
 * The pure-function kernels (F361C requests/offers/orders, the comparison,
 * the F361B approval contract) are stateless over record populations —
 * their state IS the record set, loaded per request from the store — so
 * there is nothing to re-drive: verify-on-start for them is the digest
 * report (health) + the structural parse of every loaded record.
 */

import type { ReceiptEnrollmentDirectory } from "@fleetos/assets";
import type { SessionRevocationRegistry } from "@fleetos/identity";
import type { PgRegistryPorts } from "./ports.js";
import type { MarketplaceStore, PersistedReceipt, StoreVerifyReport } from "./store.js";
import { canonicalJson } from "./store.js";

/** Replay + verify the F361A receipts through the REAL directory.
 *  Throws (fail-closed) on any inconsistency. */
function replayReceipts(directory: ReceiptEnrollmentDirectory, persisted: readonly PersistedReceipt[]): { replayed: number; verified: number } {
  let verified = 0;
  for (const record of persisted) {
    const evidence = record.evidence;
    const recorded = directory.recordReceipt({
      evidenceRef: evidence.evidenceRef,
      tenantId: evidence.tenantId,
      siteId: evidence.siteId,
      supplierOrderRef: evidence.supplierOrderRef,
      serial: evidence.serial,
      assetTag: evidence.assetTag,
      conditionOnArrival: evidence.conditionOnArrival,
      warrantyRef: evidence.warrantyRef,
      capturedAt: evidence.capturedAt,
      recordedAt: evidence.recordedAt,
    });
    if (!recorded.ok) {
      throw new Error(`receipt ${evidence.evidenceRef}: replay recordReceipt refused (${recorded.reason}) — fail-closed`);
    }
    let current = recorded.evidence;
    if (record.verify !== undefined) {
      const decided = directory.verifyReceipt({
        tenantId: evidence.tenantId,
        evidenceRef: evidence.evidenceRef,
        expectation: record.verify.expectation,
        decidedAt: record.verify.decidedAt,
      });
      if (!decided.ok) {
        throw new Error(`receipt ${evidence.evidenceRef}: replay verifyReceipt refused (${decided.reason}) — fail-closed`);
      }
      current = decided.evidence;
      verified += 1;
    }
    if (canonicalJson(current) !== canonicalJson(evidence)) {
      throw new Error(`receipt ${evidence.evidenceRef}: replay regenerated a byte-different record — fail-closed (refusing to serve mutated history)`);
    }
  }
  return { replayed: persisted.length, verified };
}

/** The full boot verification. Throws (fail-closed) on any inconsistency. */
export async function verifyOnStart(input: {
  readonly store: MarketplaceStore;
  readonly ports: PgRegistryPorts;
  readonly directory: ReceiptEnrollmentDirectory;
  readonly registry: SessionRevocationRegistry;
}): Promise<StoreVerifyReport> {
  const registryCounts = await input.ports.load();
  const receipts = await input.store.listAllReceipts();
  const receiptOutcome = replayReceipts(input.directory, receipts);
  let revocationsReplayed = 0;
  for (const entry of await input.store.listRevocations()) {
    if (entry.cause === "actor") {
      input.registry.revokeActor(entry.actorId, entry.revokedAt);
    } else if (entry.jti !== null) {
      input.registry.revoke(entry.jti, entry.revokedAt);
    }
    revocationsReplayed += 1;
  }
  return {
    ok: true,
    receiptsReplayed: receiptOutcome.replayed,
    receiptsVerifiedByteExact: receiptOutcome.verified,
    revocationsReplayed,
    recordsLoaded: registryCounts.assets + registryCounts.twins + registryCounts.enrollments + receiptOutcome.replayed,
  };
}
