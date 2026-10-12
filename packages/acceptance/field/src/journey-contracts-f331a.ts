/**
 * @fleetos/acceptance-field — F331A contracts: the edge firmware / OTA
 * campaign operations (Wave 13 lane A, work-item row 39). The executor
 * (ops/f331a-ota.ts) drives the REAL public APIs of @fleetos/maintenance's
 * firmware-campaign module; every op executes at the context's logical
 * clock. Pure data; no logic.
 */

export interface OtaDeclareCampaignOp {
  readonly kind: "ota.declare-campaign";
  readonly campaignId: string;
  readonly firmwareId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly waves: ReadonlyArray<{ readonly waveId: string; readonly deviceIds: readonly string[] }>;
}

export interface OtaAnnounceOp {
  readonly kind: "ota.announce";
  readonly campaignId: string;
}

export interface OtaStartWaveOp {
  readonly kind: "ota.start-wave";
  readonly campaignId: string;
  readonly waveId: string;
}

export interface OtaDeviceOutcomeOp {
  readonly kind: "ota.device-outcome";
  readonly campaignId: string;
  readonly deviceId: string;
  readonly ok: boolean;
  readonly failureReason?: string;
}

export interface OtaHaltOp {
  readonly kind: "ota.halt";
  readonly campaignId: string;
  /** Absent on purpose: the REAL refusal `halt-reason-required` is a probed
   * failure path of the same public API. */
  readonly reason?: string;
}

export interface OtaResumeOp {
  readonly kind: "ota.resume";
  readonly campaignId: string;
}

export interface OtaRollbackOp {
  readonly kind: "ota.rollback";
  readonly campaignId: string;
  readonly reason?: string;
}

export interface OtaDeviceRollbackOp {
  readonly kind: "ota.device-rollback";
  readonly campaignId: string;
  readonly deviceId: string;
}

export interface OtaProgressOp {
  readonly kind: "ota.progress";
  readonly campaignId: string;
}

export type F331AOperation =
  | OtaDeclareCampaignOp
  | OtaAnnounceOp
  | OtaStartWaveOp
  | OtaDeviceOutcomeOp
  | OtaHaltOp
  | OtaResumeOp
  | OtaRollbackOp
  | OtaDeviceRollbackOp
  | OtaProgressOp;

export const F331A_OTA_OP_KINDS: ReadonlySet<string> = new Set([
  "ota.declare-campaign",
  "ota.announce",
  "ota.start-wave",
  "ota.device-outcome",
  "ota.halt",
  "ota.resume",
  "ota.rollback",
  "ota.device-rollback",
  "ota.progress",
]);
