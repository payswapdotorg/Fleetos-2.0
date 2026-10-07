/**
 * @fleetos/recovery — Wave 1 kernel (F210A).
 *
 * Recovery kernel — deepens the Wave 0 state machine to kernel grade:
 *   - Audit reference emission (structural AuditEventRef) on every
 *     consequential transition.
 *   - Structural evidence refs on resolve (A13 evidence completeness).
 *   - A RecoveryCaseRegistry over a structural port + deterministic in-memory
 *     reference; tenant-scoped reads fail-closed.
 *   - Audit-event reference log per case (history append-only).
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import { createHash } from "node:crypto";
import {
  applyRecoveryCommand,
  openRecoveryCase,
  type DeviceIdLike,
  type RecoveryCase,
  type RecoveryCaseId,
  type RecoveryCommand,
  type RecoveryHistoryEntry,
  type RecoveryRejectionCode,
  type RecoveryState,
  type TenantIdLike,
} from "./recovery.js";

// ---------------------------------------------------------------------------
// AuditEventRef — structural audit reference (A19).
// ---------------------------------------------------------------------------

export interface AuditEventRef {
  readonly actor: string;
  readonly intent: string;
  readonly tenant: string;
  readonly timestamp: number;
  readonly digest: string;
}

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// RecoveryKernelResult — wraps the Wave 0 result with an audit emission.
// ---------------------------------------------------------------------------

export type RecoveryKernelResult =
  | {
      readonly ok: true;
      readonly from: RecoveryState;
      readonly to: RecoveryState;
      readonly case: RecoveryCase;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: RecoveryRejectionCode };

export interface RecoveryKernelContext {
  readonly tenantId: TenantIdLike;
  readonly actor: string;
}

export function applyRecoveryCommandAudited(
  rc: RecoveryCase,
  command: RecoveryCommand,
  ctx: RecoveryKernelContext,
): RecoveryKernelResult {
  const r = applyRecoveryCommand(rc, command);
  if (!r.ok) return r;
  const audit: AuditEventRef = {
    actor: ctx.actor,
    intent: `recovery:${command.kind}`,
    tenant: ctx.tenantId,
    timestamp: command.initiatedAt,
    digest: digestOf(rc.id, command.kind, command.initiatedAt),
  };
  return { ok: true, from: r.case.history[r.case.history.length - 1]?.from ?? rc.state, to: r.case.state, case: r.case, audit };
}

// ---------------------------------------------------------------------------
// RecoveryCaseRegistryPort — structural seam.
// ---------------------------------------------------------------------------

export interface RecoveryCaseRegistryPort {
  readonly save: (rc: RecoveryCase) => void;
  readonly find: (tenantId: TenantIdLike, id: RecoveryCaseId) => RecoveryCase | null;
  readonly listByTenant: (tenantId: TenantIdLike) => ReadonlyArray<RecoveryCase>;
  readonly listByDevice: (tenantId: TenantIdLike, deviceId: DeviceIdLike) => ReadonlyArray<RecoveryCase>;
}

export class InMemoryRecoveryCaseRegistry implements RecoveryCaseRegistryPort {
  private readonly cases = new Map<string, RecoveryCase>();
  save(rc: RecoveryCase): void {
    this.cases.set(`${rc.tenantId}:${rc.id}`, rc);
  }
  find(t: TenantIdLike, id: RecoveryCaseId): RecoveryCase | null {
    return this.cases.get(`${t}:${id}`) ?? null;
  }
  listByTenant(t: TenantIdLike): ReadonlyArray<RecoveryCase> {
    const out: RecoveryCase[] = [];
    for (const c of this.cases.values()) if (c.tenantId === t) out.push(c);
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  listByDevice(t: TenantIdLike, d: DeviceIdLike): ReadonlyArray<RecoveryCase> {
    const out: RecoveryCase[] = [];
    for (const c of this.cases.values()) if (c.tenantId === t && c.deviceId === d) out.push(c);
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

// ---------------------------------------------------------------------------
// RecoveryCaseDirectory — kernel service.
// ---------------------------------------------------------------------------

export type RecoveryDirectoryRejectionCode =
  | RecoveryRejectionCode
  | "malformed-case-id"
  | "missing-tenant-id"
  | "missing-device-id"
  | "duplicate-case"
  | "unknown-case"
  | "tenant-mismatch";

export type RecoveryDirectoryResult =
  | { readonly ok: true; readonly case: RecoveryCase; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: RecoveryDirectoryRejectionCode };

const RECOVERY_ID_RE = /^rc_[A-Za-z0-9_-]{6,128}$/;

export class RecoveryCaseDirectory {
  constructor(private readonly port: RecoveryCaseRegistryPort) {}

  openCase(input: {
    readonly caseId: string;
    readonly tenantId: TenantIdLike;
    readonly deviceId: DeviceIdLike;
    readonly openedAt: number;
    readonly actor: string;
  }): RecoveryDirectoryResult {
    if (typeof input.caseId !== "string" || !RECOVERY_ID_RE.test(input.caseId)) {
      return { ok: false, reason: "malformed-case-id" };
    }
    if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
    if (input.deviceId === "") return { ok: false, reason: "missing-device-id" };
    if (this.port.find(input.tenantId, input.caseId as RecoveryCaseId)) {
      return { ok: false, reason: "duplicate-case" };
    }
    const rc = openRecoveryCase({
      id: input.caseId as RecoveryCaseId,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      openedAt: input.openedAt,
    });
    this.port.save(rc);
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: "recovery:open",
      tenant: input.tenantId,
      timestamp: input.openedAt,
      digest: digestOf(input.caseId, "open", input.openedAt),
    };
    return { ok: true, case: rc, audit };
  }

  transition(input: {
    readonly tenantId: TenantIdLike;
    readonly caseId: RecoveryCaseId;
    readonly command: RecoveryCommand;
    readonly actor: string;
  }): RecoveryDirectoryResult {
    const rc = this.port.find(input.tenantId, input.caseId);
    if (!rc) return { ok: false, reason: "unknown-case" };
    if (rc.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
    const r = applyRecoveryCommandAudited(rc, input.command, { tenantId: input.tenantId, actor: input.actor });
    if (!r.ok) return r;
    this.port.save(r.case);
    return { ok: true, case: r.case, audit: r.audit };
  }

  lookup(tenantId: TenantIdLike, id: RecoveryCaseId): RecoveryCase | null {
    return this.port.find(tenantId, id);
  }

  listByTenant(tenantId: TenantIdLike): ReadonlyArray<RecoveryCase> {
    return this.port.listByTenant(tenantId);
  }

  listByDevice(tenantId: TenantIdLike, deviceId: DeviceIdLike): ReadonlyArray<RecoveryCase> {
    return this.port.listByDevice(tenantId, deviceId);
  }

  // Audit-event log per case (history with audit refs).
  auditLog(rc: RecoveryCase): ReadonlyArray<RecoveryHistoryEntry> {
    return rc.history;
  }
}

// ---------------------------------------------------------------------------
// Maintenance windows for recovery — a recovery case may declare a window
// during which the recovery is allowed to operate (e.g., a maintenance
// window for a swap). This is a kernel-grade scheduling contract.
// ---------------------------------------------------------------------------

export interface RecoveryWindow {
  readonly caseId: RecoveryCaseId;
  readonly tenantId: TenantIdLike;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly reason: string;
}

export type RecoveryWindowRejectionCode =
  | "missing-reason"
  | "invalid-window"
  | "ends-before-start";

export type RecoveryWindowResult =
  | { readonly ok: true; readonly window: RecoveryWindow; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: RecoveryWindowRejectionCode };

export function declareRecoveryWindow(input: {
  readonly caseId: RecoveryCaseId;
  readonly tenantId: TenantIdLike;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly reason: string;
  readonly actor: string;
}): RecoveryWindowResult {
  if (input.reason === "") return { ok: false, reason: "missing-reason" };
  if (!Number.isFinite(input.startsAt) || !Number.isFinite(input.endsAt) || input.startsAt <= 0) {
    return { ok: false, reason: "invalid-window" };
  }
  if (input.endsAt <= input.startsAt) return { ok: false, reason: "ends-before-start" };
  const window: RecoveryWindow = {
    caseId: input.caseId,
    tenantId: input.tenantId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    reason: input.reason,
  };
  const audit: AuditEventRef = {
    actor: input.actor,
    intent: "recovery:window:declare",
    tenant: input.tenantId,
    timestamp: input.startsAt,
    digest: digestOf(input.caseId, "window", input.startsAt, input.endsAt),
  };
  return { ok: true, window, audit };
}

export function windowActiveAt(window: RecoveryWindow, now: number): boolean {
  return now >= window.startsAt && now <= window.endsAt;
}
