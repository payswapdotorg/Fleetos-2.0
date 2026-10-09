/**
 * @fleetos/acceptance-field — journeys: host field workflow (mobile
 * offline) + host role-lens / tenant fail-closed proofs (F300A).
 *
 * The field-workflow route renders the phone-shaped view OFFLINE: last-
 * known provenance declared, sections bounded, honest not-implemented
 * markers (offline write-sync) — never simulated sync. Role-appropriate
 * access fails closed at the presentation seam, and a foreign-tenant
 * context refuses the WHOLE view-model bundle.
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { AST_TRAILER, AST_TRUCK, DEV_GATEWAY, DEV_TELEMETRY, TECHNICIAN, T0 } from "../fixtures.js";

export const hostFieldWorkflowMobileOfflineJourney: AcceptanceJourney = {
  id: "host-field-workflow-mobile-offline",
  persona: "field-technician",
  capability: "host-integration",
  goal: "Operate the field workflow route on a phone while offline: the host field view renders last-known state with declared staleness, bounded sections, honest degraded connectivity — and machine-readable markers state that offline write-sync is NOT implemented (never simulated).",
  steps: [
    { id: "t1", summary: "admit the truck", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "admit the trailer", op: { kind: "asset.admit", assetId: AST_TRAILER, assetKind: "handheld", displayName: "Trailer Beta 02" } },
    { id: "t3", summary: "enroll the telemetry device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "t4", summary: "enroll the gateway device", op: { kind: "device.enroll", deviceId: DEV_GATEWAY, assetId: AST_TRAILER, serial: "SN-2002" } },
    { id: "t5", summary: "three error observations on the telemetry device (escalates to critical)", op: { kind: "observation.ingest-batch", deviceId: DEV_TELEMETRY, fromSeq: 1, count: 3, observationKind: "health.error", firstObservedAt: T0 + 1_000, stepMs: 10_000 } },
    { id: "t6", summary: "triage into findings", op: { kind: "health.triage" } },
    { id: "t7", summary: "record a connectivity heartbeat for the gateway", op: { kind: "connectivity.record", deviceId: DEV_GATEWAY, state: "online", observedAt: T0 + 3_000 } },
    { id: "t8", summary: "build the host view models OFFLINE (5 minutes later)", op: { kind: "host.build-view-models", now: T0 + 300_000 } },
  ],
  assertions: [
    { id: "m1", description: "triage escalated the fault stream to one critical finding", reading: "t6.triage.count", op: "deep-equals", expected: 1 },
    { id: "m2", description: "the offline host bundle assembled from last-known state", reading: "t8.host.ok", op: "deep-equals", expected: true },
    { id: "m3", description: "the field workflow route's view assembled", reading: "t8.host.fieldWorkflow.ok", op: "deep-equals", expected: true },
    { id: "m4", description: "the top alert is the escalated critical fault", reading: "t8.host.fieldWorkflow.alert0.severity", op: "deep-equals", expected: "critical" },
    { id: "m5", description: "NEVER claims freshness: the alert's last-known is stale", reading: "t8.host.fieldWorkflow.alert0.lastKnownStaleness", op: "deep-equals", expected: "stale" },
    { id: "m6", description: "both non-fresh sections are declared last-known (honest)", reading: "t8.host.fieldWorkflow.lastKnownSections", op: "deep-equals", expected: ["top-alerts", "connectivity-status"] },
    { id: "m7", description: "every field section respects its phone-shape bound", reading: "t8.host.fieldWorkflow.sectionsBounded", op: "deep-equals", expected: true },
    { id: "m8", description: "honest postures: the stale heartbeat degrades, the absent record stays unknown", reading: "t8.host.fieldWorkflow.connectivityPostures", op: "deep-equals", expected: ["degraded", "unknown"] },
    { id: "m9", description: "Device 360 sheets still assemble offline for both assets", reading: "t8.host.device360.count", op: "deep-equals", expected: 2 },
    { id: "m10", description: "the field-workflow route honestly marks offline write-sync NOT implemented", reading: "t8.host.markers.fieldWorkflow", op: "includes", expected: "offline-write-sync:not-implemented" },
    { id: "m11", description: "the field-workflow route declares its offline-read basis", reading: "t8.host.markers.fieldWorkflow", op: "includes", expected: "offline-read:last-known" },
    { id: "m12", description: "the offline rebuild is byte-identical (purity law held offline)", reading: "t8.host.pure", op: "deep-equals", expected: true },
    { id: "m13", description: "the offline bundle digest verifies", reading: "t8.host.digestVerified", op: "deep-equals", expected: true },
    { id: "m14", description: "the host asOf is the context's logical time (never a clock)", reading: "t8.host.asOf", op: "deep-equals", expected: T0 + 300_000 },
  ],
};

export const hostRoleLensTenantFailClosedJourney: AcceptanceJourney = {
  id: "host-role-lens-tenant-fail-closed",
  persona: "field-technician",
  capability: "host-integration",
  goal: "Role-appropriate access fails closed at the host seam: the technician is refused the enroll and maintenance affordances (presentation gate), offered the recovery affordance; a foreign-tenant context refuses the WHOLE view-model bundle; a malformed context is refused by the seam itself.",
  steps: [
    { id: "t1", summary: "admit the asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "enroll the device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    {
      id: "t3",
      summary: "a technician firing the enroll intent must be REFUSED (not offered to the role lens)",
      expectRefusal: true,
      op: { kind: "host.intent-draft", event: "asset-discovery:enroll-asset", role: "field-technician", assetId: "ast_host-x-01", deviceId: "dev_host-x-01" },
    },
    {
      id: "t4",
      summary: "a technician firing the Device 360 maintenance intent must be REFUSED",
      expectRefusal: true,
      op: { kind: "host.intent-draft", event: "device-360:schedule-maintenance", role: "field-technician", assetId: AST_TRUCK, planId: "plan_host-x-01", schedule: { kind: "one-time", at: T0 + 86_400_000 } },
    },
    {
      id: "t5",
      summary: "a recovery coordinator firing the field maintenance intent must be REFUSED",
      expectRefusal: true,
      op: { kind: "host.intent-draft", event: "field-workflow:schedule-maintenance", role: "recovery-coordinator", assetId: AST_TRUCK, planId: "plan_host-x-02", schedule: { kind: "one-time", at: T0 + 86_400_000 } },
    },
    { id: "t6", summary: "the technician's recovery affordance IS offered and builds a draft", op: { kind: "host.intent-draft", event: "device-360:request-recovery", role: "field-technician", deviceId: DEV_TELEMETRY, reason: "host: technician requests recovery" } },
    { id: "t7", summary: "the technician's draft validates against the mirrored submit boundary", op: { kind: "intent.validate" } },
    { id: "t8", summary: "a FOREIGN tenant context must refuse the whole view-model bundle", op: { kind: "host.context-probe", probe: "tenant-mismatch" } },
    { id: "t9", summary: "a runtime-malformed context must be refused by the seam itself", op: { kind: "host.context-probe", probe: "malformed-context" } },
    { id: "t10", summary: "the home tenant still assembles cleanly after the probes", op: { kind: "host.build-view-models", now: T0 + 1_000 } },
  ],
  assertions: [
    { id: "l1", description: "the enroll intent refusal names the role-lens gate", reading: "t3.intent.refused", op: "deep-equals", expected: "intent-not-offered-to-role" },
    { id: "l2", description: "the Device 360 maintenance refusal names the role-lens gate", reading: "t4.intent.refused", op: "deep-equals", expected: "intent-not-offered-to-role" },
    { id: "l3", description: "the field maintenance refusal names the role-lens gate", reading: "t5.intent.refused", op: "deep-equals", expected: "intent-not-offered-to-role" },
    { id: "l4", description: "the offered recovery intent built a real draft", reading: "t6.intent.kind", op: "deep-equals", expected: "recovery.request" },
    { id: "l5", description: "the draft was issued under the technician's actor id", reading: "t6.intent.actorId", op: "deep-equals", expected: TECHNICIAN },
    { id: "l6", description: "the draft carries the capability REQUEST (Guardian still adjudicates)", reading: "t6.intent.capability", op: "deep-equals", expected: "recovery.request" },
    { id: "l7", description: "the technician's draft validates", reading: "t7.validate.ok", op: "deep-equals", expected: true },
    { id: "l8", description: "the foreign-tenant context refusal is tenant-mismatch (whole bundle)", reading: "t8.probe.refused", op: "deep-equals", expected: "tenant-mismatch" },
    { id: "l9", description: "the malformed-context refusal is the seam's own code", reading: "t9.probe.refused", op: "deep-equals", expected: "malformed-context" },
    { id: "l10", description: "the home tenant still assembles after the probes", reading: "t10.host.ok", op: "deep-equals", expected: true },
    { id: "l11", description: "the home-tenant bundle is byte-identical on rebuild", reading: "t10.host.pure", op: "deep-equals", expected: true },
    { id: "l12", description: "the home-tenant bundle digest verifies", reading: "t10.host.digestVerified", op: "deep-equals", expected: true },
    { id: "l13", description: "the home-tenant overview still shows the real asset", reading: "t10.host.overview.assets", op: "deep-equals", expected: 1 },
  ],
};
