/**
 * FleetOS shell — the durable-mode command path (F351A).
 *
 * The fetch-backed implementation of the SAME port contracts the in-process
 * composition uses (commandPath.ts): the submit port (build the REAL lane
 * draft in-browser — the identical code path — then POST it to the :3106
 * service and receive the ack/refusal), the queue-records read and the audit
 * read (GET per tenant), plus the durable-plane surfaces the service owns
 * (device enrollments, per-tenant record digests, service health).
 *
 * The fixture WORLD stays the domain-input convention (Q4) — observations and
 * sim-worlds remain composed in-browser exactly as before. Only the
 * OPERATIONAL plane (commands, audit, enrollments) moves to the service.
 *
 * Honesty at the seams: a service that cannot be reached is reported as
 * `service-unreachable` (never a fake refusal, never silent); a draft the
 * lane builder refuses locally is returned exactly as the in-process path
 * returns it (the service is never asked, so nothing is durably recorded).
 */

import { makeTenantContext, type TenantContext } from "@fleetos/kernel";
import type { CommandRecord } from "@fleetos/control-plane";
import {
  buildEnrollAssetIntent,
  buildRequestRecoveryIntent,
} from "@fleetos/experience-asset-field";
import { requestRemediation } from "@fleetos/experience-safety-intel";
import type { EnrollmentRecord } from "@fleetos/assets";
import type { SubmissionRecord } from "./commandPath.js";
import type { FleetCommandPort, SubmitOutcome } from "./port.js";

export type DurableSubmitOutcome = SubmitOutcome;

export interface DurableDigests {
  readonly commands: string;
  readonly audit: string;
  readonly assets: string;
  readonly total: string;
}

export interface DurableState {
  readonly ok: boolean;
  readonly mode: "durable";
  readonly tenantId: string;
  readonly commands: readonly CommandRecord[];
  readonly submissions: readonly SubmissionRecord[];
  readonly enrollments: readonly EnrollmentRecord[];
  readonly digests: DurableDigests;
  readonly counts: { readonly commands: number; readonly submissions: number; readonly enrollments: number };
}

export interface DurableHealth {
  readonly ok: boolean;
  readonly service: string;
  readonly port: number;
  readonly commit: string;
  readonly startedAt: string;
  readonly replay: { readonly commands: number; readonly audit: number; readonly assets: number; readonly replayMs: number };
}

export type DurableEnrollmentOutcome =
  | { readonly ok: true; readonly enrollment: EnrollmentRecord; readonly audit: { readonly actor: string; readonly intent: string; readonly tenant: string; readonly timestamp: number; readonly digest: string } }
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: false; readonly refused: "service-unreachable"; readonly detail: string };

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await r.json()) as T;
}

export class DurableCommandPath implements FleetCommandPort {
  readonly mode = "durable" as const;

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

  /** POST the built draft; classify a network failure honestly. */
  private async submit(ctx: TenantContext, draft: unknown): Promise<DurableSubmitOutcome> {
    try {
      return await postJson<DurableSubmitOutcome>("/api/commands", {
        tenantId: String(ctx.tenantId),
        actorId: String(ctx.actorId),
        draft,
      });
    } catch (error) {
      return { ok: false, refused: "service-unreachable", detail: String(error) };
    }
  }

  async submitEnrollAsset(
    ctx: TenantContext,
    input: { assetId: string; deviceId: string; serial: string; reason: string },
  ): Promise<DurableSubmitOutcome> {
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
      return { ok: false, refused: "queue-rejected", detail: draftR.detail };
    }
    return this.submit(ctx, draftR.draft);
  }

  async submitRecoveryRequest(
    ctx: TenantContext,
    input: { deviceId: string; reason: string },
  ): Promise<DurableSubmitOutcome> {
    const draftR = buildRequestRecoveryIntent({
      tenantId: String(ctx.tenantId),
      actorId: String(ctx.actorId),
      deviceId: input.deviceId,
      issuedAt: Date.now(),
      reason: input.reason,
    });
    if (!draftR.ok) {
      return { ok: false, refused: "queue-rejected", detail: draftR.detail };
    }
    return this.submit(ctx, draftR.draft);
  }

  async submitRemediationRequest(
    ctx: TenantContext,
    input: { proposalId: string; findingIds: string[]; remediationKind: string; reason: string },
  ): Promise<DurableSubmitOutcome> {
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
      return { ok: false, refused: "queue-rejected", detail: String(draftR.refused) };
    }
    return this.submit(ctx, draftR.draft);
  }

  /** Tenant-scoped durable state read (queue + audit + enrollments + digests). */
  async stateOf(ctx: TenantContext): Promise<DurableState | null> {
    try {
      const q = `?tenantId=${encodeURIComponent(String(ctx.tenantId))}&actorId=${encodeURIComponent(String(ctx.actorId))}`;
      const r = await fetch(`/api/state${q}`);
      if (!r.ok) return null;
      return (await r.json()) as DurableState;
    } catch {
      return null;
    }
  }

  async healthOf(): Promise<DurableHealth | null> {
    try {
      const r = await fetch("/api/health");
      if (!r.ok) return null;
      return (await r.json()) as DurableHealth;
    } catch {
      return null;
    }
  }

  async enrollDevice(ctx: TenantContext, deviceId: string): Promise<DurableEnrollmentOutcome> {
    try {
      return await postJson<DurableEnrollmentOutcome>("/api/enrollments", {
        tenantId: String(ctx.tenantId),
        actorId: String(ctx.actorId),
        deviceId,
      });
    } catch (error) {
      return { ok: false, refused: "service-unreachable", detail: String(error) };
    }
  }

  async queueRecords(ctx: TenantContext): Promise<readonly CommandRecord[]> {
    const s = await this.stateOf(ctx);
    return s === null ? [] : s.commands;
  }

  async submissionsOf(): Promise<readonly SubmissionRecord[]> {
    // The durable audit is tenant-scoped; submissionsOf() without a context
    // is an in-process-only contract. The page reads stateOf(ctx).
    return [];
  }
}
