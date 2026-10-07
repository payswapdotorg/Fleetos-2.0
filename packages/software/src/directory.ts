/**
 * @fleetos/software — Audit events + SoftwareDirectory + repository port
 * + in-memory reference.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type {
  Subscription,
  SubscriptionId,
  SubscriptionStatus,
  Entitlement,
  EntitlementId,
  AllocationRequest,
  EntitlementCheckResult,
  ExpirySweepResult,
  SubscriptionCompliance,
} from "./contracts.js";
import {
  checkEntitlement,
  sweepExpiredSubscriptions,
  computeSubscriptionCompliance,
} from "./contracts.js";

// ---------------------------------------------------------------------------
// Audit events.
// ---------------------------------------------------------------------------

export type AuditEventKind =
  | "software.allocation-checked"
  | "software.allocation-applied"
  | "software.allocation-refused"
  | "software.entitlement-revoked"
  | "software.expiry-swept"
  | "software.compliance-read";

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly subscriptionId: string;
  readonly occurredAt: string;
  readonly digest: string;
  readonly reasonCode: string | null;
  readonly overshootSeats: number | null;
  readonly expiredCount: number | null;
}

export function computeAuditDigest(inputs: {
  readonly kind: AuditEventKind;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly occurredAt: string;
  readonly reasonCode: string | null;
}): string {
  const parts = [
    inputs.kind,
    inputs.tenantId,
    inputs.subscriptionId,
    inputs.occurredAt,
    inputs.reasonCode ?? "",
  ];
  let hash = 0x811c9dc5;
  const joined = parts.join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `audit_${hash.toString(16).padStart(8, "0")}`;
}

export function makeAuditEvent(inputs: {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly subscriptionId: string;
  readonly occurredAt: string;
  readonly reasonCode?: string | null;
  readonly overshootSeats?: number | null;
  readonly expiredCount?: number | null;
}): AuditEvent {
  const digest = computeAuditDigest({
    kind: inputs.kind,
    tenantId: inputs.tenant.tenantId,
    subscriptionId: inputs.subscriptionId,
    occurredAt: inputs.occurredAt,
    reasonCode: inputs.reasonCode ?? null,
  });
  return {
    kind: inputs.kind,
    tenant: inputs.tenant,
    subscriptionId: inputs.subscriptionId,
    occurredAt: inputs.occurredAt,
    digest,
    reasonCode: inputs.reasonCode ?? null,
    overshootSeats: inputs.overshootSeats ?? null,
    expiredCount: inputs.expiredCount ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository port + in-memory reference.
// ---------------------------------------------------------------------------

export interface SoftwareRepositoryPort {
  loadSubscription(tenant: TenantScope, id: SubscriptionId): Promise<Subscription | null>;
  storeSubscription(tenant: TenantScope, subscription: Subscription): Promise<void>;
  listSubscriptions(
    tenant: TenantScope,
    filter?: { readonly statuses?: readonly SubscriptionStatus[] },
  ): Promise<readonly Subscription[]>;
  listEntitlementsForSubscription(
    tenant: TenantScope,
    subscriptionId: SubscriptionId,
  ): Promise<readonly Entitlement[]>;
  storeEntitlement(tenant: TenantScope, entitlement: Entitlement): Promise<void>;
  loadEntitlement(tenant: TenantScope, id: EntitlementId): Promise<Entitlement | null>;
}

export function createInMemorySoftwareRepository(
  initialSubscriptions?: readonly Subscription[],
  initialEntitlements?: readonly Entitlement[],
): SoftwareRepositoryPort {
  const subscriptions = new Map<string, Subscription>();
  const entitlements = new Map<string, Entitlement>();
  for (const s of initialSubscriptions ?? []) {
    subscriptions.set(`${s.tenant.tenantId}::${s.id.value}`, s);
  }
  for (const e of initialEntitlements ?? []) {
    entitlements.set(`${e.tenant.tenantId}::${e.id.value}`, e);
  }
  return {
    async loadSubscription(tenant, id) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return subscriptions.get(`${tc.scope.tenantId}::${id.value}`) ?? null;
    },
    async storeSubscription(tenant, subscription) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (subscription.tenant.tenantId !== tc.scope.tenantId) return;
      subscriptions.set(`${tc.scope.tenantId}::${subscription.id.value}`, subscription);
    },
    async listSubscriptions(tenant, filter) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return [];
      const prefix = `${tc.scope.tenantId}::`;
      const out: Subscription[] = [];
      for (const [k, s] of subscriptions.entries()) {
        if (!k.startsWith(prefix)) continue;
        if (filter?.statuses && !filter.statuses.includes(s.status)) continue;
        out.push(s);
      }
      out.sort((a, b) => a.id.value.localeCompare(b.id.value));
      return out;
    },
    async listEntitlementsForSubscription(tenant, subscriptionId) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return [];
      const prefix = `${tc.scope.tenantId}::`;
      const out: Entitlement[] = [];
      for (const [k, e] of entitlements.entries()) {
        if (!k.startsWith(prefix)) continue;
        if (e.subscriptionId.value !== subscriptionId.value) continue;
        out.push(e);
      }
      out.sort((a, b) => a.id.value.localeCompare(b.id.value));
      return out;
    },
    async storeEntitlement(tenant, entitlement) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (entitlement.tenant.tenantId !== tc.scope.tenantId) return;
      entitlements.set(`${tc.scope.tenantId}::${entitlement.id.value}`, entitlement);
    },
    async loadEntitlement(tenant, id) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return entitlements.get(`${tc.scope.tenantId}::${id.value}`) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// SoftwareDirectory.
// ---------------------------------------------------------------------------

export type DirectoryReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "SUBSCRIPTION_NOT_FOUND"
  | "SUBSCRIPTION_MISMATCH"
  | "SUBSCRIPTION_NOT_ACTIVE"
  | "NEGATIVE_REQUEST"
  | "OVER_ALLOCATION"
  | "ENTITLEMENT_NOT_FOUND";

export interface DirectorySuccess {
  readonly ok: true;
  readonly auditEvents: readonly AuditEvent[];
  readonly feasibility?: EntitlementCheckResult;
  readonly entitlement?: Entitlement;
  readonly expirySweep?: ExpirySweepResult;
  readonly compliance?: SubscriptionCompliance;
}

export interface DirectoryRefusal {
  readonly ok: false;
  readonly reasonCode: DirectoryReasonCode;
  readonly overshootSeats?: number;
  readonly auditEvents?: readonly AuditEvent[];
}

export type DirectoryResult = DirectorySuccess | DirectoryRefusal;

export interface SoftwareDirectory {
  checkEntitlement(
    tenant: TenantScope,
    request: AllocationRequest,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  allocateEntitlement(
    tenant: TenantScope,
    entitlementId: EntitlementId,
    subscriptionId: SubscriptionId,
    assigneeId: string,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  revokeEntitlement(
    tenant: TenantScope,
    entitlementId: EntitlementId,
    reason: string,
    revokedAt: string,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  sweepExpiries(tenant: TenantScope, now: string): Promise<DirectoryResult>;

  readCompliance(
    tenant: TenantScope,
    subscriptionId: SubscriptionId,
    now: string,
  ): Promise<DirectoryResult>;
}

export function createSoftwareDirectory(
  repository: SoftwareRepositoryPort,
): SoftwareDirectory {
  return new DirectoryImpl(repository);
}

class DirectoryImpl implements SoftwareDirectory {
  constructor(private readonly repo: SoftwareRepositoryPort) {}

  async checkEntitlement(
    tenant: TenantScope,
    request: AllocationRequest,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const subscription = await this.repo.loadSubscription(tenant, request.subscriptionId);
    if (subscription === null) return refuse("SUBSCRIPTION_NOT_FOUND");
    if (subscription.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const entitlements = await this.repo.listEntitlementsForSubscription(tenant, request.subscriptionId);
    const result = checkEntitlement(subscription, entitlements, request);
    if (!result.ok) {
      const audit = makeAuditEvent({
        kind: "software.allocation-refused",
        tenant,
        subscriptionId: request.subscriptionId.value,
        occurredAt: options.occurredAt,
        reasonCode: result.reasonCode,
        overshootSeats: result.overshootSeats,
      });
      return {
        ok: false,
        reasonCode: result.reasonCode as DirectoryReasonCode,
        overshootSeats: result.overshootSeats,
        auditEvents: [audit],
      };
    }
    const audit = makeAuditEvent({
      kind: "software.allocation-checked",
      tenant,
      subscriptionId: request.subscriptionId.value,
      occurredAt: options.occurredAt,
    });
    return { ok: true, feasibility: result, auditEvents: [audit] };
  }

  async allocateEntitlement(
    tenant: TenantScope,
    entitlementId: EntitlementId,
    subscriptionId: SubscriptionId,
    assigneeId: string,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const subscription = await this.repo.loadSubscription(tenant, subscriptionId);
    if (subscription === null) return refuse("SUBSCRIPTION_NOT_FOUND");
    if (subscription.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const entitlements = await this.repo.listEntitlementsForSubscription(tenant, subscriptionId);
    const request: AllocationRequest = {
      tenant,
      subscriptionId,
      requestedSeats: 1,
    };
    const result = checkEntitlement(subscription, entitlements, request);
    if (!result.ok) {
      const audit = makeAuditEvent({
        kind: "software.allocation-refused",
        tenant,
        subscriptionId: subscriptionId.value,
        occurredAt: options.occurredAt,
        reasonCode: result.reasonCode,
        overshootSeats: result.overshootSeats,
      });
      return {
        ok: false,
        reasonCode: result.reasonCode as DirectoryReasonCode,
        overshootSeats: result.overshootSeats,
        auditEvents: [audit],
      };
    }
    const entitlement: Entitlement = {
      id: entitlementId,
      tenant,
      subscriptionId,
      assigneeId,
      revokedAt: null,
      revokedReason: null,
    };
    await this.repo.storeEntitlement(tenant, entitlement);
    const audit = makeAuditEvent({
      kind: "software.allocation-applied",
      tenant,
      subscriptionId: subscriptionId.value,
      occurredAt: options.occurredAt,
    });
    return { ok: true, feasibility: result, entitlement, auditEvents: [audit] };
  }

  async revokeEntitlement(
    tenant: TenantScope,
    entitlementId: EntitlementId,
    reason: string,
    revokedAt: string,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const current = await this.repo.loadEntitlement(tenant, entitlementId);
    if (current === null) return refuse("ENTITLEMENT_NOT_FOUND");
    if (current.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    if (current.revokedAt !== null) {
      // Idempotent: re-revoking is a no-op success.
      return { ok: true, entitlement: current, auditEvents: [] };
    }
    const revoked: Entitlement = {
      ...current,
      revokedAt,
      revokedReason: reason,
    };
    await this.repo.storeEntitlement(tenant, revoked);
    const audit = makeAuditEvent({
      kind: "software.entitlement-revoked",
      tenant,
      subscriptionId: current.subscriptionId.value,
      occurredAt: options.occurredAt,
    });
    return { ok: true, entitlement: revoked, auditEvents: [audit] };
  }

  async sweepExpiries(tenant: TenantScope, now: string): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const subscriptions = await this.repo.listSubscriptions(tenant, { statuses: ["active"] });
    const sweep = sweepExpiredSubscriptions(tenant, subscriptions, now);
    // Mark each expired subscription as expired in the repository. This
    // is a state transition, not a silent mutation — the expiry sweep
    // produces the new state explicitly.
    for (const id of sweep.expiredSubscriptionIds) {
      const sub = subscriptions.find((s) => s.id.value === id);
      if (sub) {
        await this.repo.storeSubscription(tenant, { ...sub, status: "expired" });
      }
    }
    const audit = makeAuditEvent({
      kind: "software.expiry-swept",
      tenant,
      subscriptionId: "*",
      occurredAt: now,
      expiredCount: sweep.expiredSubscriptionIds.length,
    });
    return { ok: true, expirySweep: sweep, auditEvents: [audit] };
  }

  async readCompliance(
    tenant: TenantScope,
    subscriptionId: SubscriptionId,
    now: string,
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const subscription = await this.repo.loadSubscription(tenant, subscriptionId);
    if (subscription === null) return refuse("SUBSCRIPTION_NOT_FOUND");
    if (subscription.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const entitlements = await this.repo.listEntitlementsForSubscription(tenant, subscriptionId);
    const compliance = computeSubscriptionCompliance(subscription, entitlements, now);
    const audit = makeAuditEvent({
      kind: "software.compliance-read",
      tenant,
      subscriptionId: subscriptionId.value,
      occurredAt: now,
    });
    return { ok: true, compliance, auditEvents: [audit] };
  }
}

function refuse(reasonCode: DirectoryReasonCode): DirectoryRefusal {
  return { ok: false, reasonCode };
}
