/**
 * F251 idempotency-law tests — THE cross-adapter machine proof: at-least-once
 * delivery → exactly-once applied effect, over the REAL lane dedup seams
 * (adcos command journal, aurum sync batch re-apply, apify actor-job
 * idempotency, vendors catalog import dedupe). Duplicate submissions ack;
 * ONE state mutation per key everywhere; violations name adapter + key.
 */

import { describe, expect, it } from "vitest";
import {
  emptyCommandJournal,
  issueAdcosCommand,
  type CommandJournalState,
} from "@fleetos/adcos";
import { applyDeltaBatch, openProjectionStore } from "@fleetos/aurum";
import { createActorJobIdempotent } from "@fleetos/apify";
import { importCatalogBatch, openVendorCatalog } from "@fleetos/external-vendors";
import { proveIdempotencyLaw, type AdapterIdempotencyProbe } from "../src/idempotency-law.js";
import { AURUM_SOURCE, NOW, TENANT, aurumDelta } from "./helpers.js";

// ---------------------------------------------------------------------------
// REAL lane seams, driven to duplicate submissions (at-least-once delivery).
// ---------------------------------------------------------------------------

function adcosTrace(): { journal: CommandJournalState; duplicateReplay: boolean } {
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

function aurumTrace(): { appliedFirst: number; appliedReplay: number; storeDigest: string; replayDigest: string } {
  const opened = openProjectionStore({ tenantId: TENANT }, AURUM_SOURCE);
  if (!opened.ok) throw new Error(`aurum store refused: ${opened.reasonCode}`);
  const batch = {
    kind: "external-projection-batch" as const,
    tenant: { tenantId: TENANT },
    source: AURUM_SOURCE,
    deltas: [aurumDelta("ext-100", 100), aurumDelta("ext-101", 101)],
  };
  const first = applyDeltaBatch(opened.store, batch);
  if (!first.ok) throw new Error(`aurum apply refused: ${first.reasonCode}`);
  const replay = applyDeltaBatch(first.store, batch);
  if (!replay.ok) throw new Error(`aurum re-apply refused: ${replay.reasonCode}`);
  return {
    appliedFirst: first.outcome.applied.length,
    appliedReplay: replay.outcome.applied.length,
    storeDigest: first.store.storeDigest,
    replayDigest: replay.store.storeDigest,
  };
}

function apifyTrace(): { first: { duplicate: boolean }; replay: { duplicate: boolean } } {
  const draft = {
    tenant: { tenantId: TENANT },
    jobId: "job-idem-1",
    actorId: "actor-prices-v1",
    input: { url: "https://example.test/prices" },
    idempotencyKey: "ik-apify-health-1",
    window: "2025-W01",
    now: NOW - 5_000,
    expiresAt: null,
  };
  const first = createActorJobIdempotent([], draft);
  if (!first.ok) throw new Error(`apify create refused: ${first.reasonCode}`);
  const replay = createActorJobIdempotent([first.job], draft);
  if (!replay.ok) throw new Error(`apify re-create refused: ${replay.reasonCode}`);
  return { first: { duplicate: first.duplicate }, replay: { duplicate: replay.duplicate } };
}

function vendorsTrace(): { entriesFirst: number; entriesReplay: number } {
  const opened = openVendorCatalog({ tenantId: TENANT }, "vendor-crm-01");
  if (!opened.ok) throw new Error(`vendors catalog refused: ${opened.reasonCode}`);
  const entries = [
    { externalId: "ext-200", vendorExternalId: "ext-200", displayName: "Vendor 200", capabilities: ["catalog-sync"], logicalTime: 100 },
  ];
  const first = importCatalogBatch(opened.catalog, entries, NOW - 50_000);
  if (!first.ok) throw new Error(`vendors import refused: ${first.reasonCode}`);
  const replay = importCatalogBatch(first.catalog, entries, NOW - 10_000);
  if (!replay.ok) throw new Error(`vendors re-import refused: ${replay.reasonCode}`);
  return { entriesFirst: first.catalog.entries.size, entriesReplay: replay.catalog.entries.size };
}

// ---------------------------------------------------------------------------
// THE LAW — one machine proof across ALL adapters.
// ---------------------------------------------------------------------------

describe("idempotency-law — THE cross-adapter machine proof", () => {
  it("at-least-once delivery → exactly-once applied effect on EVERY adapter seam", () => {
    const adcos = adcosTrace();
    const aurum = aurumTrace();
    const apify = apifyTrace();
    const vendors = vendorsTrace();

    // The REAL seams acked the duplicates (no second mutation anywhere).
    expect(adcos.duplicateReplay).toBe(true);
    expect(adcos.journal.byId.size).toBe(1);
    expect(aurum.appliedFirst).toBe(2);
    expect(aurum.appliedReplay).toBe(0); // fully-duplicate re-delivery
    expect(aurum.storeDigest).toBe(aurum.replayDigest); // byte-identical store
    expect(apify.replay.duplicate).toBe(true);
    expect(vendors.entriesFirst).toBe(1);
    expect(vendors.entriesReplay).toBe(1);

    // The probes mirror the REAL delivery traces: 1 mutation on first
    // delivery, 0 on every re-delivery.
    const probes: readonly AdapterIdempotencyProbe[] = [
      {
        adapter: "adcos",
        tenantId: TENANT,
        deliveries: [
          { key: "ik-adcos-health-1", effectDigest: "d-adcos", mutations: 1 },
          { key: "ik-adcos-health-1", effectDigest: "d-adcos", mutations: 0 },
          { key: "ik-adcos-health-1", effectDigest: "d-adcos", mutations: 0 },
        ],
      },
      {
        adapter: "aurum",
        tenantId: TENANT,
        deliveries: [
          { key: "ik-aurum-ext-100-100", effectDigest: "d-aurum-1", mutations: 1 },
          { key: "ik-aurum-ext-101-101", effectDigest: "d-aurum-2", mutations: 1 },
          { key: "ik-aurum-ext-100-100", effectDigest: "d-aurum-1", mutations: 0 },
          { key: "ik-aurum-ext-101-101", effectDigest: "d-aurum-2", mutations: 0 },
        ],
      },
      {
        adapter: "apify",
        tenantId: TENANT,
        deliveries: [
          { key: "ik-apify-health-1", effectDigest: "d-apify", mutations: 1 },
          { key: "ik-apify-health-1", effectDigest: "d-apify", mutations: 0 },
        ],
      },
      {
        adapter: "vendors",
        tenantId: TENANT,
        deliveries: [
          { key: "ext-200", effectDigest: "d-vendors", mutations: 1 },
          { key: "ext-200", effectDigest: "d-vendors", mutations: 0 },
        ],
      },
    ];
    const proof = proveIdempotencyLaw(probes);
    expect(proof.ok).toBe(true);
    expect(proof.checked).toBe(11);
    expect(typeof proof.digest).toBe("string");
  });

  it("a second identical prove call is byte-identical (determinism, zero randomness)", () => {
    const probes: readonly AdapterIdempotencyProbe[] = [
      {
        adapter: "adcos",
        tenantId: TENANT,
        deliveries: [
          { key: "k1", effectDigest: "d1", mutations: 1 },
          { key: "k1", effectDigest: "d1", mutations: 0 },
        ],
      },
    ];
    expect(JSON.stringify(proveIdempotencyLaw(probes))).toBe(JSON.stringify(proveIdempotencyLaw(probes)));
  });
});

describe("idempotency-law — violation reports name the offending adapter + key", () => {
  it("duplicate-mutated: a re-delivery that mutates violates the law", () => {
    const proof = proveIdempotencyLaw([
      {
        adapter: "aurum",
        tenantId: TENANT,
        deliveries: [
          { key: "k-bad", effectDigest: "d", mutations: 1 },
          { key: "k-bad", effectDigest: "d", mutations: 1 },
        ],
      },
    ]);
    expect(proof.ok).toBe(false);
    if (proof.ok) return;
    expect(proof.violations).toEqual([
      { adapter: "aurum", key: "k-bad", violation: "duplicate-mutated", detail: proof.violations[0]!.detail },
    ]);
    expect(proof.violations[0]!.detail).toContain("k-bad");
  });

  it("key-conflict: the same key with different effect digests violates the law", () => {
    const proof = proveIdempotencyLaw([
      {
        adapter: "apify",
        tenantId: TENANT,
        deliveries: [
          { key: "k-x", effectDigest: "d-a", mutations: 1 },
          { key: "k-x", effectDigest: "d-b", mutations: 0 },
        ],
      },
    ]);
    expect(proof.ok).toBe(false);
    if (proof.ok) return;
    expect(proof.violations[0]!.adapter).toBe("apify");
    expect(proof.violations[0]!.key).toBe("k-x");
    expect(proof.violations[0]!.violation).toBe("key-conflict");
  });

  it("first-delivery-no-effect: a first delivery with zero mutations violates the law", () => {
    const proof = proveIdempotencyLaw([
      { adapter: "vendors", tenantId: TENANT, deliveries: [{ key: "k-void", effectDigest: "d", mutations: 0 }] },
    ]);
    expect(proof.ok).toBe(false);
    if (proof.ok) return;
    expect(proof.violations[0]!.violation).toBe("first-delivery-no-effect");
    expect(proof.violations[0]!.key).toBe("k-void");
  });

  it("violations sort deterministically (adapter, key, violation)", () => {
    const proof = proveIdempotencyLaw([
      { adapter: "vendors", tenantId: TENANT, deliveries: [{ key: "b", effectDigest: "d", mutations: 0 }] },
      { adapter: "adcos", tenantId: TENANT, deliveries: [{ key: "z", effectDigest: "d", mutations: 0 }] },
    ]);
    expect(proof.ok).toBe(false);
    if (proof.ok) return;
    expect(proof.violations.map((v) => [v.adapter, v.key])).toEqual([["adcos", "z"], ["vendors", "b"]]);
  });
});
