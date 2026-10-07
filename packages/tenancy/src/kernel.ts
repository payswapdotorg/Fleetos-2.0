/**
 * @fleetos/tenancy — Wave 1 kernel (F210A).
 *
 * Tenant kernel:
 *   - Provisioning workflow (provision -> active -> suspended -> closed)
 *     with full legal-transition table and refusal reasons.
 *   - TenantRegistry over a structural port + deterministic in-memory
 *     reference implementation.
 *   - Suspension propagation contract — what a suspended/closed tenant
 *     refuses is encoded as a typed refusal surface (cross-context callers
 *     consult the kernel before issuing operations on tenant-scoped data).
 *   - Tenant context establishment + isolation vocabulary (re-using the
 *     Wave 0 contracts).
 *   - AuditEventRef emission on every consequential tenant operation (A19).
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import { createHash } from "node:crypto";
import {
  evaluateTenantTransition,
  type TenantBoundary,
  type TenantIdLike,
  type TenantLifecycleCommand,
  type TenantState,
  type TenantTransitionRejectionCode,
} from "./tenancy.js";

// ---------------------------------------------------------------------------
// AuditEventRef — structural audit reference (A19). Same shape as the one in
// @fleetos/identity; intentionally structural so any package can emit one
// without a shared import.
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
// Tenant record — the durable tenant entity the kernel operates on.
//
// `TenantRecord` extends the Wave 0 vocabulary by attaching the live state
// and a sequence number for monotonic transition logging. The Wave 0
// `evaluateTenantTransition` remains the pure state-machine; the kernel
// wraps it with audit emission and persistence.
// ---------------------------------------------------------------------------

export interface TenantRecord {
  readonly id: TenantIdLike;
  readonly displayName: string;
  readonly kind: "organization" | "personal" | "internal";
  readonly state: import("./tenancy.js").TenantState;
  readonly createdAt: number;
  readonly lastTransitionAt: number;
  readonly suspendReason: string | null;
  readonly closeReason: string | null;
  readonly transitionSeq: number;
}

// ---------------------------------------------------------------------------
// TenantRegistryPort — structural seam. Implementations may be in-memory
// (this package) or persistent (F211). All operations are tenant-id-keyed;
// cross-tenant reads fail closed (no listing across tenants).
// ---------------------------------------------------------------------------

export interface TenantRegistryPort {
  readonly save: (tenant: TenantRecord) => void;
  readonly find: (id: TenantIdLike) => TenantRecord | null;
  readonly remove: (id: TenantIdLike) => boolean;
}

// ---------------------------------------------------------------------------
// InMemoryTenantRegistry — deterministic reference.
// ---------------------------------------------------------------------------

export class InMemoryTenantRegistry implements TenantRegistryPort {
  private readonly tenants = new Map<TenantIdLike, TenantRecord>();
  save(t: TenantRecord): void {
    this.tenants.set(t.id, t);
  }
  find(id: TenantIdLike): TenantRecord | null {
    return this.tenants.get(id) ?? null;
  }
  remove(id: TenantIdLike): boolean {
    return this.tenants.delete(id);
  }
}

// ---------------------------------------------------------------------------
// TenantRegistry — kernel service over the port.
//
// Operations:
//   - provisionTenant: create a tenant in the "provisioning" state with a
//     monotonic transitionSeq of 1, after validating id format and refusing
//     duplicates.
//   - executeTransition: apply a transition command, persist the new state,
//     and emit an AuditEventRef.
//   - lookupTenant: read-only; returns null for unknown ids (fail-closed).
//   - closeTenant: terminal close; the tenant becomes read-only forever.
// ---------------------------------------------------------------------------

export type TenantRegistryRejectionCode =
  | TenantTransitionRejectionCode
  | "duplicate-tenant"
  | "unknown-tenant"
  | "malformed-tenant-id"
  | "missing-display-name"
  | "invalid-created-at";

export type TenantRegistryResult =
  | { readonly ok: true; readonly tenant: TenantRecord; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: TenantRegistryRejectionCode };

const TENANT_ID_RE = /^tnt_[A-Za-z0-9_-]{4,128}$/;

export class TenantRegistry {
  constructor(private readonly port: TenantRegistryPort) {}

  provisionTenant(input: {
    readonly tenantId: TenantIdLike;
    readonly displayName: string;
    readonly kind: TenantRecord["kind"];
    readonly createdAt: number;
    readonly actor: string;
  }): TenantRegistryResult {
    if (typeof input.tenantId !== "string" || !TENANT_ID_RE.test(input.tenantId)) {
      return { ok: false, reason: "malformed-tenant-id" };
    }
    if (input.displayName === "") return { ok: false, reason: "missing-display-name" };
    if (!Number.isFinite(input.createdAt) || input.createdAt <= 0) {
      return { ok: false, reason: "invalid-created-at" };
    }
    if (this.port.find(input.tenantId)) {
      return { ok: false, reason: "duplicate-tenant" };
    }
    const tenant: TenantRecord = {
      id: input.tenantId,
      displayName: input.displayName,
      kind: input.kind,
      state: "provisioning",
      createdAt: input.createdAt,
      lastTransitionAt: input.createdAt,
      suspendReason: null,
      closeReason: null,
      transitionSeq: 1,
    };
    this.port.save(tenant);
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: "tenant:provision",
      tenant: input.tenantId,
      timestamp: input.createdAt,
      digest: digestOf(input.tenantId, "provision", 1, input.createdAt),
    };
    return { ok: true, tenant, audit };
  }

  executeTransition(input: {
    readonly tenantId: TenantIdLike;
    readonly command: TenantLifecycleCommand;
    readonly actor: string;
  }): TenantRegistryResult {
    const current = this.port.find(input.tenantId);
    if (!current) return { ok: false, reason: "unknown-tenant" };
    const r = evaluateTenantTransition(current.state, input.command);
    if (!r.ok) return r;
    const nextSeq = current.transitionSeq + 1;
    const next: TenantRecord = {
      ...current,
      state: r.to,
      lastTransitionAt: input.command.initiatedAt,
      suspendReason: input.command.kind === "suspend" ? (input.command.reason ?? "unspecified") : current.suspendReason,
      // Close reason is set only on the FIRST close (closing entry); the
      // second close (closing -> closed) preserves the recorded reason.
      closeReason:
        input.command.kind === "close" && current.state !== "closing"
          ? (input.command.reason ?? "unspecified")
          : current.closeReason,
      transitionSeq: nextSeq,
    };
    this.port.save(next);
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: `tenant:${input.command.kind}`,
      tenant: input.tenantId,
      timestamp: input.command.initiatedAt,
      digest: digestOf(input.tenantId, input.command.kind, nextSeq, input.command.initiatedAt),
    };
    return { ok: true, tenant: next, audit };
  }

  lookupTenant(id: TenantIdLike): TenantRecord | null {
    return this.port.find(id);
  }

  boundary(tenant: TenantRecord): TenantBoundary {
    // Re-uses the Wave 0 boundary vocabulary.
    return { tenantId: tenant.id, readCrossTenant: false, writeCrossTenant: false };
  }
}

// ---------------------------------------------------------------------------
// Suspension propagation contract — typed refusal surface.
//
// When a tenant is suspended or closed, downstream contexts consult the
// kernel BEFORE issuing operations on tenant-scoped data. The kernel
// returns a typed refusal for forbidden operations and a typed allowance
// for permitted operations (reads of existing data are always allowed;
// writes/mutations are refused when suspended or closed; ALL operations
// are refused when closed).
// ---------------------------------------------------------------------------

export type TenantOperationKind =
  | "read"
  | "write"
  | "admit"
  | "mutate"
  | "provision"
  | "close";

export type TenantOperationRefusalCode =
  | "tenant-suspended-read-only"
  | "tenant-closed-no-operations"
  | "tenant-provisioning-no-writes"
  | "tenant-closing-no-new-writes"
  | "unknown-tenant";

export type TenantOperationDecision =
  | { readonly ok: true; readonly allowed: true; readonly tenantState: TenantState }
  | { readonly ok: false; readonly reason: TenantOperationRefusalCode; readonly tenantState: TenantState };

export function evaluateTenantOperation(
  tenant: TenantRecord | null,
  op: TenantOperationKind,
): TenantOperationDecision {
  if (!tenant) return { ok: false, reason: "unknown-tenant", tenantState: "closed" };
  const state = tenant.state;
  switch (state) {
    case "provisioning":
      // During provisioning, only reads and provisioning-complete are allowed.
      if (op === "read" || op === "provision") return { ok: true, allowed: true, tenantState: state };
      return { ok: false, reason: "tenant-provisioning-no-writes", tenantState: state };
    case "active":
      // Active tenants allow all operations except close-by-non-tl.
      return { ok: true, allowed: true, tenantState: state };
    case "suspended":
      // Suspended tenants are read-only: reads allowed, all writes/mutations refused.
      if (op === "read") return { ok: true, allowed: true, tenantState: state };
      if (op === "close") return { ok: true, allowed: true, tenantState: state };
      return { ok: false, reason: "tenant-suspended-read-only", tenantState: state };
    case "closing":
      // Closing tenants accept no new writes; existing reads continue.
      if (op === "read" || op === "close") return { ok: true, allowed: true, tenantState: state };
      return { ok: false, reason: "tenant-closing-no-new-writes", tenantState: state };
    case "closed":
      // Closed tenants refuse ALL operations (no reads, no writes, no admin).
      return { ok: false, reason: "tenant-closed-no-operations", tenantState: state };
  }
}

// ---------------------------------------------------------------------------
// Tenant establishment — kernel helper that combines validation + lookup.
// ---------------------------------------------------------------------------

export type TenantEstablishmentRejectionCode =
  | "unknown-tenant"
  | "tenant-suspended"
  | "tenant-closed"
  | "tenant-provisioning";

export type TenantEstablishmentResult =
  | { readonly ok: true; readonly tenant: TenantRecord; readonly boundary: TenantBoundary }
  | { readonly ok: false; readonly reason: TenantEstablishmentRejectionCode };

export function establishTenant(
  registry: TenantRegistry,
  tenantId: TenantIdLike,
  allowTransitional: boolean,
): TenantEstablishmentResult {
  const tenant = registry.lookupTenant(tenantId);
  if (!tenant) return { ok: false, reason: "unknown-tenant" };
  if (tenant.state === "closed") return { ok: false, reason: "tenant-closed" };
  if (tenant.state === "suspended") return { ok: false, reason: "tenant-suspended" };
  if (tenant.state === "provisioning" && !allowTransitional) {
    return { ok: false, reason: "tenant-provisioning" };
  }
  return {
    ok: true,
    tenant,
    boundary: registry.boundary(tenant),
  };
}
