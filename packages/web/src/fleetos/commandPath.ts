/**
 * FleetOS command path — UI intent → CommandDraft → REAL control-plane queue
 * (F301). The tower's TowerCommandBus binds the REAL `CommandQueue` through
 * `queueAsSubmitPort`; submissions are enqueued for Guardian adjudication —
 * never authorized by the UI. Every ack/refusal is recorded verbatim.
 */

import { makeTenantContext, type TenantContext } from "@fleetos/kernel";
import {
  TowerCommandBus,
  draftSubmitCommandOf,
  type TowerCommandDraft,
  type TowerSubmitResult,
} from "@fleetos/control-tower";
import { buildEnrollAssetIntent, buildRequestRecoveryIntent } from "@fleetos/experience-asset-field";
import { requestRemediation } from "@fleetos/experience-safety-intel";
import type { CommandRecord } from "@fleetos/control-plane";

export interface SubmissionRecord {
  readonly at: number;
  readonly kind: string;
  readonly actor: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly commandId: string | null;
  readonly duplicate: boolean;
  readonly idempotencyKey: string;
}

export class FleetCommandPath {
  readonly bus = new TowerCommandBus();
  private readonly submissions: SubmissionRecord[] = [];

  contextFor(tenantId: string, actorId: string): TenantContext {
    const r = makeTenantContext({
      tenantId,
      actorId,
      sessionId: "sess_fleetos-console",
      establishedAt: Date.now(),
    });
    if (!r.ok) throw new Error(`tenant context refused: ${r.reason}`);
    return r.context;
  }

  submissionsOf(): readonly SubmissionRecord[] {
    return this.subscriptions_();
  }
  private subscriptions_(): SubmissionRecord[] {
    return this.submissions;
  }

  queueRecords(ctx: TenantContext): readonly CommandRecord[] {
    return this.bus.queueOf().listByTenant(ctx);
  }

  /** Submit an enroll-asset intent from the UI (REAL pipeline). */
  submitEnrollAsset(
    ctx: TenantContext,
    input: { assetId: string; deviceId: string; serial: string; reason: string },
  ): TowerSubmitResult {
    const draftR = buildEnrollAssetIntent({
      tenantId: String(ctx.tenantId),
      actorId: String(ctx.actorId),
      assetId: input.assetId,
      deviceId: input.deviceId,
      serial: input.serial,
      issuedAt: Date.now(),
      reason: input.reason,
    });
    if (!draftR.ok) {
      this.record(String(ctx.actorId), "asset.enroll", false, `draft refused: ${draftR.detail}`, null, false, "-");
      return { ok: false, refused: "queue-rejected", detail: draftR.detail } as never;
    }
    return this.submitDraft(ctx, draftR.draft as TowerCommandDraft);
  }

  /** Submit a recovery-request intent from the UI (REAL pipeline). */
  submitRecoveryRequest(
    ctx: TenantContext,
    input: { deviceId: string; reason: string },
  ): TowerSubmitResult {
    const draftR = buildRequestRecoveryIntent({
      tenantId: String(ctx.tenantId),
      actorId: String(ctx.actorId),
      deviceId: input.deviceId,
      issuedAt: Date.now(),
      reason: input.reason,
    });
    if (!draftR.ok) {
      this.record(String(ctx.actorId), "recovery.request", false, `draft refused: ${draftR.detail}`, null, false, "-");
      return { ok: false, refused: "queue-rejected", detail: draftR.detail } as never;
    }
    return this.submitDraft(ctx, draftR.draft as TowerCommandDraft);
  }

  submitDraft(ctx: TenantContext, draft: TowerCommandDraft): TowerSubmitResult {
    // The three lane CommandDraft shapes are heterogeneous (lane C nests its
    // command); the registry's projection is the per-lane-safe extractor for
    // the control-plane submit contract fields the audit log records.
    const cmd = draftSubmitCommandOf(draft);
    const r = this.bus.submit({ ctx, draft });
    if (r.ok) {
      this.record(
        String(ctx.actorId),
        cmd.kind,
        true,
        `enqueued for Guardian adjudication (capability REQUEST: ${r.ack.capabilityRequirement}; ceilings are not authorizations)`,
        r.ack.commandId,
        r.ack.duplicate,
        cmd.idempotencyKey,
      );
    } else {
      this.record(String(ctx.actorId), cmd.kind, false, `${r.refused}: ${r.detail}`, null, false, cmd.idempotencyKey);
    }
    return r;
  }

  private record(
    actor: string,
    kind: string,
    ok: boolean,
    detail: string,
    commandId: string | null,
    duplicate: boolean,
    idempotencyKey: string,
  ): void {
    this.submissions.unshift({ at: Date.now(), kind, actor, ok, detail, commandId, duplicate, idempotencyKey });
    if (this.submissions.length > 50) this.submissions.length = 50;
  }

  /** Submit a security remediation request from the UI (REAL pipeline, lane B). */
  submitRemediationRequest(
    ctx: TenantContext,
    input: { proposalId: string; findingIds: string[]; remediationKind: string; reason: string },
  ): TowerSubmitResult {
    const draftR = requestRemediation({
      intentId: `intent-shell-${input.proposalId}`,
      tenantId: String(ctx.tenantId),
      actorId: String(ctx.actorId),
      requiredCapabilityId: "security.remediation.request",
      reason: input.reason,
      issuedAt: Date.now(),
      proposalId: input.proposalId,
      findingIds: input.findingIds,
      remediationKind: input.remediationKind,
    });
    if (!draftR.ok) {
      this.record(String(ctx.actorId), "security.remediation.request", false, `draft refused: ${draftR.refused}`, null, false, "-");
      return { ok: false, refused: "queue-rejected", detail: String(draftR.refused) } as never;
    }
    return this.submitDraft(ctx, draftR.draft as TowerCommandDraft);
  }
}
