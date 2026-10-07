/**
 * @fleetos/vendors — Vendor lifecycle (prospective → active → suspended
 * → terminated with reinstatement rules) + service exposure limits.
 *
 * Wave 2 lane C (F220C) operational-truth grade.
 *
 * Laws: A1, A4, A8, A19, A20. Terminated is TERMINAL — no reinstatement
 * from termination. Money is integer minor units; time is an explicit
 * `number` input.
 */

import type { TenantScope, ServiceRelationshipStatus } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// Vendor lifecycle with reinstatement rules.
// ---------------------------------------------------------------------------

export type VendorLifecycleStatus =
  | "prospective"
  | "active"
  | "suspended"
  | "terminated";

export interface VendorLifecycleRecord {
  readonly vendorId: string;
  readonly tenant: TenantScope;
  readonly displayName: string;
  readonly status: VendorLifecycleStatus;
  readonly suspendedReason: string | null;
  readonly terminatedReason: string | null;
  readonly terminatedAt: number | null;
  /** Number of times this vendor was reinstated from suspension. */
  readonly reinstatementCount: number;
}

export type VendorLifecycleCommand =
  | { type: "activate" }
  | { type: "suspend"; reason: string }
  | { type: "reinstate"; reason: string }
  | { type: "terminate"; reason: string; at: number };

export type VendorLifecycleResult =
  | { readonly ok: true; readonly next: VendorLifecycleRecord }
  | { readonly ok: false; readonly reasonCode: VendorLifecycleReasonCode };

export type VendorLifecycleReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "TERMINAL_STATE"
  | "SUSPEND_REASON_REQUIRED"
  | "TERMINATE_REASON_REQUIRED"
  | "REINSTATE_REASON_REQUIRED";

const VENDOR_LIFECYCLE_ALLOWED: Readonly<
  Record<VendorLifecycleStatus, readonly VendorLifecycleCommand["type"][]>
> = {
  prospective: ["activate", "terminate"],
  active: ["suspend", "terminate"],
  suspended: ["reinstate", "terminate"],
  terminated: [],
};

/**
 * transitionVendorLifecycle — prospective → active → suspended →
 * terminated. REINSTATEMENT RULE: a suspended vendor may be reinstated
 * to active with a reason (reinstatementCount increments); a TERMINATED
 * vendor can never be reinstated (TERMINAL_STATE). Every command on a
 * terminated record is refused with TERMINAL_STATE (a richer, more
 * honest code than a generic illegal-transition).
 */
export function transitionVendorLifecycle(
  current: VendorLifecycleRecord,
  command: VendorLifecycleCommand,
): VendorLifecycleResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (current.status === "terminated") {
    return { ok: false, reasonCode: "TERMINAL_STATE" };
  }
  const allowed = VENDOR_LIFECYCLE_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  switch (command.type) {
    case "activate":
      return { ok: true, next: { ...current, status: "active" } };
    case "suspend":
      if (!command.reason || command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "SUSPEND_REASON_REQUIRED" };
      }
      return {
        ok: true,
        next: { ...current, status: "suspended", suspendedReason: command.reason },
      };
    case "reinstate":
      if (!command.reason || command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "REINSTATE_REASON_REQUIRED" };
      }
      return {
        ok: true,
        next: {
          ...current,
          status: "active",
          suspendedReason: null,
          reinstatementCount: current.reinstatementCount + 1,
        },
      };
    case "terminate":
      if (!command.reason || command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "TERMINATE_REASON_REQUIRED" };
      }
      return {
        ok: true,
        next: {
          ...current,
          status: "terminated",
          terminatedReason: command.reason,
          terminatedAt: command.at,
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Service relationship exposure limits — deterministic accounting.
// ---------------------------------------------------------------------------

export interface ServiceExposureLedger {
  readonly vendorId: string;
  readonly tenant: TenantScope;
  readonly relationshipStatus: ServiceRelationshipStatus;
  /** Integer exposure limit in minor units. */
  readonly limitMinorUnits: number;
  /** Integer committed exposure in minor units. */
  readonly committedMinorUnits: number;
}

export type ExposureResult =
  | { readonly ok: true; readonly ledger: ServiceExposureLedger }
  | {
      readonly ok: false;
      readonly reasonCode: ExposureReasonCode;
      readonly overshootMinorUnits: number;
    };

export type ExposureReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "RELATIONSHIP_NOT_ACTIVE"
  | "NEGATIVE_AMOUNT"
  | "ZERO_AMOUNT"
  | "EXPOSURE_LIMIT_EXCEEDED"
  | "RELEASE_EXCEEDS_COMMITTED";

/**
 * commitServiceExposure — new exposure may only be committed against an
 * ACTIVE service relationship, and never beyond the limit (exact
 * overshoot reported — never clamped).
 */
export function commitServiceExposure(
  ledger: ServiceExposureLedger,
  amountMinorUnits: number,
): ExposureResult {
  const tenantCheck = validateTenantScope(ledger.tenant);
  if (!tenantCheck.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", overshootMinorUnits: 0 };
  }
  if (ledger.relationshipStatus !== "active") {
    return { ok: false, reasonCode: "RELATIONSHIP_NOT_ACTIVE", overshootMinorUnits: 0 };
  }
  if (!Number.isInteger(amountMinorUnits)) {
    return { ok: false, reasonCode: "NEGATIVE_AMOUNT", overshootMinorUnits: 0 };
  }
  if (amountMinorUnits === 0) {
    return { ok: false, reasonCode: "ZERO_AMOUNT", overshootMinorUnits: 0 };
  }
  if (amountMinorUnits < 0) {
    return { ok: false, reasonCode: "NEGATIVE_AMOUNT", overshootMinorUnits: 0 };
  }
  const total = ledger.committedMinorUnits + amountMinorUnits;
  if (total > ledger.limitMinorUnits) {
    return {
      ok: false,
      reasonCode: "EXPOSURE_LIMIT_EXCEEDED",
      overshootMinorUnits: total - ledger.limitMinorUnits,
    };
  }
  return { ok: true, ledger: { ...ledger, committedMinorUnits: total } };
}

/**
 * releaseServiceExposure — a release restores the committed exposure
 * EXACTLY; releasing more than was committed is refused.
 */
export function releaseServiceExposure(
  ledger: ServiceExposureLedger,
  amountMinorUnits: number,
): ExposureResult {
  const tenantCheck = validateTenantScope(ledger.tenant);
  if (!tenantCheck.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", overshootMinorUnits: 0 };
  }
  if (!Number.isInteger(amountMinorUnits) || amountMinorUnits <= 0) {
    return { ok: false, reasonCode: "NEGATIVE_AMOUNT", overshootMinorUnits: 0 };
  }
  if (amountMinorUnits > ledger.committedMinorUnits) {
    return {
      ok: false,
      reasonCode: "RELEASE_EXCEEDS_COMMITTED",
      overshootMinorUnits: amountMinorUnits - ledger.committedMinorUnits,
    };
  }
  return {
    ok: true,
    ledger: { ...ledger, committedMinorUnits: ledger.committedMinorUnits - amountMinorUnits },
  };
}
