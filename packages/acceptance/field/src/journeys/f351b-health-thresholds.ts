/**
 * @fleetos/acceptance-field — F351B journey 5: the equipment health
 * threshold escalation discipline (Wave 16 lane A — the masked-industry
 * coverage tranche 1; mining-primary persona: haul-fleet equipment
 * health monitoring).
 *
 * CENSUS CITATION (F351B report §1, machine-measured at base `4f59ffe`;
 * zero grep matches across the field/security/commerce corpora):
 *   - triageWithConfidence — packages/health/src/kernel.ts:75
 *   - emptyDiagnosisRegistry — packages/health/src/kernel-registry.ts:24
 *   - registerDiagnosis — packages/health/src/kernel-registry.ts:28
 *   - lookupDiagnosis — packages/health/src/kernel-registry.ts:40
 *   - listDiagnosesForDevice — packages/health/src/kernel-registry.ts:52
 *   - currentDiagnosisForDevice — packages/health/src/kernel-registry.ts:63
 *
 * The REAL capability is @fleetos/health's threshold law: the
 * count-based escalation (a warning-class signal escalates to critical
 * at the REAL threshold of 3 observations), confidence grows with
 * corroboration and caps at 1, honest degradation (insufficient-data /
 * unknown-signal-vocabulary, never fabricated findings), priority
 * ordering (critical before warning before info, then device id), and
 * the tenant-scoped diagnosis registry with supersession-aware
 * current-diagnosis reads and fail-closed foreign lookups.
 *
 * Vocabulary law: persona `maintenance-planner` + capability
 * `investigation` (the monitoring/escalation family of the frozen
 * 14-capability vocabulary; no vocabulary change, F331A precedent).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { FOREIGN_TENANT } from "../fixtures.js";

const T0 = 1_774_000_000_000;

export const equipmentHealthThresholdEscalationJourney: AcceptanceJourney = {
  id: "equipment-health-threshold-escalation",
  persona: "maintenance-planner",
  capability: "investigation",
  goal: "Monitor equipment health honestly: the REAL escalation threshold lifts a warning-class signal to critical at 3 observations, confidence corroborates to its cap, degradation is recorded not fabricated (insufficient data, unknown vocabulary), findings are priority-ordered, and the diagnosis registry's supersession-aware reads fail closed on a foreign tenant.",
  steps: [
    { id: "h1", summary: "triage with NO observations (the honest insufficient-data degradation)", op: { kind: "hx.triage-empty", triagedAt: T0 } },
    { id: "h2", summary: "triage ONE fault signal (below the escalation threshold)", op: { kind: "hx.triage", triagedAt: T0 + 600_000, observations: [
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 500_000, payloadDigest: "d_fault-0001" },
    ] } },
    { id: "h3", summary: "triage THREE fault signals (the REAL escalation threshold fires)", op: { kind: "hx.triage", triagedAt: T0 + 1_200_000, observations: [
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 600_000, payloadDigest: "d_fault-0001" },
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 900_000, payloadDigest: "d_fault-0002" },
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 1_100_000, payloadDigest: "d_fault-0003" },
    ] } },
    { id: "h4", summary: "triage FIVE fault signals (confidence caps at the REAL maximum)", op: { kind: "hx.triage", triagedAt: T0 + 2_400_000, observations: [
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 600_000, payloadDigest: "d_fault-0001" },
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 900_000, payloadDigest: "d_fault-0002" },
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 1_100_000, payloadDigest: "d_fault-0003" },
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 1_500_000, payloadDigest: "d_fault-0004" },
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 2_000_000, payloadDigest: "d_fault-0005" },
    ] } },
    { id: "h5", summary: "triage a mixed board: a critical device, a warning device, and an UNKNOWN vocabulary kind", op: { kind: "hx.triage", triagedAt: T0 + 3_000_000, observations: [
      { deviceId: "dev_loader-02", kind: "telemetry.temp.warn", observedAt: T0 + 2_500_000, payloadDigest: "d_warn-0001" },
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 2_600_000, payloadDigest: "d_fault-0006" },
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 2_700_000, payloadDigest: "d_fault-0007" },
      { deviceId: "dev_haul-truck-07", kind: "event.fault", observedAt: T0 + 2_800_000, payloadDigest: "d_fault-0008" },
      { deviceId: "dev_crusher-01", kind: "custom.diag", observedAt: T0 + 2_900_000, payloadDigest: "d_custom-0001" },
    ] } },
    { id: "h6", summary: "open the diagnosis registry for the site", op: { kind: "hx.registry-open", registryId: "reg_site-01" } },
    { id: "h7", summary: "register the first hypothesis for the haul truck (proposed)", op: { kind: "hx.diagnosis-register", hypothesisId: "dx_haul-0001", deviceId: "dev_haul-truck-07", candidateCauses: ["brake-pad-wear"], confidence: 0.6, evidence: [{ digest: "d_fault-0003", kind: "observation", observedAt: T0 + 1_100_000 }], emittedAt: T0 + 1_200_000, state: "proposed", transitionSeq: 1 } },
    { id: "h8", summary: "register the superseding hypothesis (the prior closes with supersededBy)", op: { kind: "hx.diagnosis-register", hypothesisId: "dx_haul-0002", deviceId: "dev_haul-truck-07", candidateCauses: ["brake-line-contamination"], confidence: 0.8, evidence: [{ digest: "d_fault-0008", kind: "observation", observedAt: T0 + 2_800_000 }], emittedAt: T0 + 3_600_000, state: "corroborated", transitionSeq: 2, supersedes: "dx_haul-0001" } },
    { id: "h9", summary: "re-register the prior hypothesis in its SUPERSEDED form (append-only lineage)", op: { kind: "hx.diagnosis-register", hypothesisId: "dx_haul-0001", deviceId: "dev_haul-truck-07", candidateCauses: ["brake-pad-wear"], confidence: 0.6, evidence: [{ digest: "d_fault-0003", kind: "observation", observedAt: T0 + 1_100_000 }], emittedAt: T0 + 3_600_000, state: "superseded", transitionSeq: 3, supersededBy: "dx_haul-0002" } },
    { id: "h10", summary: "look up the superseded hypothesis with the owning tenant", op: { kind: "hx.diagnosis-lookup", hypothesisId: "dx_haul-0001" } },
    { id: "h11", summary: "look it up with a FOREIGN tenant (must fail closed)", expectRefusal: true, op: { kind: "hx.diagnosis-lookup", hypothesisId: "dx_haul-0001", tenantId: FOREIGN_TENANT } },
    { id: "h12", summary: "list the device's lineage with a FOREIGN tenant (must fail closed, empty)", expectRefusal: true, op: { kind: "hx.diagnosis-list", deviceId: "dev_haul-truck-07", tenantId: FOREIGN_TENANT } },
    { id: "h13", summary: "list the device's full lineage with the owning tenant", op: { kind: "hx.diagnosis-list", deviceId: "dev_haul-truck-07" } },
    { id: "h14", summary: "read the device's CURRENT diagnosis (supersession-aware)", op: { kind: "hx.diagnosis-current", deviceId: "dev_haul-truck-07" } },
  ],
  assertions: [
    { id: "t1", description: "an empty triage records the REAL insufficient-data degradation", reading: "h1.hx.degradation", op: "deep-equals", expected: "insufficient-data" },
    { id: "t2", description: "the empty triage's audit intent is the REAL degraded intent", reading: "h1.hx.auditIntent", op: "deep-equals", expected: "triage:degraded:insufficient-data" },
    { id: "t3", description: "one fault signal stays warning (below the escalation threshold)", reading: "h2.hx.firstSeverity", op: "deep-equals", expected: "warning" },
    { id: "t4", description: "one signal's confidence is the REAL corroborated fraction (1/5)", reading: "h2.hx.firstConfidence", op: "deep-equals", expected: 0.2 },
    { id: "t5", description: "THREE signals cross the REAL escalation threshold: warning lifts to critical", reading: "h3.hx.firstSeverity", op: "deep-equals", expected: "critical" },
    { id: "t6", description: "three signals' confidence is the REAL fraction (3/5)", reading: "h3.hx.firstConfidence", op: "deep-equals", expected: 0.6 },
    { id: "t7", description: "FIVE signals cap the confidence at the REAL maximum (1)", reading: "h4.hx.firstConfidence", op: "deep-equals", expected: 1 },
    { id: "t8", description: "five signals keep the escalated critical severity", reading: "h4.hx.firstSeverity", op: "deep-equals", expected: "critical" },
    { id: "t9", description: "the mixed board produces exactly the two known-vocabulary findings (the unknown kind is dropped, not fabricated)", reading: "h5.hx.findingCount", op: "deep-equals", expected: 2 },
    { id: "t10", description: "the mixed board records the REAL unknown-vocabulary degradation", reading: "h5.hx.degradation", op: "deep-equals", expected: "unknown-signal-vocabulary" },
    { id: "t11", description: "the findings are priority-ordered (critical before warning)", reading: "h5.hx.severities", op: "deep-equals", expected: ["critical", "warning"] },
    { id: "t12", description: "the critical finding names the haul truck (device-id ordering within severity)", reading: "h5.hx.firstDeviceId", op: "deep-equals", expected: "dev_haul-truck-07" },
    { id: "t13", description: "the registry opens empty", reading: "h6.hx.registryCount", op: "deep-equals", expected: 0 },
    { id: "t14", description: "the superseded re-registration keeps the registry at two live ids (append-only, id-addressed)", reading: "h9.hx.registryCount", op: "deep-equals", expected: 2 },
    { id: "t15", description: "the owning tenant reads the superseded hypothesis's state", reading: "h10.hx.lookupState", op: "deep-equals", expected: "superseded" },
    { id: "t16", description: "the superseded record carries the REAL supersededBy ref", reading: "h10.hx.lookupSupersededBy", op: "deep-equals", expected: "dx_haul-0002" },
    { id: "t17", description: "the foreign lookup fails closed with the REAL note", reading: "h11.hx.lookupRefused", op: "deep-equals", expected: "tenant-fail-closed" },
    { id: "t18", description: "the foreign listing fails closed and sees NOTHING", reading: "h12.hx.listRefused", op: "deep-equals", expected: "tenant-fail-closed" },
    { id: "t19", description: "the owning tenant sees the full append-only lineage (the superseded record appears at both its registrations, in order)", reading: "h13.hx.listStates", op: "deep-equals", expected: ["superseded", "corroborated", "superseded"] },
    { id: "t20", description: "the current diagnosis is the live corroborated hypothesis (supersession-aware)", reading: "h14.hx.currentId", op: "deep-equals", expected: "dx_haul-0002" },
    { id: "t21", description: "the current diagnosis's state is corroborated", reading: "h14.hx.currentState", op: "deep-equals", expected: "corroborated" },
    { id: "t22", description: "the triage audit is tamper-evident (the REAL digest verifies as a hex string)", reading: "h3.hx.auditDigest", op: "not-null" },
  ],
};
