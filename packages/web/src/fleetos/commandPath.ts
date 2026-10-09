/**
 * FleetOS command path — UI intent → CommandDraft → REAL control-plane queue
 * (F301). The tower's TowerCommandBus binds the REAL `CommandQueue` through
 * `queueAsSubmitPort`; submissions are enqueued for Guardian adjudication —
 * never authorized by the UI. Every ack/refusal is recorded verbatim.
 */

import { makeTenantContext, type TenantContext } from "@fleetos/kernel";
import {
  TowerCommandBus,
  draftReasonOf,
  type TowerCommandDraft,
  type TowerSubmitResult,
} from "@fleetos/control-tower";
import { buildEnrollAssetIntent, buildRequestRecoveryIntent } from "@fleetos/experience-asset-field";
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
      this.record(String(ctx.actorId), "asset.enroll", false, `draft refused: ${draftR.reason}`, null, false, "-");
      return { ok: false, refused: "queue-rejected", detail: draftR.reason } as never;
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
      this.record(String(ctx.actorId), "recovery.request", false, `draft refused: ${draftR.reason}`, null, false, "-");
      return { ok: false, refused: "queue-rejected", detail: draftR.reason } as never;
    }
    return this.submitDraft(ctx, draftR.draft as TowerCommandDraft);
  }

  submitDraft(ctx: TenantContext, draft: TowerCommandDraft): TowerSubmitResult {
    const r = this.bus.submit({ ctx, draft });
    if (r.ok) {
      this.record(
        String(ctx.actorId),
        draft.kind,
        true,
        `enqueued for Guardian adjudication (capability REQUEST: ${r.ack.capabilityRequirement}; ceilings are not authorizations)`,
        r.ack.commandId,
        r.ack.duplicate,
        draft.idempotencyKey,
      );
    } else {
      this.record(String(ctx.actorId), draft.kind, false, `${r.refused}: ${r.detail}`, null, false, draft.idempotencyKey);
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
}
