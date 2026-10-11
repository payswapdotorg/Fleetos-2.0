/**
 * @fleetos/acceptance-field — F321A contracts: the edge-ingestion family
 * (Wave 12 lane A). Slots 14 (store-and-forward redelivery), 15 (offline
 * buffer capture/replay) and 21-SUBSTITUTE (ingestion admission discipline —
 * the F310C §3.6-named mining area's public surface; ADCOS is CONTRACT_ONLY /
 * provider-not-ready and is NOT driven anywhere).
 *
 * Split out of journey-contracts-f321a.ts to hold the ≤400-line file law
 * (the F310C commerce split-file precedent). Pure data; no logic.
 */

import type { ObservationPayload } from "./journey-contracts.js";

// ---------------------------------------------------------------------------
// Slot 14 — store-and-forward redelivery (observations store-forward).
// ---------------------------------------------------------------------------

export interface StoreForwardSignOp {
  readonly kind: "storeforward.sign";
  readonly bundleId: string;
  readonly deviceId: string;
  readonly seq: number;
  readonly agentKey: string;
  readonly entries: ReadonlyArray<{
    readonly seq: number;
    readonly observedAt: number;
    readonly observationKind: string;
    readonly payload: ObservationPayload;
  }>;
}

export interface StoreForwardReceiveOp {
  readonly kind: "storeforward.receive";
  readonly bundleId: string;
  readonly agentKey: string;
}

export interface StoreForwardReceiveForgedOp {
  readonly kind: "storeforward.receive-forged";
  readonly bundleId: string;
}

export interface StoreForwardReceiveTamperedOp {
  readonly kind: "storeforward.receive-tampered";
  readonly bundleId: string;
  readonly observationIndex: number;
}

export interface StoreForwardSequenceReportOp {
  readonly kind: "storeforward.sequence-report";
  readonly deviceId: string;
}

// ---------------------------------------------------------------------------
// Slot 15 — offline buffer capture/replay (connectivity offline-buffer).
// ---------------------------------------------------------------------------

export interface OfflineOpenBufferOp {
  readonly kind: "offline.open-buffer";
  readonly deviceId: string;
  readonly maxEntries: number;
  readonly ttlMs: number;
  readonly overflow: "drop-oldest" | "reject-newest";
}

export interface OfflineCaptureOp {
  readonly kind: "offline.capture";
  readonly deviceId: string;
  readonly entryId: string;
  readonly entryKind: string;
  readonly payload: ObservationPayload;
  readonly posture: "offline" | "degraded" | "connected";
  readonly at: number;
  /** Optional fail-closed tenant scope probe (foreign tenant refused). */
  readonly tenantId?: string;
}

export interface OfflineStampPostureOp {
  readonly kind: "offline.stamp-posture";
  readonly deviceId: string;
  readonly from: "offline" | "degraded" | "connected";
  readonly to: "offline" | "degraded" | "connected";
  readonly at: number;
}

export interface OfflineReplayOp {
  readonly kind: "offline.replay";
  readonly deviceId: string;
  readonly posture: "offline" | "degraded" | "connected";
  readonly now: number;
}

export interface OfflineSweepOp {
  readonly kind: "offline.sweep";
  readonly deviceId: string;
  readonly now: number;
}

// ---------------------------------------------------------------------------
// Slot 21 (substitute) — ingestion admission discipline (observations
// ingestion-limits; the F310C §3.6-named mining area, public surface).
// ---------------------------------------------------------------------------

export interface LimitsOpenBufferOp {
  readonly kind: "limits.open-buffer";
  readonly maxEntries: number;
  readonly maxTotalPayloadBytes: number;
  readonly overflow: "drop-oldest" | "reject-newest";
}

export interface LimitsBufferOp {
  readonly kind: "limits.buffer";
  readonly deviceId: string;
  readonly payloadBytes: number;
  readonly at: number;
}

export interface LimitsAdmissionCapOp {
  readonly kind: "limits.admission-cap";
  readonly cap: number;
}

export interface LimitsCheckAdmissionOp {
  readonly kind: "limits.check-admission";
  readonly requested: number;
}

export interface LimitsBatchOp {
  readonly kind: "limits.batch";
  readonly deviceId: string;
  readonly fromSeq: number;
  readonly count: number;
  readonly observationKind: string;
  readonly firstObservedAt: number;
  readonly stepMs: number;
  readonly maxBatchSize: number;
  readonly maxPayloadBytesPerItem: number;
}

/** The edge-ingestion sub-union of the F321A operations. */
export type F321AEdgeOperation =
  | StoreForwardSignOp
  | StoreForwardReceiveOp
  | StoreForwardReceiveForgedOp
  | StoreForwardReceiveTamperedOp
  | StoreForwardSequenceReportOp
  | OfflineOpenBufferOp
  | OfflineCaptureOp
  | OfflineStampPostureOp
  | OfflineReplayOp
  | OfflineSweepOp
  | LimitsOpenBufferOp
  | LimitsBufferOp
  | LimitsAdmissionCapOp
  | LimitsCheckAdmissionOp
  | LimitsBatchOp;
