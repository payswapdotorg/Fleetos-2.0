/**
 * @fleetos/acceptance-field — journeys: host-surface read-model journeys
 * (F300A). Asset discovery -> Device 360 drill-down, and the health/
 * observation/diagnosis/evidence timeline — both rendered through the REAL
 * HostSurface adapter over REAL composed domain state.
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { AST_TRAILER, AST_TRUCK, DEV_GATEWAY, DEV_TELEMETRY, T0 } from "../fixtures.js";

export const hostDiscoveryDevice360Journey: AcceptanceJourney = {
  id: "host-discovery-device-360",
  persona: "site-manager",
  capability: "host-integration",
  goal: "Discover the fleet's assets through the host surface's discovery route, drill into a real Device 360 sheet, and see byte-identical purity and honest markers — never a second truth store.",
  steps: [
    { id: "t1", summary: "admit the truck asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "admit the trailer asset", op: { kind: "asset.admit", assetId: AST_TRAILER, assetKind: "handheld", displayName: "Trailer Beta 02" } },
    { id: "t3", summary: "enroll the truck's telemetry device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "t4", summary: "enroll the trailer's gateway device", op: { kind: "device.enroll", deviceId: DEV_GATEWAY, assetId: AST_TRAILER, serial: "SN-2002" } },
    { id: "t5", summary: "ingest the gateway's first observation", op: { kind: "observation.ingest", deviceId: DEV_GATEWAY, seq: 1, observedAt: T0 + 1_000, observationKind: "telemetry.temp", payload: { tempC: 21 } } },
    { id: "t6", summary: "admit the gateway twin revision (with redactable attributes)", op: { kind: "twin.admit", deviceId: DEV_GATEWAY, seq: 1, observedAt: T0 + 1_000, attributes: { batteryPct: 88, operatorContact: "+15550100", location: "site-B" } } },
    { id: "t7", summary: "build the host view models (discovery + Device 360 over the real state)", op: { kind: "host.build-view-models", now: T0 + 5_000 } },
    { id: "t8", summary: "fire the discovery route's enroll intent (inert draft)", op: { kind: "host.intent-draft", event: "asset-discovery:enroll-asset", role: "site-manager", assetId: "ast_host-new-01", deviceId: "dev_host-new-01", serial: "SN-HOST-01", reason: "host: enroll a newly discovered asset" } },
    { id: "t9", summary: "validate the draft against the mirrored submit boundary", op: { kind: "intent.validate" } },
  ],
  assertions: [
    { id: "d1", description: "the host view models assembled over the real state", reading: "t7.host.ok", op: "deep-equals", expected: true },
    { id: "d2", description: "the five packet routes are declared", reading: "t7.host.routes", op: "deep-equals", expected: 5 },
    { id: "d3", description: "the route manifest integrity machine-checks (drill-downs resolve)", reading: "t7.host.routesValid", op: "deep-equals", expected: true },
    { id: "d4", description: "the intent catalog integrity machine-checks", reading: "t7.host.intentsValid", op: "deep-equals", expected: true },
    { id: "d5", description: "the same slice + context rebuilds byte-identically (purity law)", reading: "t7.host.pure", op: "deep-equals", expected: true },
    { id: "d6", description: "the bundle digest verifies (tamper-evident)", reading: "t7.host.digestVerified", op: "deep-equals", expected: true },
    { id: "d7", description: "discovery shows both real asset cards", reading: "t7.host.overview.assets", op: "deep-equals", expected: 2 },
    { id: "d8", description: "Device 360 sheets exist for every asset, assetId-ordered", reading: "t7.host.device360.assetIds", op: "deep-equals", expected: [AST_TRAILER, AST_TRUCK] },
    { id: "d9", description: "every sheet assembled from the real detail read-model", reading: "t7.host.device360.sheetsOk", op: "deep-equals", expected: true },
    { id: "d10", description: "the first sheet's device identity is real (serial)", reading: "t7.host.device360.sheet0.device0.serial", op: "deep-equals", expected: "SN-2002" },
    { id: "d11", description: "the recent observation classifies fresh on the sheet", reading: "t7.host.device360.sheet0.device0.staleness", op: "deep-equals", expected: "fresh" },
    { id: "d12", description: "no findings means a clear posture on the sheet", reading: "t7.host.device360.sheet0.posture", op: "deep-equals", expected: "clear" },
    { id: "d13", description: "the sheet's own digest verifies", reading: "t7.host.device360.sheet0.digestVerified", op: "deep-equals", expected: true },
    { id: "d14", description: "fleet-overview redaction hides contact + location on the discovery card", reading: "t7.host.overview.card0.redactedFields", op: "deep-equals", expected: ["location", "operatorContact"] },
    { id: "d15", description: "the discovery route drills into Device 360 (machine-checked manifest)", reading: "t7.host.drilldowns", op: "deep-equals", expected: { "fleet-overview": ["device-360", "field-workflow"], "asset-discovery": ["device-360"], "device-360": ["health-timeline", "field-workflow"], "health-timeline": ["device-360"], "field-workflow": ["device-360"] } },
    { id: "d16", description: "the discovery route carries the honest offline-read marker", reading: "t7.host.markers.fleetOverview", op: "includes", expected: "offline-read:last-known" },
    { id: "d17", description: "the enroll intent draft is the asset.enroll kind", reading: "t8.intent.kind", op: "deep-equals", expected: "asset.enroll" },
    { id: "d18", description: "the draft carries the capability REQUEST (never an authorization)", reading: "t8.intent.capability", op: "deep-equals", expected: "assets.enroll" },
    { id: "d19", description: "the draft validates against the mirrored submit boundary", reading: "t9.validate.ok", op: "deep-equals", expected: true },
    { id: "d20", description: "the submit projection carries the intent kind", reading: "t9.submit.kind", op: "deep-equals", expected: "asset.enroll" },
  ],
};

export const hostHealthEvidenceTimelineJourney: AcceptanceJourney = {
  id: "host-health-evidence-timeline",
  persona: "recovery-coordinator",
  capability: "host-integration",
  goal: "Read health and evidence through the host's health-timeline route: warnings triage onto the board, the recovery case renders its command history as an evidence timeline, and resolution leaves the open board.",
  steps: [
    { id: "t1", summary: "admit the asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "enroll the device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "t3", summary: "ingest two health warnings (evidence for the case)", op: { kind: "observation.ingest-batch", deviceId: DEV_TELEMETRY, fromSeq: 1, count: 2, observationKind: "health.warn", firstObservedAt: T0 + 1_000, stepMs: 1_000 } },
    { id: "t4", summary: "triage the observations into findings", op: { kind: "health.triage" } },
    { id: "t5", summary: "open the recovery case", op: { kind: "recovery.open", caseId: "rc_host-tl-0001", deviceId: DEV_TELEMETRY } },
    { id: "t6", summary: "start investigating (reason required)", op: { kind: "recovery.command", caseId: "rc_host-tl-0001", command: "investigate", reason: "battery drain reported by field tech" } },
    { id: "t7", summary: "health-timeline route: board + evidence timeline over the real state", op: { kind: "host.build-view-models", now: T0 + 20_000 } },
    { id: "t8", summary: "propose the replacement", op: { kind: "recovery.command", caseId: "rc_host-tl-0001", command: "propose", reason: "replace battery pack" } },
    { id: "t9", summary: "resolve WITH evidence from the triage findings", op: { kind: "recovery.command", caseId: "rc_host-tl-0001", command: "resolve", reason: "battery replaced and verified", withEvidence: true } },
    { id: "t10", summary: "rebuild the host view models (verification of the outcome)", op: { kind: "host.build-view-models", now: T0 + 30_000 } },
  ],
  assertions: [
    { id: "e1", description: "triage produced one warning finding from the fault stream", reading: "t4.triage.count", op: "deep-equals", expected: 1 },
    { id: "e2", description: "the host bundle assembled", reading: "t7.host.ok", op: "deep-equals", expected: true },
    { id: "e3", description: "the health board assembled (health timeline route)", reading: "t7.host.healthBoard.ok", op: "deep-equals", expected: true },
    { id: "e4", description: "the fleet warning count matches the real finding", reading: "t7.host.healthBoard.fleetWarning", op: "deep-equals", expected: 1 },
    { id: "e5", description: "the worst finding on the board is the health.warn code", reading: "t7.host.healthBoard.row0.worstFindingCode", op: "deep-equals", expected: "health.warn" },
    { id: "e6", description: "the evidence timeline shows the one open case", reading: "t7.host.recoveryTimeline.open", op: "deep-equals", expected: 1 },
    { id: "e7", description: "the timeline case is in the investigating state", reading: "t7.host.recoveryTimeline.case0.state", op: "deep-equals", expected: "investigating" },
    { id: "e8", description: "the timeline renders the case's real command history", reading: "t7.host.recoveryTimeline.case0.stepCommands", op: "deep-equals", expected: ["investigate"] },
    { id: "e9", description: "the case age is accounted against the host asOf", reading: "t7.host.recoveryTimeline.case0.ageMs", op: "deep-equals", expected: 20_000 },
    { id: "e10", description: "the first build is byte-identical on rebuild", reading: "t7.host.pure", op: "deep-equals", expected: true },
    { id: "e11", description: "resolution attached the finding evidence", reading: "t9.case.evidenceCount", op: "deep-equals", expected: 1 },
    { id: "e12", description: "the resolution carries the root cause", reading: "t9.case.resolutionRootCause", op: "deep-equals", expected: "battery replaced and verified" },
    { id: "e13", description: "the resolved case left the open timeline (verified through the host)", reading: "t10.host.recoveryTimeline.open", op: "deep-equals", expected: 0 },
    { id: "e14", description: "the board still records the finding history after resolution", reading: "t10.host.healthBoard.fleetWarning", op: "deep-equals", expected: 1 },
    { id: "e15", description: "the verification rebuild is still byte-identical", reading: "t10.host.pure", op: "deep-equals", expected: true },
    { id: "e16", description: "the verification rebuild's digest verifies", reading: "t10.host.digestVerified", op: "deep-equals", expected: true },
  ],
};
