/**
 * @fleetos/sim-worlds — the world step engine (F260A, deliverable 3b).
 *
 * Advances a fleet world N logical-time steps. Per step, in a fixed
 * deterministic order: link state transitions (uptime-bps draws), asset
 * failure transitions (failure-bps draws), maintenance window logic
 * (corrective on failure + MTBF preventive scheduling + skip faults),
 * device up/down transitions (dropout-bps draws), posture trajectory
 * transitions, then observation emission (jittered value streams shaped
 * like the observations lane's admission inputs).
 *
 * Determinism law: every random draw is ADDRESS-KEYED
 * (seed × step × domain × entity) via `src/determinism.ts` — never a
 * hidden counter — so a run resumed from a checkpoint is byte-identical
 * to the uninterrupted full run (journal + final state).
 *
 * Tenant fail-closed: `advanceWorldSteps` validates the world, the
 * scenario (worldId + tenant must match) and the state's own
 * world/tenant identity before stepping. Pure deterministic TS.
 */

import { bernoulliFromBps, fnv1a32, jitterInBounds } from "./determinism.js";
import { assetFailuresAt, linkForcedDownAt, maintenanceSkippedAt, scenarioAppliesTo, validateFaultScenario } from "./fault-injection.js";
import type { FaultScenario } from "./fault-injection.js";
import { applyWorldEvent, chainedWorldDigest } from "./world-journal.js";
import type { AssetRuntime, WorldEngineState, WorldEvent, WorldEventDraft } from "./world-journal.js";
import { genesisWorldState } from "./world-journal.js";
import { REPAIR_STEPS_BY_SERVICE_LEVEL, validateWorld } from "./world-definition.js";
import type {
  FleetWorld,
  HealthPosture,
  WorldMaintenancePolicy,
} from "./world-definition.js";

export * from "./world-journal.js";

export type WorldAdvanceRefusal =
  | "invalid-world"
  | "invalid-step-count"
  | "invalid-scenario"
  | "scenario-world-mismatch"
  | "scenario-tenant-mismatch"
  | "state-world-mismatch"
  | "state-tenant-mismatch";

export type WorldAdvanceResult =
  | { readonly ok: true; readonly state: WorldEngineState; readonly events: ReadonlyArray<WorldEvent> }
  | {
      readonly ok: false;
      readonly reason: WorldAdvanceRefusal;
      readonly issues?: ReadonlyArray<{ readonly code: string; readonly ref: string; readonly detail?: string }>;
    };

function drawAddr(seed: string, step: number, domain: string, entity: string, extra = ""): string {
  return `${seed}|step|${step}|${domain}|${entity}${extra ? `#${extra}` : ""}`;
}

function isWindowOpen(p: WorldMaintenancePolicy, step: number): boolean {
  return step > 0 && step % p.windowEverySteps < p.windowLengthSteps;
}

function nextWindowOpen(p: WorldMaintenancePolicy, step: number): number {
  const e = p.windowEverySteps;
  return e * (Math.floor(step / e) + 1);
}

function inService(a: AssetRuntime, step: number): boolean {
  return a.serviceStartedAt !== null && a.underServiceUntil !== null && step < a.underServiceUntil;
}

/** Advance a world N steps from `from`. Folds events as they are emitted. */
export function advanceWorldSteps(
  world: FleetWorld,
  from: WorldEngineState,
  steps: number,
  scenario?: FaultScenario,
): WorldAdvanceResult {
  const validation = validateWorld(world);
  if (!validation.ok) return { ok: false, reason: "invalid-world", issues: validation.issues };
  if (!Number.isInteger(steps) || steps < 0) return { ok: false, reason: "invalid-step-count" };
  if (scenario) {
    const gate = scenarioAppliesTo(scenario, world);
    if (!gate.ok) return { ok: false, reason: gate.reason };
    const sv = validateFaultScenario(scenario, world);
    if (!sv.ok) return { ok: false, reason: "invalid-scenario", issues: sv.issues };
  }
  if (from.worldId !== world.worldId) return { ok: false, reason: "state-world-mismatch" };
  if (from.tenantId !== world.tenantId) return { ok: false, reason: "state-tenant-mismatch" };

  const newEvents: WorldEvent[] = [];
  let s = from;
  const emit = (draft: WorldEventDraft): void => {
    const seq = s.seq + 1;
    const digest = chainedWorldDigest(s.lastDigest, draft, seq);
    const event = { ...draft, seq, digest } as WorldEvent;
    newEvents.push(event);
    s = applyWorldEvent(s, event);
  };
  const policyByAsset = new Map(world.maintenancePolicies.map((p) => [p.assetId, p] as const));
  const tenant = world.tenantId;

  for (let i = 0; i < steps; i++) {
    const step = s.step + 1;
    emit({ kind: "step-advanced", tenantId: tenant, step });

    // 1. links — uptime-bps draws, scenario outage windows override.
    for (const l of world.links) {
      const forcedDown = scenario ? linkForcedDownAt(scenario, l.linkId, step) : false;
      const draw = bernoulliFromBps(drawAddr(world.seed, step, "link", l.linkId), l.uptimeBps);
      const up = forcedDown ? false : draw.ok && draw.hit;
      const prev = s.links.get(l.linkId);
      if (!prev || prev.up === up) continue;
      emit({
        kind: up ? "link-up" : "link-down",
        tenantId: tenant,
        step,
        linkId: l.linkId,
        cause: forcedDown && !up ? "injected" : "rate",
      });
    }

    // 2. assets — failure-bps draws, scenario failures override.
    for (const a of world.assets) {
      const rt = s.assets.get(a.assetId);
      if (!rt || !rt.operational || inService(rt, step)) continue;
      const injected = scenario ? assetFailuresAt(scenario, step).some((f) => f.assetId === a.assetId) : false;
      const draw = bernoulliFromBps(drawAddr(world.seed, step, "fail", a.assetId), a.failureRateBps);
      if (!(injected || (draw.ok && draw.hit))) continue;
      emit({ kind: "asset-failed", tenantId: tenant, step, assetId: a.assetId, cause: injected ? "injected" : "rate" });
      const policy = policyByAsset.get(a.assetId);
      if (policy) {
        emit({
          kind: "maintenance-due",
          tenantId: tenant,
          step,
          assetId: a.assetId,
          policyId: policy.policyId,
          maintenanceKind: "corrective",
          scheduledForStep: isWindowOpen(policy, step) ? step : nextWindowOpen(policy, step),
        });
      }
    }

    // 3. maintenance — completions, MTBF preventive scheduling, windows.
    for (const p of world.maintenancePolicies) {
      let rt = s.assets.get(p.assetId);
      if (!rt) continue;
      if (rt.underServiceUntil === step) {
        emit({
          kind: "maintenance-completed",
          tenantId: tenant,
          step,
          assetId: p.assetId,
          policyId: p.policyId,
          maintenanceKind: rt.serviceKind ?? "corrective",
        });
        continue; // serviced this step — done for this policy
      }
      if (inService(rt, step)) continue;
      const windowOpen = isWindowOpen(p, step);
      if (rt.operational && !rt.pendingPreventive && step - (rt.lastServiceAt ?? 0) >= p.mtbfSteps) {
        emit({
          kind: "maintenance-due",
          tenantId: tenant,
          step,
          assetId: p.assetId,
          policyId: p.policyId,
          maintenanceKind: "preventive",
          scheduledForStep: windowOpen ? step : nextWindowOpen(p, step),
        });
        rt = s.assets.get(p.assetId) ?? rt;
      }
      if (!windowOpen) continue;
      const dueKind: "corrective" | "preventive" | null = rt.pendingCorrective
        ? "corrective"
        : rt.pendingPreventive
          ? "preventive"
          : null;
      if (dueKind === null) continue;
      if (scenario && maintenanceSkippedAt(scenario, p.assetId, step)) {
        emit({ kind: "maintenance-skipped", tenantId: tenant, step, assetId: p.assetId, policyId: p.policyId, maintenanceKind: dueKind });
        continue;
      }
      emit({
        kind: "maintenance-started",
        tenantId: tenant,
        step,
        assetId: p.assetId,
        policyId: p.policyId,
        maintenanceKind: dueKind,
        repairSteps: REPAIR_STEPS_BY_SERVICE_LEVEL[p.serviceLevel],
      });
    }

    // 4. devices — desired state from asset/service, transient dropout draws.
    for (const d of world.devices) {
      const a = s.assets.get(d.assetId);
      const prev = s.devices.get(d.deviceId);
      if (!a || !prev) continue;
      const servicing = inService(a, step);
      const desiredUp = a.operational && !servicing;
      if (desiredUp) {
        const draw = bernoulliFromBps(drawAddr(world.seed, step, "dropout", d.deviceId), d.dropoutBps);
        const dropped = draw.ok && draw.hit;
        if (dropped) {
          emit({ kind: "device-down", tenantId: tenant, step, deviceId: d.deviceId, cause: "dropout" });
        } else if (!prev.up) {
          emit({
            kind: "device-up",
            tenantId: tenant,
            step,
            deviceId: d.deviceId,
            cause: prev.downCause === "dropout" ? "dropout-recovered" : "service-completed",
          });
        }
      } else if (prev.up) {
        emit({
          kind: "device-down",
          tenantId: tenant,
          step,
          deviceId: d.deviceId,
          cause: servicing ? "service" : "asset-failure",
        });
      }
    }

    // 5. postures — trajectory evolution over the current runtime.
    for (const a of world.assets) {
      const rt = s.assets.get(a.assetId);
      if (!rt) continue;
      const eff = effectivePosture(world, s, rt, step);
      if (eff !== rt.posture) {
        emit({ kind: "posture-changed", tenantId: tenant, step, assetId: a.assetId, from: rt.posture, to: eff });
      }
    }

    // 6. observations — jittered value streams while the device is up.
    for (const d of world.devices) {
      const drt = s.devices.get(d.deviceId);
      if (!drt || !drt.up || step % d.emitEverySteps !== 0) continue;
      for (const stream of d.streams) {
        const observationSeq = drt.observationSeq + 1;
        const j = jitterInBounds(
          drawAddr(world.seed, step, "obs", d.deviceId, stream.kind),
          stream.baseValue,
          stream.jitterMinOffset,
          stream.jitterMaxOffset,
        );
        const value = j.ok ? j.value : stream.baseValue;
        const payloadDigest = fnv1a32([tenant, d.deviceId, observationSeq, stream.kind, value, step]);
        emit({
          kind: "observation-emitted",
          tenantId: tenant,
          step,
          deviceId: d.deviceId,
          observationSeq,
          streamKind: stream.kind,
          unit: stream.unit,
          value,
          observedAt: step * world.timeUnitMs,
          payloadDigest,
        });
      }
    }
  }
  return { ok: true, state: s, events: newEvents };
}

function effectivePosture(
  world: FleetWorld,
  s: WorldEngineState,
  rt: AssetRuntime,
  step: number,
): HealthPosture {
  if (inService(rt, step)) return "degraded";
  if (!rt.operational) {
    const failedSteps = step - (rt.failedAtStep ?? step);
    return failedSteps >= world.healthPolicy.downAfterSteps ? "down" : "critical";
  }
  if (rt.recoveredAtStep !== null && step - rt.recoveredAtStep <= world.healthPolicy.recoveryGraceSteps) {
    return "degraded";
  }
  for (const d of world.devices) {
    const drt = s.devices.get(d.deviceId);
    if (d.assetId === rt.assetId && drt && !drt.up && drt.downCause === "dropout") return "degraded";
  }
  return "healthy";
}

/** Fresh genesis + advance — the one-shot convenience run. */
export function runWorld(
  world: FleetWorld,
  steps: number,
  scenario?: FaultScenario,
): WorldAdvanceResult {
  return advanceWorldSteps(world, genesisWorldState(world), steps, scenario);
}
