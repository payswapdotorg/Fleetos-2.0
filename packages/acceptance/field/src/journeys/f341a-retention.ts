/**
 * @fleetos/acceptance-field — F341A journey A2: the observations retention +
 * projection law (Wave 14 lane A).
 *
 * CENSUS CITATION (F340 §1, candidate A2, verbatim row): "observations
 * retention/projection | `packages/observations/src/retention.ts`
 * (ImmutableObservationStore, InMemoryImmutableStore, buildDeviceSummary +
 * projections) | NO journey exercises it | CANDIDATE A2".
 *
 * The REAL capability is @fleetos/observations' storage-authority law: the
 * immutable append-only observation store (idempotent appends, tenant
 * fail-closed reads, honest absence for unknown keys), the disposable
 * device-summary projection built FROM the store (rebuildable at any time,
 * content-stable but identity-distinct), projection staleness at the REAL
 * retention TTL boundary, and the package's retention defaults (the
 * immutable store never ages; projections do).
 *
 * Vocabulary law: persona `fleet-operator` + capability `trustworthy-state`
 * (the retained observation truth and its projections — the frozen
 * vocabulary's trustworthy-state family; no vocabulary change, F331A
 * precedent).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { AST_TRUCK, DEV_TELEMETRY, T0 } from "../fixtures.js";

export const observationsRetentionProjectionsJourney: AcceptanceJourney = {
  id: "observations-retention-projections",
  persona: "fleet-operator",
  capability: "trustworthy-state",
  goal: "Keep the retained observation truth honest: an immutable append-only store that never mutates or fabricates records, a rebuildable device-summary projection with honest metadata, and retention boundaries at the real TTL.",
  steps: [
    { id: "r1", summary: "admit the fleet's truck asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "r2", summary: "enroll the telemetry device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "r3", summary: "ingest observation seq 1 (telemetry.temp) through the REAL admission pipeline", op: { kind: "observation.ingest", deviceId: DEV_TELEMETRY, seq: 1, observedAt: T0 + 1_000, observationKind: "telemetry.temp", payload: { tempC: 41 } } },
    { id: "r4", summary: "ingest observation seq 2 (telemetry.temp)", op: { kind: "observation.ingest", deviceId: DEV_TELEMETRY, seq: 2, observedAt: T0 + 2_000, observationKind: "telemetry.temp", payload: { tempC: 42 } } },
    { id: "r5", summary: "ingest observation seq 3 (telemetry.flow)", op: { kind: "observation.ingest", deviceId: DEV_TELEMETRY, seq: 3, observedAt: T0 + 3_000, observationKind: "telemetry.flow", payload: { flowLpm: 118 } } },
    { id: "r6", summary: "ingest observation seq 4 (telemetry.flow)", op: { kind: "observation.ingest", deviceId: DEV_TELEMETRY, seq: 4, observedAt: T0 + 4_000, observationKind: "telemetry.flow", payload: { flowLpm: 121 } } },
    { id: "r7", summary: "open the immutable observation store", op: { kind: "ret.store-open", storeId: "ret_dev-store-01" } },
    { id: "r8", summary: "append the four REAL pipeline-admitted observations into the immutable store", op: { kind: "ret.append-ingested", storeId: "ret_dev-store-01", deviceId: DEV_TELEMETRY } },
    { id: "r9", summary: "read the stored observation seq 2 back by key", op: { kind: "ret.read", storeId: "ret_dev-store-01", deviceId: DEV_TELEMETRY, seq: 2 } },
    { id: "r10", summary: "re-append the same observations (the store is idempotent: nothing grows, nothing mutates)", op: { kind: "ret.append-ingested", storeId: "ret_dev-store-01", deviceId: DEV_TELEMETRY } },
    {
      id: "r11",
      summary: "a foreign tenant's read of the same key is refused fail-closed (and its device listing is empty)",
      expectRefusal: true,
      op: { kind: "ret.read", storeId: "ret_dev-store-01", deviceId: DEV_TELEMETRY, seq: 2, tenantId: "tnt_other-operator-9" },
    },
    {
      id: "r12",
      summary: "a read for a key that was never stored is refused (honest absence, never fabricated)",
      expectRefusal: true,
      op: { kind: "ret.read", storeId: "ret_dev-store-01", deviceId: DEV_TELEMETRY, seq: 99 },
    },
    { id: "r13", summary: "probe immutability: the stored seq-2 record is still the admitted record, unchanged", op: { kind: "ret.immutability-probe", storeId: "ret_dev-store-01", deviceId: DEV_TELEMETRY, seq: 2 } },
    { id: "r14", summary: "build the device-summary projection over the stored observations (built at the journey's fixed logical time)", op: { kind: "ret.device-summary", storeId: "ret_dev-store-01", deviceId: DEV_TELEMETRY, builtAt: T0 } },
    {
      id: "r15",
      summary: "classify the projection at the REAL TTL boundary (fresh at 0, fresh at exactly the TTL, stale one ms beyond)",
      op: { kind: "ret.projection-stale", storeId: "ret_dev-store-01", deviceId: DEV_TELEMETRY, builtAt: T0, offsets: [0, 300_000, 300_001] },
    },
    { id: "r16", summary: "rebuild the projection one minute later (disposable, rebuildable)", op: { kind: "ret.rebuild-summary", storeId: "ret_dev-store-01", deviceId: DEV_TELEMETRY, builtAt: T0 + 60_000 } },
    { id: "r17", summary: "read the package's default retention policy (provenance)", op: { kind: "ret.retention-defaults" } },
  ],
  assertions: [
    { id: "v1", description: "a fresh store is empty", reading: "r7.ret.size", op: "deep-equals", expected: 0 },
    { id: "v2", description: "the four REAL admitted observations are appended", reading: "r8.ret.appended", op: "deep-equals", expected: 4 },
    { id: "v3", description: "the store holds exactly four records", reading: "r8.ret.size", op: "deep-equals", expected: 4 },
    { id: "v4", description: "the store's device high-water seq is 4", reading: "r8.ret.lastSeq", op: "deep-equals", expected: 4 },
    { id: "v5", description: "the by-key read returns the stored seq", reading: "r9.ret.readSeq", op: "deep-equals", expected: 2 },
    { id: "v6", description: "the by-key read returns the same REAL id the pipeline admitted", reading: "r9.ret.readId", op: "reading-equals", expected: "r4.obs.id" },
    { id: "v7", description: "the idempotent re-append grows nothing", reading: "r10.ret.sizeGrew", op: "deep-equals", expected: 0 },
    { id: "v8", description: "the store size is unchanged by the re-append", reading: "r10.ret.size", op: "deep-equals", expected: 4 },
    { id: "v9", description: "the foreign-tenant read is refused fail-closed", reading: "r11.ret.readRefused", op: "deep-equals", expected: "tenant-fail-closed" },
    { id: "v10", description: "the foreign tenant's device listing is empty (tenant isolation)", reading: "r11.ret.foreignListEmpty", op: "deep-equals", expected: true },
    { id: "v11", description: "an unknown key is refused (honest absence)", reading: "r12.ret.readRefused", op: "deep-equals", expected: "unknown-observation-key" },
    { id: "v12", description: "the stored record is deep-equal to the admitted record (never mutated)", reading: "r13.ret.storedUnchanged", op: "deep-equals", expected: true },
    { id: "v13", description: "the stored record is the same REAL record read earlier (stable identity across the re-append)", reading: "r13.ret.storedId", op: "reading-equals", expected: "r9.ret.readId" },
    { id: "v14", description: "the stored record's observedAt is unchanged from admission", reading: "r13.ret.storedObservedAt", op: "deep-equals", expected: T0 + 2_000 },
    { id: "v15", description: "the stored record's seq is unchanged", reading: "r13.ret.storedSeq", op: "deep-equals", expected: 2 },
    { id: "v16", description: "the device summary counts all four stored observations", reading: "r14.ret.summaryCount", op: "deep-equals", expected: 4 },
    { id: "v17", description: "the device summary's high-water seq is 4", reading: "r14.ret.summaryLastSeq", op: "deep-equals", expected: 4 },
    { id: "v18", description: "the device summary's kinds are the distinct sorted stream kinds", reading: "r14.ret.summaryKinds", op: "deep-equals", expected: ["telemetry.flow", "telemetry.temp"] },
    { id: "v19", description: "the device summary's lastObservedAt is the newest stored observation time", reading: "r14.ret.summaryLastObservedAt", op: "deep-equals", expected: T0 + 4_000 },
    { id: "v20", description: "the projection metadata declares its kind honestly", reading: "r14.ret.summaryMetaKind", op: "deep-equals", expected: "device-summary" },
    { id: "v21", description: "the projection metadata carries the build time", reading: "r14.ret.summaryBuiltAt", op: "deep-equals", expected: T0 },
    { id: "v22", description: "the projection metadata carries a source hash over its source observations", reading: "r14.ret.summarySourceHash", op: "not-null" },
    { id: "v23", description: "the projection is fresh at 0, fresh at EXACTLY the TTL, stale one ms beyond (the boundary is exclusive)", reading: "r15.ret.staleByOffset", op: "deep-equals", expected: [false, false, true] },
    { id: "v24", description: "the REAL projection TTL is five minutes", reading: "r15.ret.projectionTtlMs", op: "deep-equals", expected: 300_000 },
    { id: "v25", description: "the rebuilt projection is content-identical (count, lastSeq, sourceHash)", reading: "r16.ret.rebuildContentIdentical", op: "deep-equals", expected: true },
    { id: "v26", description: "the rebuilt projection's metadata identity is distinct (a disposable projection, not the same object)", reading: "r16.ret.rebuildMetaIdDiffers", op: "deep-equals", expected: true },
    { id: "v27", description: "the default retention policy ages projections, never the immutable store (TTL null = forever)", reading: "r17.ret.default.immutableStoreForever", op: "deep-equals", expected: true },
    { id: "v28", description: "the default policy rebuilds projections on drift", reading: "r17.ret.default.rebuildOnDrift", op: "deep-equals", expected: true },
  ],
};
