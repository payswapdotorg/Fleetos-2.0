/**
 * @fleetos/sim-worlds — the world journal (F260A, deliverable 3a).
 *
 * The append-only event journal behind the world step engine
 * (`world-engine.ts`). Every emitted fact — step markers, link
 * transitions, asset failures, posture changes, device transitions,
 * observations, maintenance lifecycle — is a typed journal event; the
 * engine state is a PURE FOLD over the journal (same events =>
 * byte-identical state) with checkpoints to resume a fold from a
 * prefix. Events carry a strictly increasing `seq` and a CHAINED digest
 * (each digest covers the previous digest + the event's full identity —
 * tamper-evident). `verifyWorldJournal` replays ordering + the chain.
 *
 * Split out of world-engine.ts to respect the 400-line law.
 * Pure deterministic TS; logical `now` everywhere.
 */

import { fnv1a32 } from "./determinism.js";
import type { DigestPart } from "./determinism.js";
import { REPAIR_STEPS_BY_SERVICE_LEVEL } from "./world-definition.js";
import type { FleetWorld, HealthPosture } from "./world-definition.js";

// ---------------------------------------------------------------------------
// Journal events — append-only, one per emitted fact.
// ---------------------------------------------------------------------------

interface EventBase {
  readonly seq: number;
  readonly tenantId: string;
  readonly step: number;
  readonly digest: string;
}

export type WorldEvent =
  | { readonly kind: "step-advanced" } & EventBase
  | { readonly kind: "link-up" | "link-down"; readonly linkId: string; readonly cause: "rate" | "injected" } & EventBase
  | { readonly kind: "asset-failed"; readonly assetId: string; readonly cause: "rate" | "injected" } & EventBase
  | { readonly kind: "posture-changed"; readonly assetId: string; readonly from: HealthPosture; readonly to: HealthPosture } & EventBase
  | { readonly kind: "device-up"; readonly deviceId: string; readonly cause: "dropout-recovered" | "service-completed" } & EventBase
  | { readonly kind: "device-down"; readonly deviceId: string; readonly cause: "asset-failure" | "dropout" | "service" } & EventBase
  | {
      readonly kind: "observation-emitted";
      readonly deviceId: string;
      readonly observationSeq: number;
      readonly streamKind: string;
      readonly unit: string;
      readonly value: number;
      readonly observedAt: number;
      readonly payloadDigest: string;
    } & EventBase
  | { readonly kind: "maintenance-due"; readonly assetId: string; readonly policyId: string; readonly maintenanceKind: "corrective" | "preventive"; readonly scheduledForStep: number } & EventBase
  | { readonly kind: "maintenance-started"; readonly assetId: string; readonly policyId: string; readonly maintenanceKind: "corrective" | "preventive"; readonly repairSteps: number } & EventBase
  | { readonly kind: "maintenance-completed"; readonly assetId: string; readonly policyId: string; readonly maintenanceKind: "corrective" | "preventive" } & EventBase
  | { readonly kind: "maintenance-skipped"; readonly assetId: string; readonly policyId: string; readonly maintenanceKind: "corrective" | "preventive" } & EventBase;

export type WorldEventKind = WorldEvent["kind"];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type WorldEventDraft = DistributiveOmit<WorldEvent, "seq" | "digest">;

export const GENESIS_WORLD_DIGEST = "sim-worlds:world-journal:genesis";

/** Chained event digest: covers the previous digest + the full event identity. */
export function chainedWorldDigest(prev: string, draft: WorldEventDraft, seq: number): string {
  return fnv1a32([prev, seq, draft.tenantId, draft.step, eventParts(draft)]);
}

function eventParts(e: WorldEventDraft): DigestPart[] {
  switch (e.kind) {
    case "step-advanced":
      return [e.kind];
    case "link-up":
    case "link-down":
      return [e.kind, e.linkId, e.cause];
    case "asset-failed":
      return [e.kind, e.assetId, e.cause];
    case "posture-changed":
      return [e.kind, e.assetId, e.from, e.to];
    case "device-up":
    case "device-down":
      return [e.kind, e.deviceId, e.cause];
    case "observation-emitted":
      return [e.kind, e.deviceId, e.observationSeq, e.streamKind, e.unit, e.value, e.observedAt, e.payloadDigest];
    case "maintenance-due":
      return [e.kind, e.assetId, e.policyId, e.maintenanceKind, e.scheduledForStep];
    case "maintenance-started":
      return [e.kind, e.assetId, e.policyId, e.maintenanceKind, e.repairSteps];
    case "maintenance-completed":
    case "maintenance-skipped":
      return [e.kind, e.assetId, e.policyId, e.maintenanceKind];
  }
}

// ---------------------------------------------------------------------------
// Runtime state — every field is written by some event (pure-fold law).
// ---------------------------------------------------------------------------

export interface AssetRuntime {
  readonly assetId: string;
  readonly operational: boolean;
  readonly failedAtStep: number | null;
  readonly recoveredAtStep: number | null;
  readonly posture: HealthPosture;
  readonly postureSince: number;
  readonly pendingCorrective: boolean;
  readonly pendingPreventive: boolean;
  readonly serviceStartedAt: number | null;
  readonly underServiceUntil: number | null;
  readonly serviceKind: "corrective" | "preventive" | null;
  readonly lastServiceAt: number | null;
}

export interface DeviceRuntime {
  readonly deviceId: string;
  readonly assetId: string;
  readonly up: boolean;
  readonly downCause: "asset-failure" | "dropout" | "service" | null;
  readonly observationSeq: number;
}

export interface LinkRuntime {
  readonly linkId: string;
  readonly up: boolean;
}

export interface WorldEngineState {
  readonly worldId: string;
  readonly tenantId: string;
  readonly step: number;
  readonly events: ReadonlyArray<WorldEvent>;
  readonly assets: ReadonlyMap<string, AssetRuntime>;
  readonly devices: ReadonlyMap<string, DeviceRuntime>;
  readonly links: ReadonlyMap<string, LinkRuntime>;
  readonly seq: number;
  readonly lastDigest: string;
}

export function genesisWorldState(world: FleetWorld): WorldEngineState {
  const assets = new Map<string, AssetRuntime>();
  for (const h of world.initialHealthPostures) {
    const failed = h.posture === "critical" || h.posture === "down";
    assets.set(h.assetId, {
      assetId: h.assetId,
      operational: !failed,
      failedAtStep: failed ? 0 : null,
      recoveredAtStep: null,
      posture: h.posture,
      postureSince: 0,
      pendingCorrective: false,
      pendingPreventive: false,
      serviceStartedAt: null,
      underServiceUntil: null,
      serviceKind: null,
      lastServiceAt: null,
    });
  }
  const devices = new Map<string, DeviceRuntime>();
  for (const d of world.devices) {
    devices.set(d.deviceId, {
      deviceId: d.deviceId,
      assetId: d.assetId,
      up: assets.get(d.assetId)?.operational === true,
      downCause: null,
      observationSeq: 0,
    });
  }
  const links = new Map<string, LinkRuntime>();
  for (const l of world.links) links.set(l.linkId, { linkId: l.linkId, up: true });
  return {
    worldId: world.worldId,
    tenantId: world.tenantId,
    step: 0,
    events: [],
    assets,
    devices,
    links,
    seq: 0,
    lastDigest: GENESIS_WORLD_DIGEST,
  };
}

// ---------------------------------------------------------------------------
// The pure fold.
// ---------------------------------------------------------------------------

export function applyWorldEvent(state: WorldEngineState, event: WorldEvent): WorldEngineState {
  if (event.seq !== state.seq + 1) return state; // append-only: out-of-order ignored
  if (event.kind === "step-advanced") {
    return { ...state, events: [...state.events, event], step: event.step, seq: event.seq, lastDigest: event.digest };
  }
  const assets = new Map(state.assets);
  const devices = new Map(state.devices);
  const links = new Map(state.links);
  const a = "assetId" in event ? assets.get(event.assetId) : undefined;
  const d = "deviceId" in event ? devices.get(event.deviceId) : undefined;

  switch (event.kind) {
    case "link-up":
    case "link-down":
      links.set(event.linkId, { linkId: event.linkId, up: event.kind === "link-up" });
      break;
    case "asset-failed":
      if (a) assets.set(event.assetId, {
        ...a,
        operational: false,
        failedAtStep: event.step,
        recoveredAtStep: null,
        pendingCorrective: true,
      });
      break;
    case "posture-changed":
      if (a) assets.set(event.assetId, { ...a, posture: event.to, postureSince: event.step });
      break;
    case "device-up":
    case "device-down":
      if (d) devices.set(event.deviceId, {
        ...d,
        up: event.kind === "device-up",
        downCause: event.kind === "device-down" ? event.cause : null,
      });
      break;
    case "observation-emitted":
      if (d) devices.set(event.deviceId, { ...d, observationSeq: event.observationSeq });
      break;
    case "maintenance-due":
      if (a && event.maintenanceKind === "preventive") {
        assets.set(event.assetId, { ...a, pendingPreventive: true });
      }
      break;
    case "maintenance-started":
      if (a) assets.set(event.assetId, {
        ...a,
        pendingCorrective: false,
        pendingPreventive: false,
        serviceStartedAt: event.step,
        underServiceUntil: event.step + event.repairSteps,
        serviceKind: event.maintenanceKind,
        operational: false,
      });
      break;
    case "maintenance-completed":
      if (a) assets.set(event.assetId, {
        ...a,
        operational: true,
        recoveredAtStep: event.step,
        lastServiceAt: event.step,
        serviceStartedAt: null,
        underServiceUntil: null,
        serviceKind: null,
      });
      break;
    case "maintenance-skipped":
      break; // audit-only: pending flags intentionally remain for the next window
    default:
      break;
  }
  return { ...state, events: [...state.events, event], assets, devices, links, seq: event.seq, lastDigest: event.digest };
}

export function foldWorldEvents(
  world: FleetWorld,
  events: ReadonlyArray<WorldEvent>,
): WorldEngineState {
  let state = genesisWorldState(world);
  for (const e of events) state = applyWorldEvent(state, e);
  return state;
}

// ---------------------------------------------------------------------------
// Checkpoint — fold a prefix, resume with the suffix without replaying.
// ---------------------------------------------------------------------------

export interface WorldRunCheckpoint {
  readonly foldedSeq: number;
  readonly state: WorldEngineState;
}

export function checkpointWorldRun(state: WorldEngineState): WorldRunCheckpoint {
  return { foldedSeq: state.seq, state };
}

export function resumeWorldRun(
  checkpoint: WorldRunCheckpoint,
  events: ReadonlyArray<WorldEvent>,
): WorldEngineState {
  if (events.length === 0) return checkpoint.state;
  let state = checkpoint.state;
  for (const e of events) {
    if (e.seq > checkpoint.foldedSeq) state = applyWorldEvent(state, e);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Journal verification — ordering + step discipline + the digest chain.
// ---------------------------------------------------------------------------

export type WorldJournalFailureReason =
  | "seq-out-of-order"
  | "step-regression"
  | "unknown-target"
  | "digest-chain-broken";

export interface WorldJournalFailure {
  readonly seq: number;
  readonly reason: WorldJournalFailureReason;
}

export type WorldJournalVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly failures: ReadonlyArray<WorldJournalFailure> };

export function verifyWorldJournal(
  world: FleetWorld,
  events: ReadonlyArray<WorldEvent>,
): WorldJournalVerification {
  const assetIds = new Set(world.assets.map((a) => a.assetId));
  const deviceIds = new Set(world.devices.map((d) => d.deviceId));
  const linkIds = new Set(world.links.map((l) => l.linkId));
  const failures: WorldJournalFailure[] = [];
  let expectedSeq = 1;
  let step = 0;
  let prevDigest = GENESIS_WORLD_DIGEST;

  for (const e of events) {
    if (e.seq !== expectedSeq) {
      failures.push({ seq: e.seq, reason: "seq-out-of-order" });
      return { ok: false, failures };
    }
    if (e.tenantId !== world.tenantId) {
      failures.push({ seq: e.seq, reason: "unknown-target" });
      return { ok: false, failures };
    }
    if (e.kind === "step-advanced") {
      if (e.step !== step + 1) {
        failures.push({ seq: e.seq, reason: "step-regression" });
        return { ok: false, failures };
      }
      step = e.step;
    } else if (e.step !== step) {
      failures.push({ seq: e.seq, reason: "step-regression" });
      return { ok: false, failures };
    }
    const targetKnown =
      ("linkId" in e ? linkIds.has(e.linkId) : true) &&
      ("deviceId" in e ? deviceIds.has(e.deviceId) : true) &&
      ("assetId" in e ? assetIds.has(e.assetId) : true) &&
      ("policyId" in e ? world.maintenancePolicies.some((p) => p.policyId === e.policyId) : true);
    if (!targetKnown) {
      failures.push({ seq: e.seq, reason: "unknown-target" });
      return { ok: false, failures };
    }
    if (e.digest !== chainedWorldDigest(prevDigest, e, e.seq)) {
      failures.push({ seq: e.seq, reason: "digest-chain-broken" });
      return { ok: false, failures };
    }
    prevDigest = e.digest;
    expectedSeq += 1;
  }
  return { ok: true };
}

/** Steps-to-repair by service level (engine emits it into events). */
export function repairStepsFor(level: "basic" | "standard" | "expedited"): number {
  return REPAIR_STEPS_BY_SERVICE_LEVEL[level];
}
