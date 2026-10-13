/**
 * FleetOS shell — the command-path port (F351A).
 *
 * The seam the Command Console consumes. TWO implementations, ONE contract:
 *
 *  - "in-process" — the F301 composition: FleetCommandPath binds the REAL
 *    TowerCommandBus/CommandQueue in browser memory. UNCHANGED behavior,
 *    Promise-wrapped only, so the page has a single code path.
 *  - "durable"    — durable.ts: the same port contracts (submit port,
 *    queue-records read, audit read) backed by the :3106 service.
 *
 * The mode is chosen by the `?mode=durable` query param; the default is
 * in-process (the acceptance-suite composition is untouched — Q5).
 */

import type { TenantContext } from "@fleetos/kernel";
import type { CommandRecord } from "@fleetos/control-plane";
import type { TowerSubmitResult } from "@fleetos/control-tower";
import { FleetCommandPath, type SubmissionRecord } from "./commandPath.js";

export type CommandPathMode = "in-process" | "durable";

/** A tower ack/refusal, or the durable plane's honest transport failure —
 *  a service that cannot be reached is NEVER reported as a tower refusal. */
export type SubmitOutcome =
  | TowerSubmitResult
  | { readonly ok: false; readonly refused: "service-unreachable"; readonly detail: string };

export interface FleetCommandPort {
  readonly mode: CommandPathMode;
  contextFor(tenantId: string, actorId: string): TenantContext;
  submitEnrollAsset(
    ctx: TenantContext,
    input: { assetId: string; deviceId: string; serial: string; reason: string },
  ): Promise<SubmitOutcome>;
  submitRecoveryRequest(
    ctx: TenantContext,
    input: { deviceId: string; reason: string },
  ): Promise<SubmitOutcome>;
  submitRemediationRequest(
    ctx: TenantContext,
    input: { proposalId: string; findingIds: string[]; remediationKind: string; reason: string },
  ): Promise<SubmitOutcome>;
  queueRecords(ctx: TenantContext): Promise<readonly CommandRecord[]>;
  submissionsOf(): Promise<readonly SubmissionRecord[]>;
}

/** The in-process adapter — the F301 composition, Promise-wrapped (the page
 *  consumes one async code path; the semantics are the in-process ones). */
export class InProcessCommandPath implements FleetCommandPort {
  readonly mode = "in-process" as const;
  private readonly inner: FleetCommandPath;

  constructor(inner: FleetCommandPath) {
    this.inner = inner;
  }

  contextFor(tenantId: string, actorId: string): TenantContext {
    return this.inner.contextFor(tenantId, actorId);
  }

  async submitEnrollAsset(
    ctx: TenantContext,
    input: { assetId: string; deviceId: string; serial: string; reason: string },
  ): Promise<SubmitOutcome> {
    return this.inner.submitEnrollAsset(ctx, input);
  }

  async submitRecoveryRequest(
    ctx: TenantContext,
    input: { deviceId: string; reason: string },
  ): Promise<SubmitOutcome> {
    return this.inner.submitRecoveryRequest(ctx, input);
  }

  async submitRemediationRequest(
    ctx: TenantContext,
    input: { proposalId: string; findingIds: string[]; remediationKind: string; reason: string },
  ): Promise<SubmitOutcome> {
    return this.inner.submitRemediationRequest(ctx, input);
  }

  async queueRecords(ctx: TenantContext): Promise<readonly CommandRecord[]> {
    return this.inner.queueRecords(ctx);
  }

  async submissionsOf(): Promise<readonly SubmissionRecord[]> {
    return this.inner.submissionsOf();
  }
}

export function durableModeActive(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("mode") === "durable";
}
