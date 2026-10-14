/**
 * @fleetos/acceptance-field — F351B journey 1: the asset registry
 * lifecycle audit (Wave 16 lane A — the masked-industry coverage tranche
 * 1; mining-primary persona: haul-fleet equipment onboarding).
 *
 * CENSUS CITATION (F351B report §1, machine-measured at base `4f59ffe`;
 * zero grep matches across the field/security/commerce corpora):
 *   - evaluateAssetTransition — packages/assets/src/assets.ts:76
 *   - applyTwinRevision — packages/assets/src/assets.ts:169
 *   - latestAttributes — packages/assets/src/assets.ts:238
 *   - projectTwin — packages/assets/src/kernel.ts:231
 *
 * The REAL capability is @fleetos/assets' registry discipline: the
 * lifecycle transition law (illegal transitions and re-admission are
 * refused with machine-stable codes), the append-only twin-revision law
 * (monotonic seq, no time travel, the input twin never mutated on
 * rejection), and the deterministic projection (manual-only revisions
 * are honestly "pending"; an observation-sourced revision makes the
 * twin "current").
 *
 * Vocabulary law: persona `fleet-operator` + capability `enrollment`
 * (the asset-admission family of the frozen 14-capability vocabulary;
 * no vocabulary change, F331A precedent).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";

const T0 = 1_774_000_000_000;

export const assetRegistryLifecycleAuditJourney: AcceptanceJourney = {
  id: "asset-registry-lifecycle-audit",
  persona: "fleet-operator",
  capability: "enrollment",
  goal: "Keep the fleet registry honest when onboarding heavy equipment: the REAL lifecycle transition law refuses illegal moves, the append-only twin-revision law refuses non-monotonic and stale inputs, and the deterministic projection reports pending vs current with observation provenance.",
  steps: [
    { id: "a1", summary: "audit the admitted->activate transition of the new haul truck", op: { kind: "ar.lifecycle-evaluate", state: "admitted", command: "activate" } },
    { id: "a2", summary: "audit the active->retire transition of the retiring loader", op: { kind: "ar.lifecycle-evaluate", state: "active", command: "retire" } },
    { id: "a3", summary: "probe the retired->activate move (must refuse: terminal state)", expectRefusal: true, op: { kind: "ar.lifecycle-evaluate", state: "retired", command: "activate" } },
    { id: "a4", summary: "probe re-admitting an already-active asset (must refuse)", expectRefusal: true, op: { kind: "ar.lifecycle-evaluate", state: "active", command: "admit" } },
    { id: "a5", summary: "bootstrap the haul truck's device twin with the yard's manual intake record (seq 1)", op: { kind: "ar.twin-revise", deviceId: "dev_haul-truck-07", seq: 1, observedAt: T0, appliedAt: T0, source: "manual", attributes: { site: "north-pit", odometer: 184_000 } } },
    { id: "a6", summary: "append the shift-start inspection revision (seq 2, new odometer)", op: { kind: "ar.twin-revise", deviceId: "dev_haul-truck-07", seq: 2, observedAt: T0 + 3_600_000, appliedAt: T0 + 3_600_000, source: "manual", attributes: { site: "north-pit", odometer: 184_250 } } },
    { id: "a7", summary: "probe a non-monotonic revision (seq 2 again — must refuse, append-only law)", expectRefusal: true, op: { kind: "ar.twin-revise", deviceId: "dev_haul-truck-07", seq: 2, observedAt: T0 + 7_200_000, appliedAt: T0 + 7_200_000, source: "manual", attributes: { odometer: 184_500 } } },
    { id: "a8", summary: "probe a time-travelling revision (seq 3 with an older observedAt — must refuse)", expectRefusal: true, op: { kind: "ar.twin-revise", deviceId: "dev_haul-truck-07", seq: 3, observedAt: T0, appliedAt: T0 + 7_200_000, source: "manual", attributes: { odometer: 184_500 } } },
    { id: "a9", summary: "append the first OBSERVATION-sourced revision (seq 3, payload digest provenance)", op: { kind: "ar.twin-revise", deviceId: "dev_haul-truck-07", seq: 3, observedAt: T0 + 10_800_000, appliedAt: T0 + 10_800_000, source: "observation", attributes: { site: "north-pit", odometer: 184_780, tirePressure: "nominal" }, observationRef: { deviceId: "dev_haul-truck-07", seq: 3, observedAt: T0 + 10_800_000, payloadDigest: "d_haul-obs-0003" } } },
    { id: "a10", summary: "read the twin's latest attributes (the head revision's, never merged)", op: { kind: "ar.twin-latest", deviceId: "dev_haul-truck-07" } },
    { id: "a11", summary: "project the twin over its full revision chain", op: { kind: "ar.twin-project", deviceId: "dev_haul-truck-07" } },
    { id: "a12", summary: "bootstrap a manual-only twin for the site office's handheld (no observations yet)", op: { kind: "ar.twin-revise", deviceId: "dev_site-tablet-01", seq: 1, observedAt: T0, appliedAt: T0, source: "manual", attributes: { assignedTo: "site-clerk" } } },
    { id: "a13", summary: "project the manual-only twin (must be honestly pending, not current)", op: { kind: "ar.twin-project", deviceId: "dev_site-tablet-01" } },
    { id: "a14", summary: "read the manual-only twin's latest attributes", op: { kind: "ar.twin-latest", deviceId: "dev_site-tablet-01" } },
  ],
  assertions: [
    { id: "r1", description: "admitted->activate is the legal onboarding move", reading: "a1.ar.evalTo", op: "deep-equals", expected: "active" },
    { id: "r2", description: "active->retire is the legal retirement move", reading: "a2.ar.evalTo", op: "deep-equals", expected: "retired" },
    { id: "r3", description: "the retired terminal state refuses activation with the REAL reason", reading: "a3.ar.evalReason", op: "deep-equals", expected: "illegal-transition" },
    { id: "r4", description: "re-admission of an active asset refuses with the REAL reason (admit is the implicit creation)", reading: "a4.ar.evalReason", op: "deep-equals", expected: "already-in-target-state" },
    { id: "r5", description: "the bootstrap revision lands at seq 1", reading: "a5.ar.revLastSeq", op: "deep-equals", expected: 1 },
    { id: "r6", description: "the bootstrap creates exactly one revision", reading: "a5.ar.revCount", op: "deep-equals", expected: 1 },
    { id: "r7", description: "the append lands at seq 2 with two revisions", reading: "a6.ar.revCount", op: "deep-equals", expected: 2 },
    { id: "r8", description: "a non-monotonic seq refuses with the REAL append-only reason", reading: "a7.ar.revReason", op: "deep-equals", expected: "non-monotonic-seq" },
    { id: "r9", description: "a time-travelling observedAt refuses with the REAL reason", reading: "a8.ar.revReason", op: "deep-equals", expected: "stale-observed-at" },
    { id: "r10", description: "the observation-sourced revision lands at seq 3 with three revisions", reading: "a9.ar.revCount", op: "deep-equals", expected: 3 },
    { id: "r11", description: "the head revision's attributes carry the observation's tire pressure", reading: "a10.ar.latestOdometer", op: "deep-equals", expected: 184_780 },
    { id: "r12", description: "latestAttributes returns the HEAD revision's keys (not merged)", reading: "a10.ar.latestKeys", op: "deep-equals", expected: ["odometer", "site", "tirePressure"] },
    { id: "r13", description: "an observation-sourced revision makes the projection CURRENT", reading: "a11.ar.projectState", op: "deep-equals", expected: "current" },
    { id: "r14", description: "the projection head seq is the last revision's", reading: "a11.ar.projectLastSeq", op: "deep-equals", expected: 3 },
    { id: "r15", description: "the projection MERGES the chain (3 keys across revisions: site, odometer, tirePressure)", reading: "a11.ar.projectAttributeCount", op: "deep-equals", expected: 3 },
    { id: "r16", description: "the Wave-0 revision type carries no head digest — honestly null, never fabricated", reading: "a11.ar.projectHeadDigest", op: "is-null" },
    { id: "r17", description: "a manual-only twin projects to PENDING (no observation provenance yet)", reading: "a13.ar.projectState", op: "deep-equals", expected: "pending" },
    { id: "r18", description: "the manual-only twin's latest attributes are the intake record's", reading: "a14.ar.latestKeys", op: "deep-equals", expected: ["assignedTo"] },
    { id: "r19", description: "the refused non-monotonic revision left the twin untouched (still 2 revisions)", reading: "a7.ar.revCount", op: "deep-equals", expected: 2 },
    { id: "r20", description: "the refused time-travelling revision left the twin at seq 2 (the input twin is never mutated on rejection)", reading: "a8.ar.revLastSeq", op: "deep-equals", expected: 2 },
    { id: "r21", description: "the twin's last observedAt advanced monotonically to the observation's", reading: "a9.ar.revLastObservedAt", op: "deep-equals", expected: T0 + 10_800_000 },
  ],
};
