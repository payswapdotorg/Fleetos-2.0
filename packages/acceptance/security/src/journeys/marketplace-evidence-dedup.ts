/**
 * F361B journey 2 — marketplace evidence dedup discipline (persona:
 * compliance-auditor).
 *
 * CENSUS CITATION (F361B, census-first with grep proof at base cefd588):
 * zero matches for "marketplace-evidence-dedup-discipline" /
 * "dedup-discipline" / "provider-ack" across packages/acceptance/** (grep
 * logs in docs/evidence/F361B/report.md §2). The nearest existing claim is
 * the security corpus's own
 * "security.evidence-artifact-store-completeness" (F341B) — the
 * content-addressed ARTIFACT store (bytes-level dedup, bundle
 * completeness), a DISTINCT surface from THIS journey's angle: the
 * MARKPLACE evidence-retention contract (provider-EVENT dedup with
 * first-write-wins + tenant-scoped fail-closed reads/writes + source and
 * captured-at freshness).
 *
 * The auditor proves the F360 §3.6 retention laws end-to-end over the
 * REAL public entry points:
 *   - InMemoryMarketplaceEvidenceStore.recordEvidence (packages/evidence)
 *     — the four frozen marketplace artifact kinds retained with source +
 *     captured-at provenance;
 *   - duplicate-event refusal — the same provider event id presented twice
 *     returns the ORIGINAL record (never a second conclusion); a DIVERGENT
 *     re-presentation is flagged but the original still wins and the store
 *     never grows;
 *   - tenant fail-closed reads (null/[] — indistinguishable from absence)
 *     and writes (refused.tenant_mismatch, store unchanged); provider-event
 *     dedup never crosses tenants;
 *   - intake refusals (future-dated capturedAt — untrusted external
 *     events) and the deterministic freshness classification.
 *
 * NOTE (async-signature family — the F321B async-dispatch law, the F341B
 * artifact-store precedent): the evidence store's methods carry Promise
 * signatures over the port seam, and the corpus runner executes
 * synchronous steps by contract. The REAL APIs are driven to completion
 * at MODULE EVALUATION TIME via top-level await over the deterministic
 * in-memory store: fixed payloads, caller-supplied logical timestamps, no
 * clock, no randomness, no network, no timers — the promises resolve on
 * pure microtasks. ESM evaluation-order semantics guarantee the results
 * are complete before ANY consumer's module body runs. The resolved
 * values are frozen as module constants; the sync steps record them as
 * facts; the runner's determinism law holds byte-identically (the family
 * has NO wall-clock surface at all — anchor-invariant by construction).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { InMemoryMarketplaceEvidenceStore, classifyMarketplaceEvidenceFreshness } from "@fleetos/evidence";
import type { MarketplaceEvidenceInput, MarketplaceEvidenceRecordOutcome } from "@fleetos/evidence";
import { buildArtifact, utf8Bytes } from "@fleetos/evidence";
import { TENANT, FOREIGN_TENANT } from "./fixture-world.ts";

const AT = "2026-10-12T18:45:00.000Z";
const CAPTURED = "2026-10-12T18:40:00.000Z";
const FRESH_WINDOW = { freshWithinMs: 600_000 };

function input(overrides: Partial<MarketplaceEvidenceInput> = {}): MarketplaceEvidenceInput {
  return {
    tenantId: TENANT.tenantId,
    providerEventId: "prov-event-offer-1",
    kind: "marketplace.offer-snapshot",
    subjectRef: "order-100",
    source: { system: "manual-catalogue-import", reference: "catalogue-2026-10.ods", retrievedVia: "manual" },
    capturedAt: CAPTURED,
    artifacts: [buildArtifact("art-j2", utf8Bytes(JSON.stringify({ offerId: "offer-1", total: 9_500 })), "application/json", "offer snapshot for order-100")],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The REAL async APIs, driven to completion at module evaluation (TLA).
// Every value below is a frozen deterministic fact.
// ---------------------------------------------------------------------------

const STORE = new InMemoryMarketplaceEvidenceStore();

const KIND_INPUTS: readonly { readonly kind: MarketplaceEvidenceInput["kind"]; readonly event: string; readonly system: string }[] = [
  { kind: "marketplace.offer-snapshot", event: "prov-event-offer-1", system: "manual-catalogue-import" },
  { kind: "marketplace.provider-ack", event: "prov-event-ack-2", system: "provider-portal-export" },
  { kind: "marketplace.fulfilment", event: "prov-event-fulfil-3", system: "provider-portal-export" },
  { kind: "marketplace.receipt", event: "prov-event-receipt-4", system: "operator-received" },
];

const kindRecords: MarketplaceEvidenceRecordOutcome[] = [];
for (const k of KIND_INPUTS) {
  const outcome = await STORE.recordEvidence(TENANT, input({
    kind: k.kind,
    providerEventId: k.event,
    source: { system: k.system, reference: `${k.event}.pdf`, retrievedVia: k.system === "provider-portal-export" ? "export" : "manual" },
  }), AT);
  kindRecords.push(outcome);
}
const storedCount = STORE.size();
const offerOutcome = kindRecords[0];
if (offerOutcome === undefined || !offerOutcome.ok) throw new Error("fixture offer record failed");
const offerRecord = offerOutcome.record;

// Duplicate provider event: SAME payload re-presented.
const duplicateSame = await STORE.recordEvidence(TENANT, input(), AT);
// Duplicate provider event: DIVERGENT payload re-presented (forged).
const divergentInput = input({
  artifacts: [buildArtifact("art-j2-forge", utf8Bytes(JSON.stringify({ offerId: "offer-1", total: 99_999 })), "application/json", "a forged replacement payload")],
  capturedAt: "2026-10-12T18:44:00.000Z",
});
const duplicateDivergent = await STORE.recordEvidence(TENANT, divergentInput, AT);
const countAfterDuplicates = STORE.size();

// Tenant fail-closed: foreign reads + foreign write.
const foreignRead = await STORE.readEvidence(FOREIGN_TENANT, offerRecord.evidenceId);
const foreignFindByEvent = await STORE.findByProviderEvent(FOREIGN_TENANT, "prov-event-offer-1");
const foreignListIds = (await STORE.listBySubject(FOREIGN_TENANT, "order-100")).map((r) => r.evidenceId);
const foreignWrite = await STORE.recordEvidence(FOREIGN_TENANT, input(), AT);
const countAfterForeignWrite = STORE.size();

// Cross-tenant dedup isolation: the SAME event id under the foreign tenant.
const foreignEvent = await STORE.recordEvidence(FOREIGN_TENANT, input({ tenantId: FOREIGN_TENANT.tenantId }), AT);
const countAfterForeignEvent = STORE.size();

// Intake refusals + freshness (fixed logical times — no wall clock).
const futureCapture = await STORE.recordEvidence(TENANT, input({
  providerEventId: "prov-event-future-9",
  capturedAt: "2026-10-12T18:45:00.001Z",
}), AT);
const missingCapture = await STORE.recordEvidence(TENANT, input({ providerEventId: "prov-event-missing-8", capturedAt: "" }), AT);
const freshClass = classifyMarketplaceEvidenceFreshness(offerRecord, Date.parse(AT), FRESH_WINDOW);
const staleRecordOutcome = await STORE.recordEvidence(TENANT, input({
  providerEventId: "prov-event-stale-7",
  capturedAt: "2026-10-01T09:00:00.000Z",
}), AT);
if (!staleRecordOutcome.ok) throw new Error("fixture stale record failed");
const staleClass = classifyMarketplaceEvidenceFreshness(staleRecordOutcome.record, Date.parse(AT), FRESH_WINDOW);

export const marketplaceEvidenceDedupJourney: AcceptanceJourney = {
  journeyId: "security.marketplace-evidence-dedup-discipline",
  persona: "compliance-auditor",
  capabilities: ["understand-evidence", "tenant-isolation"],
  goal: "Prove the marketplace evidence-retention laws: duplicate provider events return the ORIGINAL record, tenant fail-closed reads/writes, and source+captured-at freshness",
  steps: [
    {
      stepId: "retain-four-kinds",
      kind: "evidence",
      description: "The four frozen marketplace artifact kinds are retained with source + captured-at provenance",
      packages: ["@fleetos/evidence"],
      operations: ["InMemoryMarketplaceEvidenceStore.recordEvidence"],
      run: (ctx) => {
        ctx.record("retain.allOk", kindRecords.every((r) => r.ok && !r.duplicate));
        ctx.record("retain.kinds", kindRecords.map((r) => (r.ok ? r.record.kind : "failed")));
        ctx.record("retain.count", storedCount);
        ctx.record("retain.idPrefix", offerRecord.evidenceId.slice(0, 4));
        ctx.record("retain.sourceSystem", offerRecord.source.system);
        ctx.record("retain.sourceReference", offerRecord.source.reference);
        ctx.record("retain.retrievedVia", offerRecord.source.retrievedVia);
        ctx.record("retain.capturedAt", offerRecord.capturedAt);
        ctx.record("retain.recordedAt", offerRecord.recordedAt);
        ctx.record("retain.digestLength", offerRecord.contentDigest.length);
      },
    },
    {
      stepId: "duplicate-provider-event",
      kind: "negative-check",
      description: "REFUSAL: the same provider event id twice returns the ORIGINAL record — never a second conclusion; a divergent re-presentation is flagged but the original still wins",
      packages: ["@fleetos/evidence"],
      operations: ["InMemoryMarketplaceEvidenceStore.recordEvidence"],
      run: (ctx) => {
        ctx.record("dup.samePayloadOk", duplicateSame.ok);
        ctx.record("dup.samePayloadDuplicate", duplicateSame.ok ? duplicateSame.duplicate : false);
        ctx.record("dup.samePayloadEvidenceId", duplicateSame.ok ? duplicateSame.record.evidenceId : "none");
        ctx.record("dup.originalEvidenceId", offerRecord.evidenceId);
        ctx.record("dup.samePayloadRecordedAt", duplicateSame.ok ? duplicateSame.record.recordedAt : "none");
        ctx.record("dup.divergentOk", duplicateDivergent.ok);
        ctx.record("dup.divergentDuplicate", duplicateDivergent.ok ? duplicateDivergent.duplicate : false);
        ctx.record("dup.divergentFlagged", duplicateDivergent.ok && "divergent" in duplicateDivergent ? duplicateDivergent.divergent : false);
        ctx.record("dup.divergentReturnsOriginalId", duplicateDivergent.ok ? duplicateDivergent.record.evidenceId : "none");
        ctx.record("dup.divergentReturnsOriginalDigest", duplicateDivergent.ok ? duplicateDivergent.record.contentDigest : "none");
        ctx.record("dup.originalDigest", offerRecord.contentDigest);
        ctx.record("dup.divergentOriginalCapturedAt", duplicateDivergent.ok ? duplicateDivergent.record.capturedAt : "none");
        ctx.record("dup.storeNeverGrew", countAfterDuplicates === storedCount);
      },
    },
    {
      stepId: "tenant-fail-closed",
      kind: "negative-check",
      description: "REFUSAL: foreign-tenant reads fail closed (indistinguishable from absence), foreign writes are refused, and provider-event dedup never crosses tenants",
      packages: ["@fleetos/evidence"],
      operations: ["InMemoryMarketplaceEvidenceStore.readEvidence", "findByProviderEvent", "listBySubject", "recordEvidence"],
      run: (ctx) => {
        ctx.record("tenant.foreignReadIsNull", foreignRead === null);
        ctx.record("tenant.foreignFindByEventIsNull", foreignFindByEvent === null);
        ctx.record("tenant.foreignListEmpty", foreignListIds);
        ctx.record("tenant.foreignWriteOk", foreignWrite.ok);
        ctx.record("tenant.foreignWriteReason", foreignWrite.ok ? "none" : foreignWrite.reason);
        ctx.record("tenant.storeUnchangedAfterForeignWrite", countAfterForeignWrite === countAfterDuplicates);
        ctx.record("tenant.foreignEventOk", foreignEvent.ok);
        ctx.record("tenant.foreignEventDuplicate", foreignEvent.ok ? foreignEvent.duplicate : true);
        ctx.record("tenant.foreignEventOwnRecord", foreignEvent.ok ? foreignEvent.record.tenantId : "none");
        ctx.record("tenant.crossTenantEventIdsDiffer", foreignEvent.ok ? foreignEvent.record.evidenceId !== offerRecord.evidenceId : true);
        ctx.record("tenant.countAfterForeignEvent", countAfterForeignEvent);
      },
    },
    {
      stepId: "intake-refusals-and-freshness",
      kind: "negative-check",
      description: "REFUSAL: future-dated capturedAt is untrusted; missing capturedAt is refused; freshness classifies honestly",
      packages: ["@fleetos/evidence"],
      operations: ["InMemoryMarketplaceEvidenceStore.recordEvidence", "classifyMarketplaceEvidenceFreshness"],
      run: (ctx) => {
        ctx.record("intake.futureCaptureOk", futureCapture.ok);
        ctx.record("intake.futureCaptureReason", futureCapture.ok ? "none" : futureCapture.reason);
        ctx.record("intake.missingCaptureOk", missingCapture.ok);
        ctx.record("intake.missingCaptureReason", missingCapture.ok ? "none" : missingCapture.reason);
        ctx.record("fresh.offerClass", freshClass.freshness);
        ctx.record("fresh.offerAgeMs", freshClass.ageMs);
        ctx.record("fresh.staleClass", staleClass.freshness);
      },
    },
  ],
  assertions: [
    { assertionId: "ev-1", description: "All four kinds record cleanly (no duplicates on first write)", path: "retain.allOk", expected: true },
    { assertionId: "ev-2", description: "The frozen artifact kinds are exactly offer-snapshot/provider-ack/fulfilment/receipt", path: "retain.kinds", expected: ["marketplace.offer-snapshot", "marketplace.provider-ack", "marketplace.fulfilment", "marketplace.receipt"] },
    { assertionId: "ev-3", description: "Four unique records retained", path: "retain.count", expected: 4 },
    { assertionId: "ev-4", description: "Evidence ids carry the mpe- prefix", path: "retain.idPrefix", expected: "mpe-" },
    { assertionId: "ev-5", description: "The source system is retained verbatim", path: "retain.sourceSystem", expected: "manual-catalogue-import" },
    { assertionId: "ev-6", description: "The source reference is retained verbatim", path: "retain.sourceReference", expected: "prov-event-offer-1.pdf" },
    { assertionId: "ev-7", description: "The retrieved-via seam is honestly labelled (manual seam)", path: "retain.retrievedVia", expected: "manual" },
    { assertionId: "ev-8", description: "The capturedAt freshness field is retained verbatim", path: "retain.capturedAt", expected: "2026-10-12T18:40:00.000Z" },
    { assertionId: "ev-9", description: "The recordedAt logical time is caller-supplied (never a wall clock)", path: "retain.recordedAt", expected: "2026-10-12T18:45:00.000Z" },
    { assertionId: "ev-10", description: "The content digest is sha-256 (64 hex)", path: "retain.digestLength", expected: 64 },
    { assertionId: "ev-11", description: "Re-presenting the same provider event succeeds as a duplicate outcome", path: "dup.samePayloadOk", expected: true },
    { assertionId: "ev-12", description: "REFUSAL: the duplicate presentation is flagged duplicate", path: "dup.samePayloadDuplicate", expected: true },
    { assertionId: "ev-13", description: "The duplicate returns the ORIGINAL evidence id (machine-measured pin: mpe-54dd60a363c8)", path: "dup.samePayloadEvidenceId", expected: "mpe-54dd60a363c8" },
    { assertionId: "ev-14", description: "The ORIGINAL evidence id is stable (machine-measured pin)", path: "dup.originalEvidenceId", expected: "mpe-54dd60a363c8" },
    { assertionId: "ev-15", description: "The duplicate's recordedAt is the ORIGINAL's recording time (no second conclusion)", path: "dup.samePayloadRecordedAt", expected: "2026-10-12T18:45:00.000Z" },
    { assertionId: "ev-16", description: "A divergent re-presentation still resolves ok (the original is returned)", path: "dup.divergentOk", expected: true },
    { assertionId: "ev-17", description: "The divergent re-presentation is a duplicate", path: "dup.divergentDuplicate", expected: true },
    { assertionId: "ev-18", description: "The divergence is flagged for audit", path: "dup.divergentFlagged", expected: true },
    { assertionId: "ev-19", description: "The divergent outcome returns the ORIGINAL evidence id (machine-measured pin)", path: "dup.divergentReturnsOriginalId", expected: "mpe-54dd60a363c8" },
    { assertionId: "ev-20", description: "The divergent outcome returns the ORIGINAL content digest (machine-measured pin)", path: "dup.divergentReturnsOriginalDigest", expected: "54dd60a363c8927a541fce99aec8738c41cda9dc74b677d277c2fcef0feedf6f" },
    { assertionId: "ev-21", description: "The ORIGINAL record's content digest is unchanged (machine-measured pin)", path: "dup.originalDigest", expected: "54dd60a363c8927a541fce99aec8738c41cda9dc74b677d277c2fcef0feedf6f" },
    { assertionId: "ev-22", description: "The divergent outcome returns the ORIGINAL capturedAt (the forged timestamp never lands)", path: "dup.divergentOriginalCapturedAt", expected: "2026-10-12T18:40:00.000Z" },
    { assertionId: "ev-23", description: "The store NEVER grows on duplicate presentations", path: "dup.storeNeverGrew", expected: true },
    { assertionId: "ev-24", description: "REFUSAL: a foreign-tenant read returns null (indistinguishable from absence)", path: "tenant.foreignReadIsNull", expected: true },
    { assertionId: "ev-25", description: "REFUSAL: a foreign-tenant provider-event lookup returns null", path: "tenant.foreignFindByEventIsNull", expected: true },
    { assertionId: "ev-26", description: "REFUSAL: a foreign-tenant subject listing returns empty", path: "tenant.foreignListEmpty", expected: [] },
    { assertionId: "ev-27", description: "REFUSAL: a foreign-tenant write is refused", path: "tenant.foreignWriteOk", expected: false },
    { assertionId: "ev-28", description: "The foreign write refusal reason is the tenant-mismatch law", path: "tenant.foreignWriteReason", expected: "refused.tenant_mismatch" },
    { assertionId: "ev-29", description: "The store is unchanged after the refused foreign write", path: "tenant.storeUnchangedAfterForeignWrite", expected: true },
    { assertionId: "ev-30", description: "The same event id under the foreign tenant records cleanly (no cross-tenant dedup leak)", path: "tenant.foreignEventOk", expected: true },
    { assertionId: "ev-31", description: "The foreign tenant's event is NOT a duplicate of the home tenant's", path: "tenant.foreignEventDuplicate", expected: false },
    { assertionId: "ev-32", description: "The foreign tenant's record belongs to the foreign tenant", path: "tenant.foreignEventOwnRecord", expected: "globex-rival" },
    { assertionId: "ev-33", description: "Cross-tenant evidence ids differ (tenant-scoped identity)", path: "tenant.crossTenantEventIdsDiffer", expected: true },
    { assertionId: "ev-34", description: "The store grew by exactly one for the foreign record (4 home + 1 foreign)", path: "tenant.countAfterForeignEvent", expected: 5 },
    { assertionId: "ev-35", description: "REFUSAL: a future-dated capturedAt is refused as untrusted", path: "intake.futureCaptureOk", expected: false },
    { assertionId: "ev-36", description: "The future-capture refusal reason", path: "intake.futureCaptureReason", expected: "refused.captured_at_in_future" },
    { assertionId: "ev-37", description: "REFUSAL: a missing capturedAt is refused", path: "intake.missingCaptureOk", expected: false },
    { assertionId: "ev-38", description: "The missing-capture refusal reason", path: "intake.missingCaptureReason", expected: "refused.missing_captured_at" },
    { assertionId: "ev-39", description: "A record captured within the window classifies fresh", path: "fresh.offerClass", expected: "fresh" },
    { assertionId: "ev-40", description: "The fresh record's age is exactly 5 minutes (logical clock)", path: "fresh.offerAgeMs", expected: 300_000 },
    { assertionId: "ev-41", description: "An old record honestly classifies stale (never silently current)", path: "fresh.staleClass", expected: "stale" },
  ],
};
