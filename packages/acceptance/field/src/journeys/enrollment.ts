/**
 * @fleetos/acceptance-field — journeys: enrollment + trustworthy state.
 *
 * Pure journey DATA. The runner executes the typed operations against the
 * REAL public APIs and evaluates the declarative assertions against the
 * readings those APIs produce.
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { AST_TRAILER, AST_TRUCK, DEV_GATEWAY, DEV_TELEMETRY, T0 } from "../fixtures.js";

export const enrollNewAssetJourney: AcceptanceJourney = {
  id: "enroll-new-asset",
  persona: "fleet-operator",
  capability: "enrollment",
  goal: "Enroll a new asset (admit -> activate -> device enrollment -> first observation) and see it appear in the fleet overview with correct status and identity refs.",
  steps: [
    { id: "t1", summary: "admit the truck asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "activate the asset into the active fleet", op: { kind: "asset.activate", assetId: AST_TRUCK } },
    { id: "t3", summary: "enroll the telemetry device on the asset", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "t4", summary: "verify the enrollment record is live", op: { kind: "enrollment.check", deviceId: DEV_TELEMETRY } },
    { id: "t5", summary: "ingest the first observation through the real pipeline", op: { kind: "observation.ingest", deviceId: DEV_TELEMETRY, seq: 1, observedAt: T0 + 1_000, observationKind: "telemetry.state", payload: { status: "active" } } },
    { id: "t6", summary: "admit the genesis twin revision", op: { kind: "twin.admit", deviceId: DEV_TELEMETRY, seq: 1, observedAt: T0 + 1_000, attributes: { odometerKm: 1_200, operatorContact: "+15550100", location: "site-A" } } },
    { id: "t7", summary: "open the fleet overview read-model", op: { kind: "view.fleet-overview", now: T0 + 5_000 } },
  ],
  assertions: [
    { id: "e1", description: "the asset was admitted", reading: "t1.asset.admitted", op: "deep-equals", expected: true },
    { id: "e2", description: "activation moved the lifecycle to active", reading: "t2.asset.lifecycle", op: "deep-equals", expected: "active" },
    { id: "e3", description: "the device enrollment succeeded with an audit trail", reading: "t3.enroll.enrolled", op: "deep-equals", expected: true },
    { id: "e4", description: "the enrollment audit names the enroll intent", reading: "t3.enroll.auditIntent", op: "deep-equals", expected: "asset:enroll" },
    { id: "e5", description: "an enrollment check finds the device enrolled", reading: "t4.enrollment.ok", op: "deep-equals", expected: true },
    { id: "e6", description: "the first observation was admitted (not a duplicate)", reading: "t5.obs.admitted", op: "deep-equals", expected: true },
    { id: "e7", description: "the observation was fresh, not duplicate-acked", reading: "t5.obs.duplicate", op: "deep-equals", expected: false },
    { id: "e8", description: "the genesis twin admission carries the genesis audit intent", reading: "t6.twin.auditIntent", op: "deep-equals", expected: "twin:admit:genesis" },
    { id: "e9", description: "the twin head is at seq 1", reading: "t6.twin.lastSeq", op: "deep-equals", expected: 1 },
    { id: "e10", description: "the fleet overview assembled", reading: "t7.overview.ok", op: "deep-equals", expected: true },
    { id: "e11", description: "one asset card in the overview", reading: "t7.overview.assets", op: "deep-equals", expected: 1 },
    { id: "e12", description: "the asset counts as active", reading: "t7.overview.active", op: "deep-equals", expected: 1 },
    { id: "e13", description: "the card is for the enrolled asset", reading: "t7.overview.card0.assetId", op: "deep-equals", expected: AST_TRUCK },
    { id: "e14", description: "the card shows the active lifecycle", reading: "t7.overview.card0.lifecycle", op: "deep-equals", expected: "active" },
    { id: "e15", description: "the card carries the device identity ref", reading: "t7.overview.card0.deviceCount", op: "deep-equals", expected: 1 },
    { id: "e16", description: "the recent observation classifies fresh", reading: "t7.overview.card0.lastObservedStaleness", op: "deep-equals", expected: "fresh" },
    { id: "e17", description: "no findings means a clear health posture", reading: "t7.overview.card0.posture", op: "deep-equals", expected: "clear" },
    { id: "e18", description: "no connectivity record means an honest unknown posture", reading: "t7.overview.card0.connectivityUnknown", op: "deep-equals", expected: 1 },
    { id: "e19", description: "fleet-overview redaction hides operator contact and location", reading: "t7.overview.card0.redactedFields", op: "deep-equals", expected: ["location", "operatorContact"] },
    { id: "e20", description: "the overview digest verifies (tamper-evident)", reading: "t7.overview.digestVerified", op: "deep-equals", expected: true },
  ],
};

export const trustworthyStateJourney: AcceptanceJourney = {
  id: "trustworthy-state-recency",
  persona: "field-technician",
  capability: "trustworthy-state",
  goal: "See trustworthy operational state: the asset detail reflects real observation recency (fresh -> stale -> unknown) and idempotent ingestion, honestly.",
  steps: [
    { id: "t1", summary: "admit the trailer asset", op: { kind: "asset.admit", assetId: AST_TRAILER, assetKind: "handheld", displayName: "Trailer Beta 02" } },
    { id: "t2", summary: "enroll the gateway device", op: { kind: "device.enroll", deviceId: DEV_GATEWAY, assetId: AST_TRAILER, serial: "SN-2002" } },
    { id: "t3", summary: "ingest a temperature observation", op: { kind: "observation.ingest", deviceId: DEV_GATEWAY, seq: 1, observedAt: T0 + 1_000, observationKind: "telemetry.temp", payload: { tempC: 21 } } },
    { id: "t4", summary: "admit the twin revision for that observation", op: { kind: "twin.admit", deviceId: DEV_GATEWAY, seq: 1, observedAt: T0 + 1_000, attributes: { batteryPct: 88 } } },
    { id: "t5", summary: "detail sheet while the observation is fresh (2s old)", op: { kind: "view.asset-detail", assetId: AST_TRAILER, now: T0 + 2_000 } },
    { id: "t6", summary: "detail sheet when the observation is stale (2min old)", op: { kind: "view.asset-detail", assetId: AST_TRAILER, now: T0 + 121_000 } },
    { id: "t7", summary: "detail sheet beyond the staleness window (6.6min old)", op: { kind: "view.asset-detail", assetId: AST_TRAILER, now: T0 + 400_000 } },
    {
      id: "t8",
      summary: "re-ingest the same (device, seq) — the pipeline must ack idempotently",
      op: { kind: "observation.ingest", deviceId: DEV_GATEWAY, seq: 1, observedAt: T0 + 1_000, observationKind: "telemetry.temp", payload: { tempC: 21 } },
    },
    {
      id: "t9",
      summary: "ingest a non-monotonic seq 0 — the real pipeline must refuse",
      expectRefusal: true,
      op: { kind: "observation.ingest", deviceId: DEV_GATEWAY, seq: 0, observedAt: T0 + 2_000, observationKind: "telemetry.temp", payload: { tempC: 22 } },
    },
    {
      id: "t10",
      summary: "ingest an out-of-vocabulary kind — the real pipeline must refuse",
      expectRefusal: true,
      op: { kind: "observation.ingest", deviceId: DEV_GATEWAY, seq: 2, observedAt: T0 + 2_000, observationKind: "noise.unknown", payload: { tempC: 22 } },
    },
  ],
  assertions: [
    { id: "s1", description: "fresh observation -> the detail classifies fresh", reading: "t5.detail.ok", op: "deep-equals", expected: true },
    { id: "s2", description: "fresh window staleness", reading: "t5.detail.device0.staleness", op: "deep-equals", expected: "fresh" },
    { id: "s3", description: "the exact age is surfaced", reading: "t5.detail.device0.ageMs", op: "deep-equals", expected: 1_000 },
    { id: "s4", description: "twin provenance: one revision at seq 1", reading: "t5.detail.device0.revisionCount", op: "deep-equals", expected: 1 },
    { id: "s5", description: "the admitted observation count", reading: "t5.detail.device0.observationCount", op: "deep-equals", expected: 1 },
    { id: "s6", description: "the last observation kind", reading: "t5.detail.device0.lastObservationKind", op: "deep-equals", expected: "telemetry.temp" },
    { id: "s7", description: "device identity (serial) surfaces on the sheet", reading: "t5.detail.device0.serial", op: "deep-equals", expected: "SN-2002" },
    { id: "s8", description: "no connectivity record -> honest unknown connectivity", reading: "t5.detail.device0.connectivity", op: "deep-equals", expected: "unknown" },
    { id: "s9", description: "the fresh detail digest verifies", reading: "t5.detail.digestVerified", op: "deep-equals", expected: true },
    { id: "s10", description: "stale observation -> stale shows STALE (never fresh)", reading: "t6.detail.device0.staleness", op: "deep-equals", expected: "stale" },
    { id: "s11", description: "the stale age is the honest 120s window", reading: "t6.detail.device0.ageMs", op: "deep-equals", expected: 120_000 },
    { id: "s12", description: "beyond the staleness window -> honest unknown", reading: "t7.detail.device0.staleness", op: "deep-equals", expected: "unknown" },
    { id: "s13", description: "the unknown age is still exact", reading: "t7.detail.device0.ageMs", op: "deep-equals", expected: 399_000 },
    { id: "s14", description: "duplicate ingestion is acked, not re-admitted", reading: "t8.obs.duplicate", op: "deep-equals", expected: true },
    { id: "s15", description: "the duplicate ack still admits (idempotent)", reading: "t8.obs.admitted", op: "deep-equals", expected: true },
    { id: "s16", description: "non-monotonic seq is refused with the validate stage code", reading: "t9.obs.reason", op: "deep-equals", expected: "invalid-seq" },
    { id: "s17", description: "unknown vocabulary is refused by the validate stage", reading: "t10.obs.reason", op: "deep-equals", expected: "unknown-kind" },
    { id: "s18", description: "the head digest surfaces (twin provenance)", reading: "t5.detail.device0.headDigest", op: "not-null" },
    { id: "s19", description: "no findings -> clear posture on the sheet", reading: "t5.detail.posture", op: "deep-equals", expected: "clear" },
  ],
};
