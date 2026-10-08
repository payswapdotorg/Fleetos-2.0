/**
 * F251 idempotency-ledger tests — the shared IdempotencyLedger (duplicate
 * acks, typed key conflicts, fail-closed inputs), the REAL lane binders
 * (adcos journal / aurum session / apify jobs / vendors catalog), the merged
 * cross-adapter ledger, and the law digest.
 *
 * Split from idempotency-law.test.ts (file-size law <= 400 lines).
 */

import { describe, expect, it } from "vitest";
import { emptyCommandJournal, issueAdcosCommand } from "@fleetos/adcos";
import {
  applyFetchedBatch,
  beginFetching,
  openProjectionStore,
  openSyncSession,
} from "@fleetos/aurum";
import { createActorJob } from "@fleetos/apify";
import {
  bindAdcosCommandKeys,
  bindApifyJobKeys,
  bindAurumSessionKeys,
  bindVendorsCatalogKeys,
  emptyIdempotencyLedger,
  idempotencyLawDigest,
  idempotencyLedgerKeyOf,
  mergeIdempotencyRecords,
  submitIdempotent,
  verifyIdempotencyLawDigest,
} from "../src/idempotency-law.js";
import { AURUM_SOURCE, NOW, TENANT, aurumDelta, vendorsSlice } from "./helpers.js";

// The adcos REAL-journal trace (duplicate issue → duplicate ack).
function adcosTrace(): { journal: ReturnType<typeof emptyCommandJournal>; duplicateReplay: boolean } {
  const input = {
    tenantId: TENANT,
    deviceId: "dev_truck-001",
    kind: "ping" as const,
    idempotencyKey: "ik-adcos-health-1",
    actor: "act_healthop",
    at: NOW - 10_000,
  };
  const first = issueAdcosCommand(emptyCommandJournal(), input);
  if (!first.ok) throw new Error(`adcos issue refused: ${first.reason}`);
  const replay = issueAdcosCommand(first.state, input);
  if (!replay.ok) throw new Error(`adcos re-issue refused: ${replay.reason}`);
  return { journal: first.state, duplicateReplay: replay.duplicate };
}

describe("idempotency-law — the shared ledger", () => {
  it("first submission applies (ONE entry); duplicate submission ACKS with no new entry", () => {
    const first = submitIdempotent(emptyIdempotencyLedger(), {
      adapter: "adcos", scope: "command", tenantId: TENANT, key: "k-1", effectDigest: "d-1", now: NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.duplicate).toBe(false);
    expect(first.record.deliveries).toBe(1);
    const replay = submitIdempotent(first.ledger, {
      adapter: "adcos", scope: "command", tenantId: TENANT, key: "k-1", effectDigest: "d-1", now: NOW + 1,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.duplicate).toBe(true);
    expect(replay.ledger.entries.size).toBe(1);
    expect(replay.record.deliveries).toBe(2);
    expect(replay.record.appliedAt).toBe(NOW); // the ORIGINAL application time
  });

  it("a key re-used for a DIFFERENT effect is a typed conflict naming adapter + key", () => {
    const first = submitIdempotent(emptyIdempotencyLedger(), {
      adapter: "apify", scope: "actor-job", tenantId: TENANT, key: "k-1", effectDigest: "d-1", now: NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const conflict = submitIdempotent(first.ledger, {
      adapter: "apify", scope: "actor-job", tenantId: TENANT, key: "k-1", effectDigest: "d-OTHER", now: NOW,
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.reason).toBe("idempotency-key-conflict");
    expect(conflict.adapter).toBe("apify");
    expect(conflict.key).toBe("k-1");
    expect(conflict.detail).toContain("k-1");
  });

  it("fail-closed inputs: missing tenant, missing key, missing effect digest", () => {
    for (const bad of [
      { tenantId: "", key: "k", effectDigest: "d", reason: "missing-tenant" },
      { tenantId: TENANT, key: "", effectDigest: "d", reason: "missing-key" },
      { tenantId: TENANT, key: "k", effectDigest: "", reason: "missing-effect-digest" },
    ] as const) {
      const result = submitIdempotent(emptyIdempotencyLedger(), {
        adapter: "aurum", scope: "sync-batch", tenantId: bad.tenantId, key: bad.key, effectDigest: bad.effectDigest, now: NOW,
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe(bad.reason);
    }
  });

  it("the ledger key is tenant-scoped (tenant + scope + key)", () => {
    expect(idempotencyLedgerKeyOf(TENANT, "command", "k")).toBe(`${TENANT}␟command␟k`);
  });
});

describe("idempotency-law — REAL lane binders + the merged ledger", () => {
  it("bindAdcosCommandKeys reads the REAL command journal's idempotency index", () => {
    const { journal } = adcosTrace();
    const records = bindAdcosCommandKeys(journal);
    expect(records.length).toBe(1);
    expect(records[0]!.adapter).toBe("adcos");
    expect(records[0]!.scope).toBe("command");
    expect(records[0]!.key).toBe("ik-adcos-health-1");
    expect(records[0]!.effectDigest).not.toBe("");
  });

  it("bindAurumSessionKeys reads a REAL committed sync session's applied keys", () => {
    const opened = openProjectionStore({ tenantId: TENANT }, AURUM_SOURCE);
    if (!opened.ok) throw new Error(`aurum store refused: ${opened.reasonCode}`);
    const sessionOpened = openSyncSession({
      tenant: { tenantId: TENANT },
      source: AURUM_SOURCE,
      sessionId: "sess-1",
      startCursor: { source: AURUM_SOURCE, logicalTime: 0, sequence: 0 },
      now: NOW - 4_000,
    });
    if (!sessionOpened.ok) throw new Error(`aurum session refused: ${sessionOpened.reasonCode}`);
    const fetching = beginFetching(sessionOpened.session, NOW - 3_900);
    if (!fetching.ok) throw new Error(`aurum beginFetching refused: ${fetching.reasonCode}`);
    const applied = applyFetchedBatch(
      fetching.session,
      opened.store,
      { kind: "external-projection-batch", tenant: { tenantId: TENANT }, source: AURUM_SOURCE, deltas: [aurumDelta("ext-300", 300)] },
      NOW - 3_800,
    );
    if (!applied.ok) throw new Error(`aurum applyFetchedBatch refused: ${applied.reasonCode}`);
    const records = bindAurumSessionKeys(applied.session);
    expect(records.length).toBe(1);
    expect(records[0]!.adapter).toBe("aurum");
    expect(records[0]!.scope).toBe("sync-batch");
    expect(records[0]!.key).toBe("ik-aurum-ext-300-300");
    expect(records[0]!.effectDigest).not.toBe("");
  });

  it("bindApifyJobKeys + bindVendorsCatalogKeys read the REAL lane records", () => {
    const draft = {
      tenant: { tenantId: TENANT },
      jobId: "job-bind-1",
      actorId: "actor-prices-v1",
      input: { url: "https://example.test/x" },
      idempotencyKey: "ik-bind-1",
      window: "2025-W01",
      now: NOW,
      expiresAt: null,
    };
    const created = createActorJob(draft);
    if (!created.ok) throw new Error(`apify create refused: ${created.reasonCode}`);
    const apifyRecords = bindApifyJobKeys([created.job]);
    expect(apifyRecords[0]!.key).toBe("ik-bind-1");
    expect(apifyRecords[0]!.effectDigest).toBe(created.job.manifest.manifestDigest);

    const vendors = vendorsSlice();
    const vendorRecords = bindVendorsCatalogKeys(vendors.catalog);
    expect(vendorRecords.length).toBe(1);
    expect(vendorRecords[0]!.scope).toBe("catalog-import");
    expect(vendorRecords[0]!.key).toBe("ext-crm-001");
    expect(vendorRecords[0]!.effectDigest).not.toBe("");
  });

  it("mergeIdempotencyRecords enforces the law across adapters; conflicts name the adapter + key", () => {
    const { journal } = adcosTrace();
    const adcosRecords = bindAdcosCommandKeys(journal);
    const vendors = vendorsSlice();
    const vendorRecords = bindVendorsCatalogKeys(vendors.catalog);
    const adcosMerged = mergeIdempotencyRecords(emptyIdempotencyLedger(), adcosRecords);
    expect(adcosMerged.ok).toBe(true);
    if (!adcosMerged.ok) return;
    const merged = mergeIdempotencyRecords(adcosMerged.ledger, vendorRecords);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.ledger.entries.size).toBe(2);

    const conflicting = [{ ...vendorRecords[0]!, effectDigest: "different-effect" }];
    const conflict = mergeIdempotencyRecords(merged.ledger, conflicting);
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.reason).toBe("idempotency-key-conflict");
    expect(conflict.adapter).toBe("vendors");
    expect(conflict.key).toBe("ext-crm-001");
  });

  it("law digest + verify; tampering the digest fails verification", () => {
    const { journal } = adcosTrace();
    const merged = mergeIdempotencyRecords(emptyIdempotencyLedger(), bindAdcosCommandKeys(journal));
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const digest = idempotencyLawDigest(merged.ledger);
    expect(verifyIdempotencyLawDigest(merged.ledger, digest)).toBe(true);
    expect(verifyIdempotencyLawDigest(merged.ledger, "health_deadbeef")).toBe(false);
    // The digest is order-independent over the entries map.
    const reordered: typeof merged.ledger = {
      entries: new Map([...merged.ledger.entries.entries()].reverse()),
    };
    expect(idempotencyLawDigest(reordered)).toBe(digest);
  });
});
