/**
 * @fleetos/vendors — Audit events + VendorDirectory + repository port +
 * in-memory reference.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type {
  Vendor,
  VendorId,
  VendorStatus,
  VendorServiceRelationship,
  VendorScorecard,
  VendorScorecardAggregate,
} from "./contracts.js";
import { aggregateScorecard, capabilityMatchingFeed, transitionServiceRelationship, type VendorCapabilityRef } from "./contracts.js";

// ---------------------------------------------------------------------------
// Audit events.
// ---------------------------------------------------------------------------

export type AuditEventKind =
  | "vendor.service-relationship-transitioned"
  | "vendor.scorecard-aggregated"
  | "vendor.capability-feed-produced";

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly vendorId: string;
  readonly occurredAt: string;
  readonly digest: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly reasonCode: string | null;
}

export function computeAuditDigest(inputs: {
  readonly kind: AuditEventKind;
  readonly tenantId: string;
  readonly vendorId: string;
  readonly occurredAt: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
}): string {
  const parts = [
    inputs.kind,
    inputs.tenantId,
    inputs.vendorId,
    inputs.occurredAt,
    inputs.fromStatus ?? "",
    inputs.toStatus ?? "",
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
  readonly vendorId: string;
  readonly occurredAt: string;
  readonly fromStatus?: string | null;
  readonly toStatus?: string | null;
  readonly reasonCode?: string | null;
}): AuditEvent {
  const digest = computeAuditDigest({
    kind: inputs.kind,
    tenantId: inputs.tenant.tenantId,
    vendorId: inputs.vendorId,
    occurredAt: inputs.occurredAt,
    fromStatus: inputs.fromStatus ?? null,
    toStatus: inputs.toStatus ?? null,
  });
  return {
    kind: inputs.kind,
    tenant: inputs.tenant,
    vendorId: inputs.vendorId,
    occurredAt: inputs.occurredAt,
    digest,
    fromStatus: inputs.fromStatus ?? null,
    toStatus: inputs.toStatus ?? null,
    reasonCode: inputs.reasonCode ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository port + in-memory reference.
// ---------------------------------------------------------------------------

export interface VendorRepositoryPort {
  loadVendor(tenant: TenantScope, id: VendorId): Promise<Vendor | null>;
  storeVendor(tenant: TenantScope, vendor: Vendor): Promise<void>;
  listVendors(
    tenant: TenantScope,
    filter?: { readonly statuses?: readonly VendorStatus[] },
  ): Promise<readonly Vendor[]>;
  loadServiceRelationship(
    tenant: TenantScope,
    vendorId: VendorId,
  ): Promise<VendorServiceRelationship | null>;
  storeServiceRelationship(
    tenant: TenantScope,
    relationship: VendorServiceRelationship,
  ): Promise<void>;
  loadScorecard(tenant: TenantScope, vendorId: VendorId): Promise<VendorScorecard | null>;
  storeScorecard(tenant: TenantScope, scorecard: VendorScorecard): Promise<void>;
}

export function createInMemoryVendorRepository(
  initialVendors?: readonly Vendor[],
  initialRelationships?: readonly VendorServiceRelationship[],
  initialScorecards?: readonly VendorScorecard[],
): VendorRepositoryPort {
  const vendors = new Map<string, Vendor>();
  const relationships = new Map<string, VendorServiceRelationship>();
  const scorecards = new Map<string, VendorScorecard>();
  for (const v of initialVendors ?? []) {
    vendors.set(`${v.tenant.tenantId}::${v.id.value}`, v);
  }
  for (const r of initialRelationships ?? []) {
    relationships.set(`${r.tenant.tenantId}::${r.vendorId.value}`, r);
  }
  for (const s of initialScorecards ?? []) {
    scorecards.set(`${s.tenant.tenantId}::${s.vendorId.value}`, s);
  }
  return {
    async loadVendor(tenant, id) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return vendors.get(`${tc.scope.tenantId}::${id.value}`) ?? null;
    },
    async storeVendor(tenant, vendor) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (vendor.tenant.tenantId !== tc.scope.tenantId) return;
      vendors.set(`${tc.scope.tenantId}::${vendor.id.value}`, vendor);
    },
    async listVendors(tenant, filter) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return [];
      const prefix = `${tc.scope.tenantId}::`;
      const out: Vendor[] = [];
      for (const [k, v] of vendors.entries()) {
        if (!k.startsWith(prefix)) continue;
        if (filter?.statuses && !filter.statuses.includes(v.status)) continue;
        out.push(v);
      }
      out.sort((a, b) => a.id.value.localeCompare(b.id.value));
      return out;
    },
    async loadServiceRelationship(tenant, vendorId) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return relationships.get(`${tc.scope.tenantId}::${vendorId.value}`) ?? null;
    },
    async storeServiceRelationship(tenant, relationship) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (relationship.tenant.tenantId !== tc.scope.tenantId) return;
      relationships.set(`${tc.scope.tenantId}::${relationship.vendorId.value}`, relationship);
    },
    async loadScorecard(tenant, vendorId) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return scorecards.get(`${tc.scope.tenantId}::${vendorId.value}`) ?? null;
    },
    async storeScorecard(tenant, scorecard) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (scorecard.tenant.tenantId !== tc.scope.tenantId) return;
      scorecards.set(`${tc.scope.tenantId}::${scorecard.vendorId.value}`, scorecard);
    },
  };
}

// ---------------------------------------------------------------------------
// VendorDirectory.
// ---------------------------------------------------------------------------

export type DirectoryReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "VENDOR_NOT_FOUND"
  | "SERVICE_RELATIONSHIP_NOT_FOUND"
  | "ILLEGAL_TRANSITION"
  | "SUSPEND_REASON_REQUIRED"
  | "TERMINATE_REASON_REQUIRED"
  | "EMPTY_SCORECARD"
  | "SCORE_OUT_OF_RANGE";

export interface DirectorySuccess {
  readonly ok: true;
  readonly auditEvents: readonly AuditEvent[];
  readonly relationship?: VendorServiceRelationship;
  readonly aggregate?: VendorScorecardAggregate;
  readonly feed?: readonly VendorCapabilityRef[];
}

export interface DirectoryRefusal {
  readonly ok: false;
  readonly reasonCode: DirectoryReasonCode;
  readonly auditEvents?: readonly AuditEvent[];
}

export type DirectoryResult = DirectorySuccess | DirectoryRefusal;

export interface VendorDirectory {
  transitionServiceRelationship(
    tenant: TenantScope,
    vendorId: VendorId,
    command: import("./contracts.js").ServiceRelationshipTransitionCommand,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  aggregateScorecard(
    tenant: TenantScope,
    vendorId: VendorId,
  ): Promise<DirectoryResult>;

  capabilityMatchingFeed(
    tenant: TenantScope,
    requestedTags: readonly string[],
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  getVendor(tenant: TenantScope, id: VendorId): Promise<Vendor | null>;
}

export function createVendorDirectory(
  repository: VendorRepositoryPort,
): VendorDirectory {
  return new DirectoryImpl(repository);
}

class DirectoryImpl implements VendorDirectory {
  constructor(private readonly repo: VendorRepositoryPort) {}

  async transitionServiceRelationship(
    tenant: TenantScope,
    vendorId: VendorId,
    command: import("./contracts.js").ServiceRelationshipTransitionCommand,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const current = await this.repo.loadServiceRelationship(tenant, vendorId);
    if (current === null) return refuse("SERVICE_RELATIONSHIP_NOT_FOUND");
    if (current.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const result = transitionServiceRelationship(current, command);
    if (!result.ok) return refuse(result.reasonCode);
    await this.repo.storeServiceRelationship(tenant, result.next);
    const audit = makeAuditEvent({
      kind: "vendor.service-relationship-transitioned",
      tenant,
      vendorId: vendorId.value,
      occurredAt: options.occurredAt,
      fromStatus: current.status,
      toStatus: result.next.status,
    });
    return { ok: true, relationship: result.next, auditEvents: [audit] };
  }

  async aggregateScorecard(
    tenant: TenantScope,
    vendorId: VendorId,
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const scorecard = await this.repo.loadScorecard(tenant, vendorId);
    if (scorecard === null) return refuse("EMPTY_SCORECARD");
    if (scorecard.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const result = aggregateScorecard(scorecard);
    if (!result.ok) return refuse(result.reasonCode);
    const audit = makeAuditEvent({
      kind: "vendor.scorecard-aggregated",
      tenant,
      vendorId: vendorId.value,
      occurredAt: new Date(0).toISOString(),
      fromStatus: null,
      toStatus: null,
    });
    return { ok: true, aggregate: result.aggregate, auditEvents: [audit] };
  }

  async capabilityMatchingFeed(
    tenant: TenantScope,
    requestedTags: readonly string[],
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const vendors = await this.repo.listVendors(tenant, { statuses: ["active"] });
    const scorecards: VendorScorecard[] = [];
    for (const v of vendors) {
      const sc = await this.repo.loadScorecard(tenant, v.id);
      if (sc) scorecards.push(sc);
    }
    const feed = capabilityMatchingFeed(tenant, vendors, scorecards, requestedTags);
    const audit = makeAuditEvent({
      kind: "vendor.capability-feed-produced",
      tenant,
      vendorId: "*",
      occurredAt: options.occurredAt,
      fromStatus: null,
      toStatus: null,
    });
    return { ok: true, feed, auditEvents: [audit] };
  }

  async getVendor(tenant: TenantScope, id: VendorId): Promise<Vendor | null> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return null;
    const item = await this.repo.loadVendor(tenant, id);
    if (item === null) return null;
    if (item.tenant.tenantId !== tenantCheck.scope.tenantId) return null;
    return item;
  }
}

function refuse(reasonCode: DirectoryReasonCode): DirectoryRefusal {
  return { ok: false, reasonCode };
}
