/**
 * @fleetos/maintenance — F331A edge firmware / OTA campaign management
 * (Wave 13 lane A, work-item row 39).
 *
 *   - A firmware campaign rolls a device fleet from one firmware version to
 *     the next in STAGED WAVES (explicit device cohorts, one wave at a time,
 *     each wave fully accounted before the next may start).
 *   - An operator may HALT a running campaign (reason required, freeze
 *     recorded) and RESUME it, or ROLL IT BACK (only after a halt, only for
 *     devices that actually applied the new firmware — the rollback wave).
 *   - Every transition is journaled append-only, tenant-scoped and
 *     hash-chained (firmware-campaign-journal.ts — tamper-evident).
 *   - Deterministic pure TypeScript: no clocks (logical `at` is
 *     caller-supplied), no I/O, no randomness. Map iteration never leaks
 *     into outputs — every list is explicitly sorted.
 *
 * Refusals are machine-stable reason codes; illegal moves never mutate.
 * The progress read model lives in firmware-campaign-progress.ts (the
 * split-file law).
 */

import type { TenantIdLike } from "./maintenance.js";
import { appendCampaignEvent, type FirmwareCampaignEvent, type FirmwareCampaignEventInput } from "./firmware-campaign-journal.js";

// ---------------------------------------------------------------------------
// Vocabulary — campaign + wave states, reason codes.
// ---------------------------------------------------------------------------

export type FirmwareCampaignState =
  | "draft"
  | "announced"
  | "deploying"
  | "halted"
  | "rolling-back"
  | "completed"
  | "rolled-back";

export type FirmwareWaveState = "pending" | "deploying" | "verified" | "rolled-back";

export type FirmwareCampaignRejection =
  | "illegal-transition"
  | "tenant-mismatch"
  | "halt-reason-required"
  | "campaign-halted"
  | "wave-out-of-order"
  | "unknown-wave"
  | "device-not-in-current-wave"
  | "duplicate-device-outcome"
  | "no-applied-devices"
  | "halt-first"
  | "version-regression"
  | "malformed-version"
  | "empty-wave"
  | "duplicate-wave-id"
  | "device-in-two-waves"
  | "unknown-device-ref";

export type FirmwareCampaignResult<T> =
  | { readonly ok: true; readonly campaign: T }
  | { readonly ok: false; readonly reason: FirmwareCampaignRejection };

// ---------------------------------------------------------------------------
// Campaign records.
// ---------------------------------------------------------------------------

export interface FirmwareWave {
  readonly waveId: string;
  readonly deviceIds: readonly string[]; // sorted at declaration
  readonly state: FirmwareWaveState;
}

export interface FirmwareDeviceOutcome {
  readonly appliedAt: number | null;
  readonly failedAt: number | null;
  readonly failureReason: string | null;
  readonly rolledBackAt: number | null;
}

export interface FirmwareCampaign {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly firmwareId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly declaredAt: number;
  readonly state: FirmwareCampaignState;
  readonly waves: readonly FirmwareWave[];
  /** Applied/failed per device — absent until the device reports. */
  readonly outcomes: Readonly<Record<string, FirmwareDeviceOutcome>>;
  readonly halt: { readonly reason: string; readonly at: number } | null;
  readonly haltFrom: FirmwareCampaignState | null;
  readonly rollback: { readonly reason: string; readonly at: number } | null;
  readonly events: readonly FirmwareCampaignEvent[];
}

function withEvent(campaign: FirmwareCampaign, input: FirmwareCampaignEventInput, patch: Partial<FirmwareCampaign>): FirmwareCampaign {
  return { ...campaign, ...patch, events: appendCampaignEvent(campaign.events, input) };
}

// ---------------------------------------------------------------------------
// Validation helpers.
// ---------------------------------------------------------------------------

const VERSION_RE = /^\d+(\.\d+)*$/;

/** Deterministic dotted-numeric version compare (negative/zero/positive). */
export function compareFirmwareVersions(a: string, b: string): number {
  const sa = a.split(".").map((p) => Number.parseInt(p, 10));
  const sb = b.split(".").map((p) => Number.parseInt(p, 10));
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i += 1) {
    const da = sa[i] ?? 0;
    const db = sb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function isFirmwareVersion(v: string): boolean {
  return typeof v === "string" && VERSION_RE.test(v) && v.length > 0;
}

// ---------------------------------------------------------------------------
// Declare — the staged campaign plan (waves of explicit device cohorts).
// ---------------------------------------------------------------------------

export interface DeclareFirmwareCampaignInput {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly firmwareId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly declaredAt: number;
  readonly waves: ReadonlyArray<{ readonly waveId: string; readonly deviceIds: readonly string[] }>;
}

export function declareFirmwareCampaign(
  input: DeclareFirmwareCampaignInput,
): FirmwareCampaignResult<FirmwareCampaign> {
  if (!isFirmwareVersion(input.fromVersion) || !isFirmwareVersion(input.toVersion)) {
    return { ok: false, reason: "malformed-version" };
  }
  if (compareFirmwareVersions(input.toVersion, input.fromVersion) <= 0) {
    return { ok: false, reason: "version-regression" };
  }
  if (input.waves.length === 0) return { ok: false, reason: "empty-wave" };
  const waveIds = new Set<string>();
  const seenDevices = new Set<string>();
  for (const wave of input.waves) {
    if (wave.waveId === "" || waveIds.has(wave.waveId)) return { ok: false, reason: "duplicate-wave-id" };
    waveIds.add(wave.waveId);
    if (wave.deviceIds.length === 0) return { ok: false, reason: "empty-wave" };
    for (const deviceId of wave.deviceIds) {
      if (seenDevices.has(deviceId)) return { ok: false, reason: "device-in-two-waves" };
      seenDevices.add(deviceId);
    }
  }
  const campaign: FirmwareCampaign = {
    id: input.id,
    tenantId: input.tenantId,
    firmwareId: input.firmwareId,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    declaredAt: input.declaredAt,
    state: "draft",
    waves: input.waves
      .map((w) => ({ waveId: w.waveId, deviceIds: [...w.deviceIds].sort(), state: "pending" as FirmwareWaveState }))
      .sort((a, b) => (a.waveId < b.waveId ? -1 : 1)),
    outcomes: {},
    halt: null,
    haltFrom: null,
    rollback: null,
    events: [],
  };
  return { ok: true, campaign: withEvent(campaign, {
    at: input.declaredAt,
    actor: "system",
    kind: "campaign-declared",
    detail: `${input.firmwareId} ${input.fromVersion}->${input.toVersion} over ${input.waves.length} waves (${seenDevices.size} devices)`,
  }, {}) };
}

// ---------------------------------------------------------------------------
// Announce + staged wave execution.
// ---------------------------------------------------------------------------

export function announceFirmwareCampaign(
  campaign: FirmwareCampaign,
  input: { readonly tenantId: TenantIdLike; readonly at: number; readonly actor: string },
): FirmwareCampaignResult<FirmwareCampaign> {
  if (campaign.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
  if (campaign.state !== "draft") return { ok: false, reason: "illegal-transition" };
  return { ok: true, campaign: withEvent(campaign, {
    at: input.at,
    actor: input.actor,
    kind: "campaign-announced",
    detail: `firmware ${campaign.firmwareId} ${campaign.toVersion} announced`,
  }, { state: "announced" }) };
}

/** Start the NEXT wave (announced -> deploying). The previous wave (if any)
 * must already be verified — staged rollout, never two waves at once. */
export function startCampaignWave(
  campaign: FirmwareCampaign,
  input: { readonly tenantId: TenantIdLike; readonly waveId: string; readonly at: number; readonly actor: string },
): FirmwareCampaignResult<FirmwareCampaign> {
  if (campaign.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
  if (campaign.state !== "announced") {
    return { ok: false, reason: campaign.state === "halted" ? "campaign-halted" : "illegal-transition" };
  }
  const nextIndex = campaign.waves.findIndex((w) => w.state === "pending");
  if (nextIndex === -1) return { ok: false, reason: "illegal-transition" };
  const next = campaign.waves[nextIndex]!;
  if (next.waveId !== input.waveId) return { ok: false, reason: "wave-out-of-order" };
  const waves = campaign.waves.map((w, i) => (i === nextIndex ? { ...w, state: "deploying" as FirmwareWaveState } : w));
  return { ok: true, campaign: withEvent(campaign, {
    at: input.at,
    actor: input.actor,
    kind: "wave-started",
    waveId: next.waveId,
    detail: `wave ${next.waveId} deploying to ${next.deviceIds.length} devices`,
  }, { state: "deploying", waves }) };
}

/** Record one device's firmware outcome in the CURRENT deploying wave. The
 * wave auto-verifies when every cohort device reported; the last verified
 * wave completes the campaign. */
export function recordCampaignDeviceOutcome(
  campaign: FirmwareCampaign,
  input: {
    readonly tenantId: TenantIdLike;
    readonly deviceId: string;
    readonly ok: boolean;
    readonly at: number;
    readonly actor: string;
    readonly failureReason?: string;
  },
): FirmwareCampaignResult<FirmwareCampaign> {
  if (campaign.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
  if (campaign.state !== "deploying") {
    return { ok: false, reason: campaign.state === "halted" ? "campaign-halted" : "illegal-transition" };
  }
  const waveIndex = campaign.waves.findIndex((w) => w.state === "deploying");
  if (waveIndex === -1) return { ok: false, reason: "illegal-transition" };
  const wave = campaign.waves[waveIndex]!;
  if (!wave.deviceIds.includes(input.deviceId)) return { ok: false, reason: "device-not-in-current-wave" };
  if (campaign.outcomes[input.deviceId] !== undefined) return { ok: false, reason: "duplicate-device-outcome" };

  const outcomes: Record<string, FirmwareDeviceOutcome> = {
    ...campaign.outcomes,
    [input.deviceId]: input.ok
      ? { appliedAt: input.at, failedAt: null, failureReason: null, rolledBackAt: null }
      : { appliedAt: null, failedAt: input.at, failureReason: input.failureReason ?? "device-reported-failure", rolledBackAt: null },
  };
  let next = withEvent(campaign, {
    at: input.at,
    actor: input.actor,
    kind: "device-outcome",
    waveId: wave.waveId,
    deviceId: input.deviceId,
    detail: input.ok ? `applied ${campaign.toVersion}` : `failed: ${input.failureReason ?? "device-reported-failure"}`,
  }, { outcomes });
  const accounted = wave.deviceIds.every((d) => outcomes[d] !== undefined);
  if (!accounted) return { ok: true, campaign: next };

  // Wave fully accounted -> verified; campaign advances (or completes).
  const waves = next.waves.map((w, i) => (i === waveIndex ? { ...w, state: "verified" as FirmwareWaveState } : w));
  next = withEvent(next, {
    at: input.at,
    actor: input.actor,
    kind: "wave-verified",
    waveId: wave.waveId,
    detail: `wave ${wave.waveId} fully accounted`,
  }, { waves });
  const lastWave = waves.every((w) => w.state === "verified");
  if (lastWave) {
    next = withEvent(next, {
      at: input.at,
      actor: input.actor,
      kind: "campaign-completed",
      detail: `all ${waves.length} waves verified`,
    }, { state: "completed", waves });
  } else {
    next = { ...next, state: "announced", waves };
  }
  return { ok: true, campaign: next };
}

// ---------------------------------------------------------------------------
// Halt / resume / rollback.
// ---------------------------------------------------------------------------

export function haltFirmwareCampaign(
  campaign: FirmwareCampaign,
  input: { readonly tenantId: TenantIdLike; readonly reason?: string; readonly at: number; readonly actor: string },
): FirmwareCampaignResult<FirmwareCampaign> {
  if (campaign.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
  if (input.reason === undefined || input.reason === "") return { ok: false, reason: "halt-reason-required" };
  if (campaign.state !== "announced" && campaign.state !== "deploying") {
    return { ok: false, reason: "illegal-transition" };
  }
  return { ok: true, campaign: withEvent(campaign, {
    at: input.at,
    actor: input.actor,
    kind: "campaign-halted",
    detail: `halted: ${input.reason}`,
  }, { state: "halted", halt: { reason: input.reason, at: input.at }, haltFrom: campaign.state }) };
}

export function resumeFirmwareCampaign(
  campaign: FirmwareCampaign,
  input: { readonly tenantId: TenantIdLike; readonly at: number; readonly actor: string },
): FirmwareCampaignResult<FirmwareCampaign> {
  if (campaign.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
  if (campaign.state !== "halted") return { ok: false, reason: "illegal-transition" };
  const back = campaign.haltFrom ?? "announced";
  return { ok: true, campaign: withEvent(campaign, {
    at: input.at,
    actor: input.actor,
    kind: "campaign-resumed",
    detail: `resumed from ${campaign.halt?.reason ?? "halt"}`,
  }, { state: back }) };
}

/** Roll the campaign back — only after a halt, only over applied devices. */
export function rollbackFirmwareCampaign(
  campaign: FirmwareCampaign,
  input: { readonly tenantId: TenantIdLike; readonly reason?: string; readonly at: number; readonly actor: string },
): FirmwareCampaignResult<FirmwareCampaign> {
  if (campaign.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
  if (campaign.state !== "halted") return { ok: false, reason: "halt-first" };
  const applied = Object.entries(campaign.outcomes)
    .filter(([, o]) => o.appliedAt !== null)
    .map(([deviceId]) => deviceId)
    .sort();
  if (applied.length === 0) return { ok: false, reason: "no-applied-devices" };
  const reason = input.reason ?? `rollback of ${campaign.toVersion}`;
  return { ok: true, campaign: withEvent(campaign, {
    at: input.at,
    actor: input.actor,
    kind: "rollback-started",
    detail: `rolling ${applied.length} devices back to ${campaign.fromVersion}: ${reason}`,
  }, { state: "rolling-back", rollback: { reason, at: input.at } }) };
}

/** One applied device confirms its rollback to the from-version. The
 * campaign is terminally rolled-back once every applied device reported. */
export function recordCampaignDeviceRollback(
  campaign: FirmwareCampaign,
  input: { readonly tenantId: TenantIdLike; readonly deviceId: string; readonly at: number; readonly actor: string },
): FirmwareCampaignResult<FirmwareCampaign> {
  if (campaign.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
  if (campaign.state !== "rolling-back") return { ok: false, reason: "illegal-transition" };
  const outcome = campaign.outcomes[input.deviceId];
  if (outcome === undefined) return { ok: false, reason: "unknown-device-ref" };
  if (outcome.appliedAt === null) return { ok: false, reason: "device-not-in-current-wave" };
  if (outcome.rolledBackAt !== null) return { ok: false, reason: "duplicate-device-outcome" };
  const outcomes = {
    ...campaign.outcomes,
    [input.deviceId]: { ...outcome, rolledBackAt: input.at },
  };
  let next = withEvent(campaign, {
    at: input.at,
    actor: input.actor,
    kind: "device-rollback",
    deviceId: input.deviceId,
    detail: `rolled back to ${campaign.fromVersion}`,
  }, { outcomes });
  const applied = Object.keys(campaign.outcomes).filter((d) => campaign.outcomes[d]!.appliedAt !== null);
  if (applied.every((d) => outcomes[d]!.rolledBackAt !== null)) {
    next = withEvent(next, {
      at: input.at,
      actor: input.actor,
      kind: "campaign-rolled-back",
      detail: `all ${applied.length} applied devices rolled back`,
    }, { state: "rolled-back" });
  }
  return { ok: true, campaign: next };
}
