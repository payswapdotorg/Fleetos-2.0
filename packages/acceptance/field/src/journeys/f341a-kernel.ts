/**
 * @fleetos/acceptance-field — F341A D17 sixth-slot journey: the observations
 * kernel immutability-audit law (Wave 14 lane A; TL-adjudicated per F340 §2
 * D17 — "APPROVED … genuine — the census evidence, the distinctness-from-A2
 * note, and the three real refusal reasons check out").
 *
 * CENSUS EVIDENCE (machine-verified at base `81be8e7`): the Wave 1 kernel
 * family `packages/observations/src/kernel.ts` — `admitToLog` /
 * `emptyAdmittedLog` / `listObservationsForDevice` /
 * `assertObservationImmutable` — is exported through @fleetos/observations'
 * public root index and had ZERO acceptance-corpus coverage (grep over
 * `packages/acceptance/field/**` = zero matches; the four grep runs are
 * recorded in the lane log).
 *
 * The REAL capability is @fleetos/observations' kernel admission + audit
 * law: idempotent admission into the authoritative admitted log with a
 * digest-backed AuditEventRef on every consequential operation (the
 * idempotent path carries its own honest intent), monotonic-seq discipline
 * (a stale re-ordering attempt is refused, never silently re-ordered),
 * tenant fail-closed per-device listing, and raw immutability — a mutated
 * re-presentation of an admitted observation is refused with a typed
 * reason (device-mismatch / seq-mismatch / digest-mismatch).
 *
 * Distinctness note (the TL's adjudication): the verification semantics
 * (cross-checking a RE-PRESENTED candidate against the stored record, with
 * typed mismatch reason codes) are distinct from A2's store-immutability
 * law (the store never mutates stored records).
 *
 * Vocabulary law: persona `fleet-operator` + capability `trustworthy-state`
 * (the retained observation truth family — the same cell as A2 under the
 * F300A multi-journey-per-cell precedent; no vocabulary change).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { AST_TRUCK, DEV_TELEMETRY, FOREIGN_TENANT, T0 } from "../fixtures.js";

export const observationsKernelImmutabilityAuditJourney: AcceptanceJourney = {
  id: "observations-kernel-immutability-audit",
  persona: "fleet-operator",
  capability: "trustworthy-state",
  goal: "Keep the kernel's admitted log honest: idempotent admission with digest-backed audit refs, monotonic-seq discipline, fail-closed per-device listing, and typed tamper refusals against the stored source of truth.",
  steps: [
    { id: "k1", summary: "admit the fleet's truck asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "k2", summary: "enroll the telemetry device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "k3", summary: "open the kernel's admitted log (the authoritative read side)", op: { kind: "kern.log-open", logId: "kern_dev-log-01" } },
    { id: "k4", summary: "admit observation seq 1 (telemetry.temp) through the REAL admitToLog", op: { kind: "kern.admit", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY, seq: 1, observedAt: T0 + 1_000, admittedAt: T0 + 1_500, observationKind: "telemetry.temp", payload: { tempC: 41 } } },
    { id: "k5", summary: "admit observation seq 2 (telemetry.temp)", op: { kind: "kern.admit", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY, seq: 2, observedAt: T0 + 2_000, admittedAt: T0 + 2_500, observationKind: "telemetry.temp", payload: { tempC: 42 } } },
    { id: "k6", summary: "admit observation seq 3 (telemetry.flow)", op: { kind: "kern.admit", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY, seq: 3, observedAt: T0 + 3_000, admittedAt: T0 + 3_500, observationKind: "telemetry.flow", payload: { flowLpm: 118 } } },
    { id: "k7", summary: "list the device's admitted observations through the REAL fail-closed listing (own tenant)", op: { kind: "kern.list-device", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY } },
    { id: "k8", summary: "re-present the identical seq-2 admission (the kernel's idempotent duplicate path)", op: { kind: "kern.admit", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY, seq: 2, observedAt: T0 + 2_000, admittedAt: T0 + 2_500, observationKind: "telemetry.temp", payload: { tempC: 42 } } },
    {
      id: "k9",
      summary: "a stale seq-0 re-ordering attempt is refused (monotonic-seq discipline, never silently re-ordered)",
      expectRefusal: true,
      op: { kind: "kern.admit", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY, seq: 0, observedAt: T0 + 500, admittedAt: T0 + 600, observationKind: "telemetry.temp", payload: { tempC: 99 } },
    },
    { id: "k10", summary: "a foreign tenant's listing of the same device is fail-closed (empty, nothing fabricated)", op: { kind: "kern.list-device", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY, tenantId: FOREIGN_TENANT } },
    { id: "k11", summary: "re-present the stored seq-2 identity untampered (the immutability check verifies)", op: { kind: "kern.immutability-probe", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY, seq: 2 } },
    {
      id: "k12",
      summary: "a re-presentation with a forged deviceId is refused (device-mismatch)",
      expectRefusal: true,
      op: { kind: "kern.immutability-probe", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY, seq: 2, tamper: "device" },
    },
    {
      id: "k13",
      summary: "a re-presentation with a forged seq is refused (seq-mismatch)",
      expectRefusal: true,
      op: { kind: "kern.immutability-probe", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY, seq: 2, tamper: "seq" },
    },
    {
      id: "k14",
      summary: "a re-presentation with a forged payload digest is refused (digest-mismatch)",
      expectRefusal: true,
      op: { kind: "kern.immutability-probe", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY, seq: 2, tamper: "digest" },
    },
    { id: "k15", summary: "re-list the device after every probe (the log is unchanged — tamper probes never mutate the source of truth)", op: { kind: "kern.list-device", logId: "kern_dev-log-01", deviceId: DEV_TELEMETRY } },
  ],
  assertions: [
    { id: "ka1", description: "a fresh REAL admitted log is empty", reading: "k3.kern.logEmpty", op: "deep-equals", expected: true },
    { id: "ka2", description: "the first admission is accepted", reading: "k4.kern.admitted", op: "deep-equals", expected: true },
    { id: "ka3", description: "the first admission is NOT a duplicate", reading: "k4.kern.ackDuplicate", op: "deep-equals", expected: false },
    { id: "ka4", description: "the admission carries the REAL audit intent", reading: "k4.kern.auditIntent", op: "deep-equals", expected: "observation:admit" },
    { id: "ka5", description: "the audit ref names the device as its actor", reading: "k4.kern.auditActor", op: "deep-equals", expected: DEV_TELEMETRY },
    { id: "ka6", description: "the audit ref carries the admitting tenant", reading: "k4.kern.auditTenant", op: "reading-equals", expected: "k4.kern.ctxTenant" },
    { id: "ka7", description: "the audit ref is digest-backed", reading: "k4.kern.auditDigest", op: "not-null" },
    { id: "ka8", description: "the log holds exactly the three admitted observations", reading: "k6.kern.logSize", op: "deep-equals", expected: 3 },
    { id: "ka9", description: "the device's high-water seq in the log is 3", reading: "k6.kern.lastSeq", op: "deep-equals", expected: 3 },
    { id: "ka10", description: "the own-tenant listing counts all three admissions", reading: "k7.kern.listCount", op: "deep-equals", expected: 3 },
    { id: "ka11", description: "the listing preserves the admission order (seqs 1, 2, 3)", reading: "k7.kern.listSeqs", op: "deep-equals", expected: [1, 2, 3] },
    { id: "ka12", description: "no foreign-tenant record ever leaks into the listing", reading: "k7.kern.listTenantMismatched", op: "deep-equals", expected: false },
    { id: "ka13", description: "the identical re-presentation is an idempotent duplicate", reading: "k8.kern.ackDuplicate", op: "deep-equals", expected: true },
    { id: "ka14", description: "the duplicate path returns the log UNTOUCHED (the same reference)", reading: "k8.kern.sameLogReference", op: "deep-equals", expected: true },
    { id: "ka15", description: "the duplicate grows nothing (the log still holds three)", reading: "k8.kern.logSize", op: "deep-equals", expected: 3 },
    { id: "ka16", description: "the duplicate ack names the SAME observation the log admitted", reading: "k8.kern.ackId", op: "reading-equals", expected: "k5.kern.obsId" },
    { id: "ka17", description: "the audit trail distinguishes the idempotent path honestly", reading: "k8.kern.auditIntent", op: "deep-equals", expected: "observation:admit:idempotent" },
    { id: "ka18", description: "the stale seq re-ordering attempt is refused with the REAL reason", reading: "k9.kern.admitRefused", op: "deep-equals", expected: "non-monotonic-seq" },
    { id: "ka19", description: "the foreign tenant's listing is fail-closed (empty)", reading: "k10.kern.foreignListEmpty", op: "deep-equals", expected: true },
    { id: "ka20", description: "the foreign tenant's listing counts nothing (honest absence)", reading: "k10.kern.listCount", op: "deep-equals", expected: 0 },
    { id: "ka21", description: "the untampered re-presentation verifies as immutable", reading: "k11.kern.immutableOk", op: "deep-equals", expected: true },
    { id: "ka22", description: "the check returns the SAME stored observation", reading: "k11.kern.checkedId", op: "reading-equals", expected: "k5.kern.obsId" },
    { id: "ka23", description: "the check's digest is the stored observation's REAL payload digest", reading: "k11.kern.checkDigest", op: "reading-equals", expected: "k5.kern.payloadDigest" },
    { id: "ka24", description: "a forged deviceId is refused with device-mismatch", reading: "k12.kern.checkRefused", op: "deep-equals", expected: "device-mismatch" },
    { id: "ka25", description: "a forged seq is refused with seq-mismatch", reading: "k13.kern.checkRefused", op: "deep-equals", expected: "seq-mismatch" },
    { id: "ka26", description: "a forged payload digest is refused with digest-mismatch", reading: "k14.kern.checkRefused", op: "deep-equals", expected: "digest-mismatch" },
    { id: "ka27", description: "after every probe the listing still counts three (nothing mutated the log)", reading: "k15.kern.listCount", op: "deep-equals", expected: 3 },
    { id: "ka28", description: "the high-water seq is unchanged after every probe", reading: "k15.kern.lastSeq", op: "deep-equals", expected: 3 },
  ],
};
