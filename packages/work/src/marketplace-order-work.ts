/**
 * @fleetos/work — The marketplace order→work link (F361C, Wave 17 lane
 * C; the F360 freeze §3.4, `packages/procurement` + `packages/work`).
 *
 * The work package's share of the §3.4 marketplace order lifecycle:
 * a REPAIR-SERVICE (or purchase-delivery tracking) marketplace order is
 * linked to a REAL work item — the operational job that tracks the
 * service — through the LOCAL structural order reference below (law
 * A20: no cross-boundary implementation import; the acceptance lane is
 * the documented composition site that binds the REAL procurement
 * order records).
 *
 * Documented laws (machine-tested in tests/marketplace-order-work.test.ts):
 *   - LINK GATE: an order may link to ONE work item at a time (a second
 *     link for the same order id refuses ORDER_ALREADY_LINKED — use
 *     detach + relink); the work item must be NON-TERMINAL and belong
 *     to the SAME tenant (fail-closed, law A8).
 *   - SERVICE-COMPLETION ACCEPT GATE: for repair-service links, the
 *     marketplace order may be accepted ONLY when the linked work item
 *     is `done` — `serviceWorkAcceptanceGate` refuses WORK_NOT_COMPLETED
 *     otherwise (the honest gate the composing application must clear
 *     before transitioning the procurement order to accepted).
 *   - DETACH: detaching requires a reason (law A4).
 *   - DETERMINISM: the board read model orders links by orderId
 *     lexical; input order never leaks into the output.
 *
 * Laws: A1, A4, A6 (agents cannot write this truth), A8, A20.
 * Pure deterministic TS; time is an explicit `number` input (epoch ms).
 */

import type { TenantScope } from "./tenant.js";
import { validateTenantScope } from "./tenant.js";
import type { WorkItem } from "./contracts.js";
import { isTerminalWorkItemStatus } from "./contracts.js";

// ---------------------------------------------------------------------------
// LOCAL structural marketplace-order reference (cross-context, law A13) —
// structurally compatible with @fleetos/procurement's
// MarketplaceEquipmentOrder { orderId, tenant }; the acceptance lane
// binds the REAL records at the documented composition site.
// ---------------------------------------------------------------------------

export interface MarketplaceOrderRefLike {
  readonly orderId: string;
  readonly tenant: TenantScope;
}

// ---------------------------------------------------------------------------
// The order→work link.
// ---------------------------------------------------------------------------

export type MarketplaceOrderWorkKind = "purchase-delivery" | "repair-service";

export type MarketplaceOrderWorkLinkStatus = "linked" | "detached";

export interface MarketplaceOrderWorkLink {
  readonly order: MarketplaceOrderRefLike;
  readonly workItemId: string;
  readonly tenant: TenantScope;
  readonly kind: MarketplaceOrderWorkKind;
  readonly status: MarketplaceOrderWorkLinkStatus;
  readonly linkedAt: number;
  readonly detachedAt: number | null;
  readonly detachReason: string | null;
}

export type OrderWorkLinkReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "ORDER_ID_REQUIRED"
  | "WORK_ITEM_ID_REQUIRED"
  | "INVALID_LINK_TIME"
  | "ORDER_ALREADY_LINKED"
  | "WORK_ITEM_TERMINAL"
  | "WORK_ITEM_TENANT_MISMATCH"
  | "DETACH_REASON_REQUIRED"
  | "NOT_LINKED";

export type OrderWorkLinkResult =
  | { readonly ok: true; readonly link: MarketplaceOrderWorkLink }
  | { readonly ok: false; readonly reasonCode: OrderWorkLinkReasonCode };

export interface OrderWorkLinkInput {
  readonly orderId: string;
  readonly workItemId: string;
  readonly kind: MarketplaceOrderWorkKind;
  readonly at: number;
}

/**
 * linkMarketplaceOrderWork — attaches a marketplace order to a REAL
 * work item. One live link per order (ORDER_ALREADY_LINKED refuses a
 * second); the work item must be non-terminal and same-tenant.
 */
export function linkMarketplaceOrderWork(
  tenant: TenantScope,
  input: OrderWorkLinkInput,
  workItem: WorkItem,
  existingLinks: readonly MarketplaceOrderWorkLink[],
): OrderWorkLinkResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (input.orderId.length === 0) return { ok: false, reasonCode: "ORDER_ID_REQUIRED" };
  if (input.workItemId.length === 0) return { ok: false, reasonCode: "WORK_ITEM_ID_REQUIRED" };
  if (!Number.isInteger(input.at) || input.at < 0) {
    return { ok: false, reasonCode: "INVALID_LINK_TIME" };
  }
  const workTenant = validateTenantScope(workItem.tenant);
  if (!workTenant.ok || workTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
    return { ok: false, reasonCode: "WORK_ITEM_TENANT_MISMATCH" };
  }
  if (isTerminalWorkItemStatus(workItem.status)) {
    return { ok: false, reasonCode: "WORK_ITEM_TERMINAL" };
  }
  for (const existing of existingLinks) {
    const linkTenant = validateTenantScope(existing.tenant);
    if (!linkTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (linkTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    if (
      existing.order.orderId === input.orderId &&
      existing.status === "linked" &&
      existing.tenant.tenantId === tenantCheck.scope.tenantId
    ) {
      return { ok: false, reasonCode: "ORDER_ALREADY_LINKED" };
    }
  }
  return {
    ok: true,
    link: {
      order: { orderId: input.orderId, tenant: tenantCheck.scope },
      workItemId: input.workItemId,
      tenant: tenantCheck.scope,
      kind: input.kind,
      status: "linked",
      linkedAt: input.at,
      detachedAt: null,
      detachReason: null,
    },
  };
}

/**
 * detachMarketplaceOrderWork — closes the live link with a REQUIRED
 * reason (law A4). A detached link is terminal; relinking is a NEW link.
 */
export function detachMarketplaceOrderWork(
  current: MarketplaceOrderWorkLink,
  reason: string,
  at: number,
): OrderWorkLinkResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (current.status !== "linked") return { ok: false, reasonCode: "NOT_LINKED" };
  if (reason.trim().length === 0) return { ok: false, reasonCode: "DETACH_REASON_REQUIRED" };
  if (!Number.isInteger(at) || at < 0) return { ok: false, reasonCode: "INVALID_LINK_TIME" };
  return {
    ok: true,
    link: { ...current, status: "detached", detachedAt: at, detachReason: reason },
  };
}

// ---------------------------------------------------------------------------
// The service-completion accept gate (the §3.4 accept composition).
// ---------------------------------------------------------------------------

export type ServiceAcceptanceReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "WORK_ITEM_TENANT_MISMATCH"
  | "WORK_LINK_NOT_LIVE"
  | "WORK_NOT_COMPLETED";

export type ServiceAcceptanceResult =
  | { readonly ok: true; readonly workItemId: string }
  | { readonly ok: false; readonly reasonCode: ServiceAcceptanceReasonCode };

/**
 * serviceWorkAcceptanceGate — for a repair-service link, the marketplace
 * order may be accepted ONLY when the linked work item is `done`.
 * Refuses WORK_NOT_COMPLETED while the service work is outstanding —
 * the honest gate the composing application must clear BEFORE
 * transitioning the procurement order to accepted (the acceptance lane
 * composes BOTH REAL packages through this gate).
 */
export function serviceWorkAcceptanceGate(
  link: MarketplaceOrderWorkLink,
  workItem: WorkItem,
): ServiceAcceptanceResult {
  const tenantCheck = validateTenantScope(link.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const workTenant = validateTenantScope(workItem.tenant);
  if (!workTenant.ok || workTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
    return { ok: false, reasonCode: "WORK_ITEM_TENANT_MISMATCH" };
  }
  if (link.status !== "linked") return { ok: false, reasonCode: "WORK_LINK_NOT_LIVE" };
  if (workItem.status !== "done") return { ok: false, reasonCode: "WORK_NOT_COMPLETED" };
  return { ok: true, workItemId: link.workItemId };
}

// ---------------------------------------------------------------------------
// Deterministic board read model.
// ---------------------------------------------------------------------------

export interface MarketplaceOrderWorkBoardEntry {
  readonly orderId: string;
  readonly workItemId: string;
  readonly kind: MarketplaceOrderWorkKind;
  readonly workStatus: string;
  readonly workTerminal: boolean;
  /** True when the service-completion accept gate is open (work done, link live). */
  readonly acceptGateOpen: boolean;
}

export type MarketplaceOrderWorkBoardResult =
  | {
      readonly ok: true;
      readonly entries: readonly MarketplaceOrderWorkBoardEntry[];
      readonly linkCount: number;
    }
  | { readonly ok: false; readonly reasonCode: "TENANT_SCOPE_MISSING" | "TENANT_MISMATCH" };

/**
 * buildMarketplaceOrderWorkBoard — deterministic per-tenant projection
 * of the live links against the REAL work items: each entry carries the
 * work status, terminal classification and the accept-gate verdict.
 * Ordered by orderId lexical.
 */
export function buildMarketplaceOrderWorkBoard(
  tenant: TenantScope,
  links: readonly MarketplaceOrderWorkLink[],
  workItems: readonly WorkItem[],
): MarketplaceOrderWorkBoardResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const entries: MarketplaceOrderWorkBoardEntry[] = [];
  for (const link of links) {
    const linkTenant = validateTenantScope(link.tenant);
    if (!linkTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (linkTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    const workItem = workItems.find((w) => w.id.value === link.workItemId);
    const workStatus = workItem?.status ?? "unknown";
    entries.push({
      orderId: link.order.orderId,
      workItemId: link.workItemId,
      kind: link.kind,
      workStatus,
      workTerminal: workItem !== undefined ? isTerminalWorkItemStatus(workItem.status) : true,
      acceptGateOpen:
        link.status === "linked" && workItem !== undefined && workItem.status === "done",
    });
  }
  entries.sort((a, b) => a.orderId.localeCompare(b.orderId));
  return { ok: true, entries, linkCount: entries.length };
}
