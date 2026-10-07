/**
 * @fleetos/experience-asset-field — field mode (F240A deliverable 2).
 *
 * `assembleFieldView(state, options)` — the phone-shaped field operator
 * view: PRIORITY-ORDERED, SIZE-BOUNDED sections (top alerts, recovery in
 * progress, next maintenance, connectivity status).
 *
 * OFFLINE TOLERANCE IS A LAW here: this view is rendered from LAST-KNOWN
 * state. Every observed-data entry carries explicit last-known provenance
 * (`lastKnown.at` + a fresh/stale/unknown classification of that instant
 * against the view's logical `now`); a view containing any non-fresh
 * section lists that section in `lastKnownSections` and NO entry ever
 * claims freshness for data whose classification says otherwise.
 * Maintenance schedule entries are DECLARED intents (plan schedules), not
 * observations — they carry their declared timestamps and make no
 * freshness claim at all.
 *
 * Determinism: no clock, no randomness; `now` caller-supplied; every
 * section has a total deterministic order; the whole view digests to a
 * stable FNV-1a value.
 */

import { latestAttributes } from "@fleetos/assets";
import { defaultHeartbeatTtl, honestPosture } from "@fleetos/connectivity";
import type { HeartbeatTtl, HonestPosture } from "@fleetos/connectivity";
import type { Severity } from "@fleetos/health";
import { nextRun } from "@fleetos/maintenance";
import type { ServicePlanKind } from "@fleetos/maintenance";
import { viewDigestOf } from "./digest.js";
import { buildStateIndexes } from "./indexes.js";
import type { ExperienceStateSlice } from "./state.js";
import {
  limitScalarFields,
  redactForPurpose,
  type ScalarFieldValue,
  type ViewRedactionRule,
} from "./redaction.js";
import { classifyRecency, defaultRecencyThresholds, type RecencyThresholds } from "./staleness.js";
import type { StalenessClass } from "./staleness.js";
import { guardView, SCHEMA_VERSION, type ViewResult } from "./view-support.js";
import type { RecoveryState } from "@fleetos/recovery";

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};
const OPEN_RECOVERY: ReadonlySet<RecoveryState> = new Set([
  "open",
  "investigating",
  "proposal",
] as const);

export interface FieldSectionLimits {
  /** Top alerts kept (priority order). Default 5. */
  readonly alerts?: number;
  /** Recovery-in-progress entries kept. Default 5. */
  readonly recoveries?: number;
  /** Next-maintenance entries kept. Default 5. */
  readonly maintenance?: number;
  /** Connectivity entries kept. Default 12. */
  readonly connectivity?: number;
  /** Attribute keys per connectivity entry. Default 4. */
  readonly attributeKeys?: number;
}

export interface FieldViewOptions {
  readonly now: number;
  readonly thresholds?: RecencyThresholds;
  readonly ttl?: HeartbeatTtl;
  readonly rules?: readonly ViewRedactionRule[];
  readonly limits?: FieldSectionLimits;
}

/** Explicit last-known provenance — the offline-tolerance stamp. */
export interface LastKnownProvenance {
  readonly at: number | null;
  readonly staleness: StalenessClass;
  readonly ageMs: number | null;
}

export interface FieldAlert {
  readonly deviceId: string;
  readonly assetId: string;
  readonly assetDisplayName: string;
  readonly code: string;
  readonly severity: Severity;
  readonly observedAt: number;
  readonly lastKnown: LastKnownProvenance;
}

export interface FieldRecovery {
  readonly caseId: string;
  readonly deviceId: string;
  readonly assetId: string;
  readonly state: RecoveryState;
  readonly openedAt: number;
  readonly lastKnown: LastKnownProvenance;
}

export interface FieldMaintenance {
  readonly entryKind: "order" | "plan";
  readonly refId: string;
  readonly planId: string;
  readonly assetId: string;
  readonly planKind: ServicePlanKind;
  /** Present on order entries only. */
  readonly orderState?: string;
  readonly nextRunAt: number | null;
}

export interface FieldConnectivity {
  readonly deviceId: string;
  readonly assetId: string;
  readonly posture: HonestPosture;
  readonly lastKnown: LastKnownProvenance;
  /** Redacted scalar attribute excerpt of the device twin. */
  readonly attributes: Readonly<Record<string, ScalarFieldValue>>;
}

export interface BoundedSection<E> {
  readonly entries: readonly E[];
  readonly truncated: boolean;
  readonly omittedCount: number;
}

export interface FieldView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly topAlerts: BoundedSection<FieldAlert>;
  readonly recoveryInProgress: BoundedSection<FieldRecovery>;
  readonly nextMaintenance: BoundedSection<FieldMaintenance>;
  readonly connectivityStatus: BoundedSection<FieldConnectivity>;
  /** Sections still rendering last-known (non-fresh) data. */
  readonly lastKnownSections: readonly string[];
  readonly digest: string;
}

function bounded<E>(entries: readonly E[], limit: number): BoundedSection<E> {
  const kept = entries.slice(0, limit);
  return {
    entries: kept,
    truncated: entries.length > limit,
    omittedCount: Math.max(0, entries.length - limit),
  };
}

function lastKnownAt(at: number, now: number, thresholds: RecencyThresholds): LastKnownProvenance {
  const classified = classifyRecency(at, now, thresholds);
  return classified.ok
    ? { at, staleness: classified.reading.staleness, ageMs: classified.reading.ageMs }
    : { at, staleness: "unknown", ageMs: null };
}

function fieldViewDigestOf(view: Omit<FieldView, "digest">): string {
  return viewDigestOf("field-view", view);
}

/** Recompute the field-view digest; false means tampered content. */
export function verifyFieldViewDigest(view: FieldView): boolean {
  const { digest, ...rest } = view;
  return fieldViewDigestOf(rest) === digest;
}

/** Assemble the phone-shaped field operator view. */
export function assembleFieldView(
  state: ExperienceStateSlice,
  options: FieldViewOptions,
): ViewResult<FieldView> {
  const thresholds = options.thresholds ?? defaultRecencyThresholds();
  const ttl = options.ttl ?? defaultHeartbeatTtl();
  const limits = options.limits ?? {};
  const alertLimit = limits.alerts ?? 5;
  const recoveryLimit = limits.recoveries ?? 5;
  const maintenanceLimit = limits.maintenance ?? 5;
  const connectivityLimit = limits.connectivity ?? 12;
  const attributeKeys = limits.attributeKeys ?? 4;
  const refused = guardView(state, options.now, thresholds);
  if (refused) return refused;
  const indexes = buildStateIndexes(state);

  const alerts: FieldAlert[] = [];
  for (const finding of state.findings) {
    const device = indexes.deviceById.get(finding.deviceId);
    if (!device) continue; // guarded; kept for total determinism
    const asset = indexes.assetById.get(device.assetId);
    alerts.push({
      deviceId: finding.deviceId,
      assetId: device.assetId,
      assetDisplayName: asset?.displayName ?? device.assetId,
      code: finding.code,
      severity: finding.severity,
      observedAt: finding.observedAt,
      lastKnown: lastKnownAt(finding.observedAt, options.now, thresholds),
    });
  }
  alerts.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.observedAt !== b.observedAt) return b.observedAt - a.observedAt;
    if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
    return a.code < b.code ? -1 : 1;
  });

  const recoveries: FieldRecovery[] = [];
  for (const recoveryCase of state.recoveryCases) {
    if (!OPEN_RECOVERY.has(recoveryCase.state)) continue;
    const device = indexes.deviceById.get(recoveryCase.deviceId);
    if (!device) continue;
    const lastStep = recoveryCase.history[recoveryCase.history.length - 1] ?? null;
    const lastKnownTime = lastStep?.at ?? recoveryCase.openedAt;
    recoveries.push({
      caseId: recoveryCase.id,
      deviceId: recoveryCase.deviceId,
      assetId: device.assetId,
      state: recoveryCase.state,
      openedAt: recoveryCase.openedAt,
      lastKnown: lastKnownAt(lastKnownTime, options.now, thresholds),
    });
  }
  recoveries.sort((a, b) => {
    if (a.openedAt !== b.openedAt) return a.openedAt - b.openedAt;
    return a.caseId < b.caseId ? -1 : 1;
  });

  const maintenance: FieldMaintenance[] = [];
  const plansById = [...state.plans].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const plan of plansById) {
    const scheduled = (indexes.ordersByPlan.get(plan.id) ?? []).filter(
      (order) => order.state === "scheduled",
    );
    const nextRunAt = nextRun(plan.schedule, options.now);
    if (scheduled.length === 0) {
      maintenance.push({
        entryKind: "plan",
        refId: plan.id,
        planId: plan.id,
        assetId: plan.assetId,
        planKind: plan.kind,
        nextRunAt,
      });
    } else {
      for (const order of scheduled) {
        maintenance.push({
          entryKind: "order",
          refId: order.id,
          planId: plan.id,
          assetId: plan.assetId,
          planKind: plan.kind,
          orderState: order.state,
          nextRunAt,
        });
      }
    }
  }
  maintenance.sort((a, b) => {
    if (a.nextRunAt !== b.nextRunAt) {
      if (a.nextRunAt === null) return 1;
      if (b.nextRunAt === null) return -1;
      return a.nextRunAt - b.nextRunAt;
    }
    return a.refId < b.refId ? -1 : 1;
  });

  const connectivity: FieldConnectivity[] = [];
  for (const device of [...state.devices].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const record = indexes.connectivityByDevice.get(device.id) ?? null;
    const twin = indexes.twinByDevice.get(device.id);
    const redaction = twin
      ? redactForPurpose("field-mode", latestAttributes(twin), options.rules)
      : null;
    if (redaction && !redaction.ok) {
      return { ok: false, rejected: "unknown-purpose", detail: redaction.detail };
    }
    const provenance: LastKnownProvenance = record
      ? lastKnownAt(record.observedAt, options.now, thresholds)
      : { at: null, staleness: "unknown", ageMs: null };
    connectivity.push({
      deviceId: device.id,
      assetId: device.assetId,
      posture: honestPosture(record, ttl, options.now),
      lastKnown: provenance,
      attributes: redaction
        ? limitScalarFields(redaction.outcome.fields, attributeKeys)
        : {},
    });
  }

  const lastKnownSections: string[] = [];
  if (alerts.some((a) => a.lastKnown.staleness !== "fresh")) lastKnownSections.push("top-alerts");
  if (recoveries.some((r) => r.lastKnown.staleness !== "fresh")) {
    lastKnownSections.push("recovery-in-progress");
  }
  if (connectivity.some((c) => c.lastKnown.staleness !== "fresh")) {
    lastKnownSections.push("connectivity-status");
  }

  const base: Omit<FieldView, "digest"> = {
    schemaVersion: SCHEMA_VERSION,
    tenantId: state.tenantId,
    asOf: options.now,
    topAlerts: bounded(alerts, alertLimit),
    recoveryInProgress: bounded(recoveries, recoveryLimit),
    nextMaintenance: bounded(maintenance, maintenanceLimit),
    connectivityStatus: bounded(connectivity, connectivityLimit),
    lastKnownSections,
  };
  return { ok: true, view: { ...base, digest: fieldViewDigestOf(base) } };
}
