/**
 * @fleetos/tenancy — Wave 0 contracts.
 *
 * Pure TypeScript domain contracts ONLY. No I/O, no servers, no databases.
 *
 * Owns (per spec/BOUNDED-CONTEXTS.md "Identity & Tenancy"):
 *   - tenant lifecycle as typed state transitions;
 *   - tenant isolation vocabulary.
 *
 * NEVER owns domain resource truth. Tenancy knows tenants exist; it does not
 * know what assets/observations/missions live inside them.
 *
 * Cross-worker seam: this package defines a LOCAL structural `TenantIdLike`
 * so it does NOT import `@fleetos/identity` (the worker-converged seam happens
 * at F201). The shape is structurally compatible with `@fleetos/identity`'s
 * branded `TenantId`.
 */

// ---------------------------------------------------------------------------
// TenantIdLike — structural seam; structurally compatible with
// @fleetos/identity's branded TenantId (both are strings with the same brand
// symbol at runtime the brand is erased).
// ---------------------------------------------------------------------------

export type TenantIdLike = string;

// ---------------------------------------------------------------------------
// Tenant lifecycle — typed state transitions only.
// ---------------------------------------------------------------------------

export type TenantState =
  | "provisioning"
  | "active"
  | "suspended"
  | "closing"
  | "closed";

export type TenantLifecycleCommandKind =
  | "provision"
  | "suspend"
  | "resume"
  | "close";

export interface TenantLifecycleCommand {
  readonly kind: TenantLifecycleCommandKind;
  readonly reason?: string;
  readonly initiatedAt: number;
}

// Machine-stable rejection codes — never reused, never ambiguous.
export type TenantTransitionRejectionCode =
  | "illegal-transition"
  | "already-in-target-state"
  | "unknown-command"
  | "missing-reason";

export type TenantTransitionResult =
  | { readonly ok: true; readonly from: TenantState; readonly to: TenantState }
  | { readonly ok: false; readonly reason: TenantTransitionRejectionCode };

// Pure transition table. Every legal (state, command) pair maps to a single
// next state. Any pair not in the table is illegal-by-construction.
const TRANSITIONS: Readonly<Record<
  TenantState,
  Partial<Record<TenantLifecycleCommandKind, TenantState>>
>> = {
  provisioning: { provision: "active" },
  active: { suspend: "suspended", close: "closing" },
  suspended: { resume: "active", close: "closing" },
  closing: { close: "closed" },
  closed: {},
};

export function evaluateTenantTransition(
  current: TenantState,
  command: TenantLifecycleCommand,
): TenantTransitionResult {
  // First, classify the command. Unknown kinds (strings outside the union at
  // runtime, e.g. via unsafe casts) are rejected — never silently accepted.
  const knownKinds: ReadonlyArray<TenantLifecycleCommandKind> = [
    "provision",
    "suspend",
    "resume",
    "close",
  ];
  if (!knownKinds.includes(command.kind)) {
    return { ok: false, reason: "unknown-command" };
  }

  const table = TRANSITIONS[current];
  const next = table?.[command.kind];

  if (next === undefined) {
    // Some commands are no-ops when current state already matches intent.
    if (
      (command.kind === "provision" && current === "active") ||
      (command.kind === "suspend" && current === "suspended") ||
      (command.kind === "close" && current === "closed")
    ) {
      return { ok: false, reason: "already-in-target-state" };
    }
    return { ok: false, reason: "illegal-transition" };
  }

  // Suspend requires a non-empty reason — audit trail requirement.
  if (command.kind === "suspend" && (command.reason === undefined || command.reason === "")) {
    return { ok: false, reason: "missing-reason" };
  }

  return { ok: true, from: current, to: next };
}

// ---------------------------------------------------------------------------
// Tenant isolation vocabulary.
//
// Pure description of the tenant isolation invariant (A8). The application
// boundary enforces it; this contract is the typed vocabulary it enforces.
// ---------------------------------------------------------------------------

export interface TenantBoundary {
  readonly tenantId: TenantIdLike;
  readonly readCrossTenant: false;
  readonly writeCrossTenant: false;
}

export interface TenantIsolationRule {
  readonly tenantId: TenantIdLike;
  readonly readCrossTenant: false;
  readonly writeCrossTenant: false;
  readonly enforcedAt: number;
}

export function makeTenantBoundary(tenantId: TenantIdLike): TenantBoundary {
  if (typeof tenantId !== "string" || tenantId === "") {
    throw new TypeError("TenantBoundary requires non-empty tenantId");
  }
  return { tenantId, readCrossTenant: false, writeCrossTenant: false };
}

// Pure check: does the proposed (callerTenant, targetTenant) pair respect
// isolation? Always fails closed on any cross-tenant access attempt.
export function assertSameTenant(
  callerTenant: TenantIdLike,
  targetTenant: TenantIdLike,
): { readonly ok: true } | { readonly ok: false; readonly reason: "cross-tenant-forbidden" } {
  if (callerTenant === "" || targetTenant === "") return { ok: false, reason: "cross-tenant-forbidden" };
  if (callerTenant !== targetTenant) return { ok: false, reason: "cross-tenant-forbidden" };
  return { ok: true };
}
