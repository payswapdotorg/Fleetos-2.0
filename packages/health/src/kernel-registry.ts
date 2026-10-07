/**
 * @fleetos/health — Wave 1 kernel registry (F210A).
 *
 * Diagnosis registry — a tenant-scoped, deterministic in-memory log of
 * diagnoses per device. The registry maintains the chain of diagnoses so
 * the supersession lineage is queryable. Tenant-scoped reads fail-closed.
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import type { DeviceIdLike } from "./health.js";
import type { DiagnosisHypothesisRecord } from "./kernel.js";

// ---------------------------------------------------------------------------
// DiagnosisRegistry — the in-memory chain of diagnoses per device.
// ---------------------------------------------------------------------------

export interface DiagnosisRegistry {
  readonly byId: ReadonlyMap<string, DiagnosisHypothesisRecord>;
  readonly byDevice: ReadonlyMap<DeviceIdLike, ReadonlyArray<string>>;
}

export function emptyDiagnosisRegistry(): DiagnosisRegistry {
  return { byId: new Map(), byDevice: new Map() };
}

export function registerDiagnosis(
  registry: DiagnosisRegistry,
  hypothesis: DiagnosisHypothesisRecord,
): DiagnosisRegistry {
  const byId = new Map(registry.byId);
  byId.set(hypothesis.id, hypothesis);
  const byDevice = new Map(registry.byDevice);
  const prior = byDevice.get(hypothesis.deviceId) ?? [];
  byDevice.set(hypothesis.deviceId, [...prior, hypothesis.id]);
  return { byId, byDevice };
}

export function lookupDiagnosis(
  registry: DiagnosisRegistry,
  tenantId: string,
  id: string,
): DiagnosisHypothesisRecord | null {
  const h = registry.byId.get(id);
  if (!h) return null;
  // Tenant fail-closed.
  if (h.tenantId !== tenantId) return null;
  return h;
}

export function listDiagnosesForDevice(
  registry: DiagnosisRegistry,
  tenantId: string,
  deviceId: DeviceIdLike,
): ReadonlyArray<DiagnosisHypothesisRecord> {
  const ids = registry.byDevice.get(deviceId) ?? [];
  return ids
    .map((id) => registry.byId.get(id))
    .filter((h): h is DiagnosisHypothesisRecord => h !== undefined && h.tenantId === tenantId);
}

export function currentDiagnosisForDevice(
  registry: DiagnosisRegistry,
  tenantId: string,
  deviceId: DeviceIdLike,
): DiagnosisHypothesisRecord | null {
  const list = listDiagnosesForDevice(registry, tenantId, deviceId);
  const live = list.filter((h) => h.supersededBy === null && h.state !== "superseded");
  if (live.length === 0) return null;
  return live.reduce((acc, h) => (h.transitionSeq > acc.transitionSeq ? h : acc), live[0]!);
}
