/**
 * @fleetos/software — Software catalog with version lifecycle
 * (registered → deprecated → retired) + entitlement grant lifecycle with
 * seat-count invariants + deterministic license compliance checks.
 *
 * Wave 2 lane C (F220C) operational-truth grade.
 *
 * Laws: A1, A4 (over-assignment refused, never clamped), A8, A19, A20.
 *
 * Pure and deterministic. Time is an explicit `number` input (epoch ms).
 * Seats are integers.
 */

import type { TenantScope, Subscription } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// LOCAL structural evidence reference (cross-worker seam, law A13).
// ---------------------------------------------------------------------------

export interface EvidenceRefLike {
  readonly evidenceId: string;
  readonly tenantId: string;
}

// ---------------------------------------------------------------------------
// Catalog version lifecycle: registered → deprecated → retired.
// ---------------------------------------------------------------------------

export type CatalogVersionStatus = "registered" | "deprecated" | "retired";

export interface CatalogSoftwareEntry {
  readonly id: string;
  readonly tenant: TenantScope;
  readonly name: string;
  /** Semantic version string matching MAJOR.MINOR.PATCH. */
  readonly version: string;
  readonly status: CatalogVersionStatus;
  readonly deprecatedAt: number | null;
  readonly retiredAt: number | null;
}

export type CatalogCreationResult =
  | { readonly ok: true; readonly entry: CatalogSoftwareEntry }
  | { readonly ok: false; readonly reasonCode: CatalogReasonCode };

export type CatalogTransitionResult =
  | { readonly ok: true; readonly next: CatalogSoftwareEntry }
  | { readonly ok: false; readonly reasonCode: CatalogReasonCode };

export type CatalogReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "INVALID_VERSION"
  | "ILLEGAL_TRANSITION"
  | "TERMINAL_STATE";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const CATALOG_ALLOWED: Readonly<
  Record<CatalogVersionStatus, readonly ("deprecate" | "retire")[]>
> = {
  registered: ["deprecate"],
  deprecated: ["retire"],
  retired: [],
};

/**
 * createCatalogEntry — registers a new catalog entry. The version must
 * be a plain MAJOR.MINOR.PATCH string (deterministic validation).
 */
export function createCatalogEntry(input: {
  readonly id: string;
  readonly tenant: TenantScope;
  readonly name: string;
  readonly version: string;
}): CatalogCreationResult {
  const tenantCheck = validateTenantScope(input.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!VERSION_PATTERN.test(input.version)) {
    return { ok: false, reasonCode: "INVALID_VERSION" };
  }
  return {
    ok: true,
    entry: {
      id: input.id,
      tenant: input.tenant,
      name: input.name,
      version: input.version,
      status: "registered",
      deprecatedAt: null,
      retiredAt: null,
    },
  };
}

/**
 * transitionCatalogEntry — registered → deprecated → retired. Retired is
 * TERMINAL (TERMINAL_STATE). Registering the deprecation/retirement
 * timestamp is part of the transition record.
 */
export function transitionCatalogEntry(
  current: CatalogSoftwareEntry,
  command: { readonly type: "deprecate" | "retire"; readonly at: number },
): CatalogTransitionResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (current.status === "retired") {
    return { ok: false, reasonCode: "TERMINAL_STATE" };
  }
  const allowed = CATALOG_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  if (command.type === "deprecate") {
    return {
      ok: true,
      next: { ...current, status: "deprecated", deprecatedAt: command.at },
    };
  }
  return { ok: true, next: { ...current, status: "retired", retiredAt: command.at } };
}

// ---------------------------------------------------------------------------
// Entitlement grant lifecycle: granted → assigned → expired/revoked with
// seat-count invariants.
// ---------------------------------------------------------------------------

export type EntitlementGrantStatus = "granted" | "assigned" | "expired" | "revoked";

export interface EntitlementGrant {
  readonly id: string;
  readonly tenant: TenantScope;
  readonly subscriptionId: string;
  readonly catalogEntryId: string;
  readonly assigneeId: string | null;
  readonly seats: number;
  readonly status: EntitlementGrantStatus;
  readonly grantedAt: number;
  readonly assignedAt: number | null;
  readonly revokedAt: number | null;
  readonly revokedReason: string | null;
  readonly expiresAt: number | null;
}

export type GrantTransitionResult =
  | { readonly ok: true; readonly next: EntitlementGrant }
  | { readonly ok: false; readonly reasonCode: GrantReasonCode };

export type GrantReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "ILLEGAL_TRANSITION"
  | "TERMINAL_STATE"
  | "NEGATIVE_SEATS"
  | "SEATS_EXHAUSTED"
  | "ASSIGNEE_REQUIRED"
  | "REVOCATION_REASON_REQUIRED"
  | "CATALOG_RETIRED"
  | "CATALOG_DEPRECATED"
  | "SUBSCRIPTION_NOT_ACTIVE"
  | "SUBSCRIPTION_EXPIRED";

const GRANT_ALLOWED: Readonly<
  Record<EntitlementGrantStatus, readonly ("assign" | "revoke" | "expire")[]>
> = {
  granted: ["assign", "revoke", "expire"],
  assigned: ["revoke", "expire"],
  expired: [],
  revoked: [],
};

/** Grants in these statuses hold seats against the subscription. */
const SEAT_HOLDING_STATUSES: ReadonlySet<EntitlementGrantStatus> = new Set([
  "granted",
  "assigned",
]);

/**
 * countHeldSeats — integer count of seats currently held against a
 * subscription (granted + assigned grants only; expired/revoked release
 * their seats).
 */
export function countHeldSeats(
  subscriptionId: string,
  grants: readonly EntitlementGrant[],
): number {
  let total = 0;
  for (const g of grants) {
    if (g.subscriptionId !== subscriptionId) continue;
    if (!SEAT_HOLDING_STATUSES.has(g.status)) continue;
    total += g.seats;
  }
  return total;
}

/**
 * assignGrant — granted → assigned. Enforces the seat-count invariant:
 * the subscription's seatsTotal may NEVER be over-assigned (exact
 * overshoot reported — never clamped). Assignment is refused on retired
 * or deprecated catalog versions and on inactive/expired subscriptions.
 */
export function assignGrant(
  grant: EntitlementGrant,
  catalogEntry: CatalogSoftwareEntry,
  subscription: Subscription,
  assigneeId: string,
  at: number,
): GrantTransitionResult {
  const tenantCheck = validateTenantScope(grant.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const catalogTenant = validateTenantScope(catalogEntry.tenant);
  if (!catalogTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (catalogTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  if (!assigneeId || assigneeId.length === 0) {
    return { ok: false, reasonCode: "ASSIGNEE_REQUIRED" };
  }
  if (grant.status === "expired" || grant.status === "revoked") {
    return { ok: false, reasonCode: "TERMINAL_STATE" };
  }
  const allowed = GRANT_ALLOWED[grant.status] ?? [];
  if (!allowed.includes("assign")) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  if (catalogEntry.status === "retired") {
    return { ok: false, reasonCode: "CATALOG_RETIRED" };
  }
  if (catalogEntry.status === "deprecated") {
    return { ok: false, reasonCode: "CATALOG_DEPRECATED" };
  }
  if (subscription.status !== "active") {
    return { ok: false, reasonCode: "SUBSCRIPTION_NOT_ACTIVE" };
  }
  if (subscription.validUntil !== null) {
    const untilMs = Date.parse(subscription.validUntil);
    if (!Number.isNaN(untilMs) && untilMs < at) {
      return { ok: false, reasonCode: "SUBSCRIPTION_EXPIRED" };
    }
  }
  const subscriptionId =
    subscription.id.kind === "subscription" ? subscription.id.value : "";
  const held = countHeldSeats(subscriptionId, [grant]);
  if (held > subscription.seatsTotal) {
    return {
      ok: false,
      reasonCode: "SEATS_EXHAUSTED",
    };
  }
  return {
    ok: true,
    next: { ...grant, status: "assigned", assigneeId, assignedAt: at },
  };
}

/**
 * assignGrantWithinPopulation — seat invariant across a POPULATION of
 * grants: (already-held seats) + (this grant's seats) must not exceed
 * seatsTotal. Refusal carries the exact overshoot.
 */
export function assignGrantWithinPopulation(
  grant: EntitlementGrant,
  grants: readonly EntitlementGrant[],
  catalogEntry: CatalogSoftwareEntry,
  subscription: Subscription,
  assigneeId: string,
  at: number,
):
  | {
      readonly ok: true;
      readonly next: EntitlementGrant;
      readonly heldSeatsAfter: number;
    }
  | {
      readonly ok: false;
      readonly reasonCode: GrantReasonCode;
      readonly overshootSeats: number;
    } {
  const base = assignGrant(grant, catalogEntry, subscription, assigneeId, at);
  if (!base.ok) return { ...base, overshootSeats: 0 };
  const subscriptionId =
    subscription.id.kind === "subscription" ? subscription.id.value : "";
  const others = grants.filter((g) => g.id !== grant.id);
  const heldByOthers = countHeldSeats(subscriptionId, others);
  const total = heldByOthers + grant.seats;
  if (total > subscription.seatsTotal) {
    return {
      ok: false,
      reasonCode: "SEATS_EXHAUSTED",
      overshootSeats: total - subscription.seatsTotal,
    };
  }
  return { ok: true, next: base.next, heldSeatsAfter: total };
}

/**
 * revokeGrant — granted/assigned → revoked (terminal). A reason is
 * required; the revocation timestamp is recorded. Revocation releases
 * the grant's seats.
 */
export function revokeGrant(
  grant: EntitlementGrant,
  reason: string,
  at: number,
): GrantTransitionResult {
  const tenantCheck = validateTenantScope(grant.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (grant.status === "expired" || grant.status === "revoked") {
    return { ok: false, reasonCode: "TERMINAL_STATE" };
  }
  const allowed = GRANT_ALLOWED[grant.status] ?? [];
  if (!allowed.includes("revoke")) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  if (!reason || reason.trim().length === 0) {
    return { ok: false, reasonCode: "REVOCATION_REASON_REQUIRED" };
  }
  return {
    ok: true,
    next: {
      ...grant,
      status: "revoked",
      revokedAt: at,
      revokedReason: reason,
      assigneeId: grant.status === "assigned" ? null : grant.assigneeId,
    },
  };
}

/**
 * expireGrant — granted/assigned → expired (terminal). Expiry releases
 * the grant's seats.
 */
export function expireGrant(grant: EntitlementGrant, at: number): GrantTransitionResult {
  const tenantCheck = validateTenantScope(grant.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (grant.status === "expired" || grant.status === "revoked") {
    return { ok: false, reasonCode: "TERMINAL_STATE" };
  }
  const allowed = GRANT_ALLOWED[grant.status] ?? [];
  if (!allowed.includes("expire")) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  return { ok: true, next: { ...grant, status: "expired", expiresAt: at } };
}

// ---------------------------------------------------------------------------
// License compliance — deterministic rule evaluation.
// ---------------------------------------------------------------------------

export type ComplianceViolationCode =
  | "CATALOG_RETIRED_IN_USE"
  | "CATALOG_DEPRECATED_IN_USE"
  | "SUBSCRIPTION_NOT_ACTIVE"
  | "SUBSCRIPTION_EXPIRED"
  | "OVER_ASSIGNED_SEATS";

export interface ComplianceViolation {
  readonly code: ComplianceViolationCode;
  readonly detail: string;
}

export interface LicenseComplianceReport {
  readonly subscriptionId: string;
  readonly tenant: TenantScope;
  readonly compliant: boolean;
  readonly violations: readonly ComplianceViolation[];
  readonly seatsTotal: number;
  readonly seatsHeld: number;
}

/**
 * checkLicenseCompliance — deterministic rule evaluation over a
 * subscription's grant population and the catalog versions in use:
 *   1. CATALOG_RETIRED_IN_USE — any seat-holding grant on a retired version;
 *   2. CATALOG_DEPRECATED_IN_USE — any seat-holding grant on a deprecated version;
 *   3. SUBSCRIPTION_NOT_ACTIVE — the subscription is cancelled/expired;
 *   4. SUBSCRIPTION_EXPIRED — validUntil is in the past at `now`;
 *   5. OVER_ASSIGNED_SEATS — held seats exceed seatsTotal (exact overshoot).
 * The report is a pure projection; no input is mutated.
 */
export function checkLicenseCompliance(
  subscription: Subscription,
  grants: readonly EntitlementGrant[],
  catalog: readonly CatalogSoftwareEntry[],
  now: number,
): LicenseComplianceReport {
  const tenantCheck = validateTenantScope(subscription.tenant);
  const subscriptionId =
    subscription.id.kind === "subscription" ? subscription.id.value : "";
  if (!tenantCheck.ok) {
    return {
      subscriptionId,
      tenant: subscription.tenant,
      compliant: false,
      violations: [],
      seatsTotal: subscription.seatsTotal,
      seatsHeld: 0,
    };
  }
  const violations: ComplianceViolation[] = [];
  const heldGrants = grants.filter(
    (g) => g.subscriptionId === subscriptionId && SEAT_HOLDING_STATUSES.has(g.status),
  );
  const seatsHeld = heldGrants.reduce((acc, g) => acc + g.seats, 0);

  for (const g of heldGrants) {
    const entry = catalog.find(
      (c) => c.id === g.catalogEntryId && c.tenant.tenantId === subscription.tenant.tenantId,
    );
    if (entry === undefined) continue;
    if (entry.status === "retired") {
      violations.push({
        code: "CATALOG_RETIRED_IN_USE",
        detail: `grant ${g.id} holds ${g.seats} seat(s) on retired ${entry.name} ${entry.version}`,
      });
    } else if (entry.status === "deprecated") {
      violations.push({
        code: "CATALOG_DEPRECATED_IN_USE",
        detail: `grant ${g.id} holds ${g.seats} seat(s) on deprecated ${entry.name} ${entry.version}`,
      });
    }
  }
  if (subscription.status !== "active") {
    violations.push({
      code: "SUBSCRIPTION_NOT_ACTIVE",
      detail: `subscription status is ${subscription.status}`,
    });
  }
  if (subscription.validUntil !== null) {
    const untilMs = Date.parse(subscription.validUntil);
    if (!Number.isNaN(untilMs) && untilMs < now) {
      violations.push({
        code: "SUBSCRIPTION_EXPIRED",
        detail: `validUntil ${subscription.validUntil} is before now`,
      });
    }
  }
  if (seatsHeld > subscription.seatsTotal) {
    violations.push({
      code: "OVER_ASSIGNED_SEATS",
      detail: `held ${seatsHeld} seats exceeds ${subscription.seatsTotal} total by ${seatsHeld - subscription.seatsTotal}`,
    });
  }
  return {
    subscriptionId,
    tenant: subscription.tenant,
    compliant: violations.length === 0,
    violations,
    seatsTotal: subscription.seatsTotal,
    seatsHeld,
  };
}
