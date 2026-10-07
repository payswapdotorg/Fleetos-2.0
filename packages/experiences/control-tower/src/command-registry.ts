/**
 * @fleetos/control-tower — the universal command registry + submission bus
 * (F241 deliverable 2).
 *
 * A typed registry over the three lanes' CommandDraft shapes: every lane
 * intent kind contributes an entry carrying its capability requirement and
 * the tower's reason vocabulary. Submission binds the REAL control-plane
 * `CommandQueue` through the established `queueAsSubmitPort` /
 * `CommandSubmitPort` seam (F221 evidence; F231 precedent) — tower commands
 * flow through the SAME bus, with the same idempotency law, exactly as
 * mission work orders do. The tower deliberately exposes the underlying
 * queue so a composition can share ONE bus between missions and the tower.
 *
 * GUARDIAN LAW (AGENTS.md: "Agents and workflows cannot bypass Guardian"):
 * a registry entry is a CEILING, never an authorization — every entry and
 * every ack carries the machine-carried
 * `capability-ceiling-not-authorization` marker. Submission ENQUEUES a
 * command for adjudication; it never authorizes execution.
 *
 * Reason vocabulary: the tower narrows free-form reasons to a per-command
 * vocabulary (a tower-level presentation policy, refusal
 * `reason-not-in-vocabulary`). The lanes' own builders accept any non-empty
 * reason; the tower's narrowing is documented for TL adjudication.
 *
 * Determinism: no clock, no randomness — idempotency keys arrive from the
 * lanes' deterministic builders; `now` for the queue is the draft's own
 * `issuedAt` (the queueAsSubmitPort convention).
 */

import {
  CommandQueue,
  queueAsSubmitPort,
  type CommandRecord,
  type CommandSubmitRejection,
  type CommandSubmitPortShape,
  type Result,
  type SubmitCommandInput,
  type SubmitPortAck,
} from "@fleetos/control-plane";
import type { TenantContext } from "@fleetos/kernel";
import type { CommandDraft as AssetFieldCommandDraft } from "@fleetos/experience-asset-field";
import type { CommandDraft as SafetyIntelCommandDraft } from "@fleetos/experience-safety-intel";
import type { CommandDraft as WorkCommerceCommandDraft } from "@fleetos/experience-work-commerce";
import { CEILING_NOT_AUTHORIZATION, type TowerLane } from "./tower-core.js";

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** A lane CommandDraft, any of the three Wave-4 shapes. */
export type TowerCommandDraft =
  | AssetFieldCommandDraft
  | SafetyIntelCommandDraft
  | WorkCommerceCommandDraft;

export interface TowerCommandEntry {
  /** Registry id: `tower.cmd.<lane>.<slug>`. */
  readonly id: string;
  readonly lane: TowerLane;
  /** The command kind the lane's builder emits. */
  readonly kind: string;
  /** Fixed lane capability (lanes A/C); null when the DRAFT declares it (lane B). */
  readonly capabilityRequirement: string | null;
  readonly capabilitySource: "lane-fixed" | "draft-declared";
  /** The tower's accepted reason vocabulary for this command. */
  readonly reasonVocabulary: readonly string[];
  /** Machine-carried Guardian-law marker: ceilings are not authorizations. */
  readonly ceiling: typeof CEILING_NOT_AUTHORIZATION;
}

function entry(
  id: string,
  lane: TowerLane,
  kind: string,
  capabilityRequirement: string | null,
  reasonVocabulary: readonly string[],
): TowerCommandEntry {
  return {
    id,
    lane,
    kind,
    capabilityRequirement,
    capabilitySource: capabilityRequirement === null ? "draft-declared" : "lane-fixed",
    reasonVocabulary,
    ceiling: CEILING_NOT_AUTHORIZATION,
  };
}

/** The universal command surface: 3 lane-A + 3 lane-B + 4 lane-C kinds. */
export const TOWER_COMMAND_REGISTRY: readonly TowerCommandEntry[] = Object.freeze([
  entry("tower.cmd.asset-field.asset-enroll", "asset-field", "asset.enroll", "assets.enroll", [
    "onboarding",
    "replacement",
    "fleet-expansion",
  ]),
  entry("tower.cmd.asset-field.recovery-request", "asset-field", "recovery.request", "recovery.request", [
    "incident-response",
    "operator-request",
  ]),
  entry("tower.cmd.asset-field.maintenance-schedule", "asset-field", "maintenance.schedule", "maintenance.schedule", [
    "preventive-care",
    "corrective-repair",
  ]),
  entry("tower.cmd.safety-intel.remediation-request", "safety-intel", "security.remediation.request", null, [
    "risk-reduction",
    "policy-remediation",
  ]),
  entry("tower.cmd.safety-intel.plan-step-propose", "safety-intel", "actions.plan-step.propose", null, [
    "plan-execution",
    "operator-request",
  ]),
  entry("tower.cmd.safety-intel.advisory-refresh", "safety-intel", "predictive.advisory.refresh-request", null, [
    "forecast-refresh",
    "operator-request",
  ]),
  entry("tower.cmd.work-commerce.create-work-order", "work-commerce", "work.create-work-order", "work.order.create", [
    "task-creation",
    "mission-followup",
  ]),
  entry("tower.cmd.work-commerce.approve-quote", "work-commerce", "procurement.approve-quote", "procurement.quote.approve", [
    "vendor-selection",
    "cost-approval",
  ]),
  entry("tower.cmd.work-commerce.place-order", "work-commerce", "procurement.place-order", "procurement.order.place", [
    "procurement-fulfillment",
    "cost-approval",
  ]),
  entry("tower.cmd.work-commerce.allocate-budget", "work-commerce", "org.allocate-budget", "org.budget.allocate", [
    "budget-planning",
    "capacity-adjustment",
  ]),
]);

/** List registry entries, optionally filtered by lane. Deterministic order. */
export function listTowerCommands(lane?: TowerLane): readonly TowerCommandEntry[] {
  return lane === undefined
    ? TOWER_COMMAND_REGISTRY
    : TOWER_COMMAND_REGISTRY.filter((candidate) => candidate.lane === lane);
}

/** Find the registry entry for a command kind (null when unknown). */
export function findTowerCommandByKind(kind: string): TowerCommandEntry | null {
  return TOWER_COMMAND_REGISTRY.find((candidate) => candidate.kind === kind) ?? null;
}

// ---------------------------------------------------------------------------
// Draft projections — per-lane shape extraction onto the real contract
// ---------------------------------------------------------------------------

function isAssetFieldDraft(draft: TowerCommandDraft): draft is AssetFieldCommandDraft {
  return "intentDigest" in draft && "capabilityRequirement" in draft;
}

function isSafetyIntelDraft(draft: TowerCommandDraft): draft is SafetyIntelCommandDraft {
  return "intent" in draft;
}

function isWorkCommerceDraft(draft: TowerCommandDraft): draft is WorkCommerceCommandDraft {
  return "recordType" in draft && draft.recordType === "command-draft";
}

/** The tenant a draft is scoped to (all three lane shapes carry one). */
export function draftTenantOf(draft: TowerCommandDraft): string {
  if (isAssetFieldDraft(draft)) return draft.tenantId;
  if (isSafetyIntelDraft(draft)) return draft.intent.tenantId;
  if (isWorkCommerceDraft(draft)) return draft.tenantId;
  return "";
}

/** The mandatory audit reason a draft carries. */
export function draftReasonOf(draft: TowerCommandDraft): string {
  if (isAssetFieldDraft(draft)) return draft.reason;
  if (isSafetyIntelDraft(draft)) return draft.intent.reason;
  if (isWorkCommerceDraft(draft)) return draft.reason;
  return "";
}

/** The capability a draft requests (a REQUEST, never an authorization). */
export function draftCapabilityOf(draft: TowerCommandDraft): string {
  if (isAssetFieldDraft(draft)) return draft.capabilityRequirement;
  if (isSafetyIntelDraft(draft)) return draft.intent.requiredCapabilityId;
  if (isWorkCommerceDraft(draft)) return draft.requiredCapability;
  return "";
}

/** Project any lane draft onto the control-plane `SubmitCommandInput`. */
export function draftSubmitCommandOf(draft: TowerCommandDraft): SubmitCommandInput {
  if (isWorkCommerceDraft(draft)) {
    return draft.command;
  }
  const base = {
    kind: draft.kind,
    payload: draft.payload,
    idempotencyKey: draft.idempotencyKey,
    issuedAt: draft.issuedAt,
  };
  const notBefore = draft.notBefore;
  return notBefore === undefined ? base : { ...base, notBefore };
}

// ---------------------------------------------------------------------------
// The submission bus — the REAL control-plane queue behind the seam
// ---------------------------------------------------------------------------

export type TowerSubmitRefusal =
  | "tenant-mismatch"
  | "unknown-command-kind"
  | "capability-mismatch"
  | "missing-capability"
  | "empty-reason"
  | "reason-not-in-vocabulary"
  | "queue-rejected";

export interface TowerSubmitAck {
  readonly commandId: string;
  readonly duplicate: boolean;
  readonly entry: TowerCommandEntry;
  /** The effective capability REQUEST carried by the submitted command. */
  readonly capabilityRequirement: string;
  readonly ceiling: typeof CEILING_NOT_AUTHORIZATION;
}

export type TowerSubmitResult =
  | { readonly ok: true; readonly ack: TowerSubmitAck }
  | { readonly ok: false; readonly refused: TowerSubmitRefusal; readonly detail: string };

/**
 * The tower's submission path: a REAL `CommandQueue` bound behind the
 * `queueAsSubmitPort` seam. Tower commands and mission work orders can
 * share ONE bus instance (`queueOf()`).
 */
export class TowerCommandBus {
  private readonly queue: CommandQueue;
  private readonly port: CommandSubmitPortShape;

  constructor(input?: { readonly queue?: CommandQueue }) {
    this.queue = input?.queue ?? new CommandQueue();
    this.port = queueAsSubmitPort(this.queue);
  }

  /** The REAL control-plane queue (share it with the mission runtime). */
  queueOf(): CommandQueue {
    return this.queue;
  }

  /** The queue bound behind the mission CommandSubmitPort TYPE seam. */
  submitPortOf(): CommandSubmitPortShape {
    return this.port;
  }

  /**
   * Submit a lane draft through the real bus. Validates the tower-level
   * contract (tenant scope, registry kind, capability, reason vocabulary),
   * then enqueues for Guardian adjudication — never authorizes.
   */
  submit(input: {
    readonly ctx: TenantContext;
    readonly draft: TowerCommandDraft;
  }): TowerSubmitResult {
    const { ctx, draft } = input;
    const command = draftSubmitCommandOf(draft);
    const draftTenant = draftTenantOf(draft);
    if (draftTenant !== String(ctx.tenantId)) {
      return {
        ok: false,
        refused: "tenant-mismatch",
        detail: `draft tenant ${draftTenant} does not match submission context ${String(ctx.tenantId)}`,
      };
    }
    const entryForKind = findTowerCommandByKind(command.kind);
    if (entryForKind === null) {
      return { ok: false, refused: "unknown-command-kind", detail: `kind ${command.kind} is not registered` };
    }
    const capability = draftCapabilityOf(draft);
    if (entryForKind.capabilitySource === "lane-fixed") {
      if (capability !== entryForKind.capabilityRequirement) {
        return {
          ok: false,
          refused: "capability-mismatch",
          detail: `draft capability ${capability} does not match the lane-fixed ${entryForKind.capabilityRequirement}`,
        };
      }
    } else if (capability === "") {
      return { ok: false, refused: "missing-capability", detail: "draft-declared capability is empty" };
    }
    const reason = draftReasonOf(draft);
    if (reason === "") {
      return { ok: false, refused: "empty-reason", detail: "draft reason is required for the audit trail" };
    }
    if (!entryForKind.reasonVocabulary.includes(reason)) {
      return {
        ok: false,
        refused: "reason-not-in-vocabulary",
        detail: `reason '${reason}' is not in the vocabulary for ${entryForKind.id}`,
      };
    }
    const submitted: Result<SubmitPortAck, CommandSubmitRejection> = this.port.submit({
      ctx,
      command,
    });
    if (!submitted.ok) {
      return { ok: false, refused: "queue-rejected", detail: submitted.reason };
    }
    return {
      ok: true,
      ack: {
        commandId: submitted.value.commandId,
        duplicate: submitted.value.duplicate,
        entry: entryForKind,
        capabilityRequirement: capability,
        ceiling: CEILING_NOT_AUTHORIZATION,
      },
    };
  }

  /** Dead-lettered commands visible at the tower level (id-sorted). */
  deadLetters(ctx: TenantContext): readonly CommandRecord[] {
    return this.queue
      .listByTenant(ctx)
      .filter((record) => record.state === "dead-lettered")
      .sort((a, b) => (a.envelope.id < b.envelope.id ? -1 : 1));
  }

  /** Command status at the tower level (tenant fail-closed by the queue). */
  commandStatus(
    ctx: TenantContext,
    commandId: string,
  ): { readonly ok: true; readonly record: CommandRecord } | { readonly ok: false; readonly detail: string } {
    const found = this.queue.findById(ctx, commandId);
    return found.ok ? { ok: true, record: found.value } : { ok: false, detail: found.reason };
  }
}

