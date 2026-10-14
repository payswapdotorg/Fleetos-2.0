/**
 * @fleetos/actions — the F361B marketplace-order action composition.
 *
 * Frozen law: MARKETPLACE-MVP-FREEZE.md §3.6 (F360) — the Guardian approval
 * contract for consequential marketplace orders, COMPOSED onto the
 * EXISTING consequential-action protocol (law A4:
 * propose -> authorize -> confirm -> dispatch -> execute -> verify ->
 * record -> learn).
 *
 * COMPOSITION LAW (no new authority, no new protocol): this module adds
 * zero new state-machine truth. The marketplace order enters the protocol
 * through the EXISTING `proposeAction` (intent + canonical
 * `cap.marketplace.order` capability from @fleetos/policy), and the
 * approval is applied through the EXISTING `advanceActionState`:
 *
 *   - `authorizeMarketplaceOrderAction` may move the record to
 *     `authorized` ONLY when the marketplace approval decision is
 *     `approve` AND the approval belongs to the record's tenant AND the
 *     EXISTING GuardianDecision it carries is not a BLOCK. A refused
 *     approval NEVER authorizes (the refusal reason
 *     `refused.execute_without_authorization` is the existing law-A4
 *     refusal surface).
 *
 *   - `rejectMarketplaceOrderAction` records the refusal path through the
 *     EXISTING `rejected` terminal state (from `proposed`) so a refused
 *     marketplace order leaves an auditable protocol trail. It refuses
 *     no-ops: an APPROVED order is never silently rejected through the
 *     refusal path (operator cancellation is the existing `cancelled`
 *     transition).
 *
 * Tenant fail-closed (law A8): every entry point first checks the caller's
 * tenant against the record/approval tenants and refuses mismatches with
 * the EXISTING `refused.tenant_mismatch`.
 */

import { MARKETPLACE_ORDER_CAPABILITY_ID, marketplaceOrderCapability } from "@fleetos/policy/marketplace-approval";
import type { MarketplaceOrderApproval, MarketplaceOrderApprovalRequest } from "@fleetos/policy/marketplace-approval";
import type { Capability } from "@fleetos/policy/capability";
import { advanceActionState, proposeAction } from "./index.ts";
import type { ActionRecord, AdvanceResult } from "./index.ts";

/**
 * Propose a consequential marketplace order as an action — the protocol's
 * `proposed` state via the EXISTING `proposeAction`.
 *
 * The intent carries the full marketplace order material as inputs and the
 * canonical `cap.marketplace.order` capability; the idempotency key is
 * tenantId + capabilityId + orderId (the marketplace natural key).
 */
export function proposeMarketplaceOrderAction(
  request: MarketplaceOrderApprovalRequest,
  proposedAt: string,
): { readonly record: ActionRecord; readonly capability: Capability } {
  const capability = marketplaceOrderCapability(request.order);
  const record = proposeAction({
    intentId: `intent-${request.requestId}`,
    tenant: request.tenant,
    capability,
    idempotencyKey: {
      tenantId: request.tenant.tenantId,
      capabilityId: MARKETPLACE_ORDER_CAPABILITY_ID,
      nonce: request.order.orderId,
    },
    inputs: {
      requestId: request.requestId,
      orderId: request.order.orderId,
      category: request.order.category,
      transactionKind: request.order.transactionKind,
      units: request.order.units,
      amountTotal: request.order.amount.total,
      currency: request.order.amount.currency,
      supplierId: request.order.supplierRef.supplierId,
      supplierVerificationRef: request.order.supplierRef.verificationRef,
      offerSnapshotRef: request.order.offerSnapshotRef,
      policyRefs: request.policyRefs.map((r) => `${r.policyKind}:${r.policyId}:${r.version}`).sort(),
    },
    proposedAt,
    proposedBy: request.actor.actorId,
  });
  return { record, capability };
}

/**
 * Apply a marketplace approval to a proposed order action — the protocol's
 * `authorized` state via the EXISTING `advanceActionState`.
 *
 * REFUSES (fail-closed, existing reason codes) when:
 *   - the approval decision is `refuse` — a refused order NEVER reaches
 *     `authorized` (reason `refused.execute_without_authorization`);
 *   - the approval's tenant differs from the record's intent tenant
 *     (reason `refused.tenant_mismatch`);
 *   - the caller's tenant differs from the record's intent tenant
 *     (reason `refused.tenant_mismatch` — advanceActionState's own law);
 *   - the EXISTING state machine refuses the transition (e.g. the record
 *     is already terminal).
 */
export function authorizeMarketplaceOrderAction(
  record: ActionRecord,
  approval: MarketplaceOrderApproval,
  ctx: { readonly at: string; readonly tenantId: string },
): AdvanceResult {
  if (approval.tenantId !== record.intent.tenant.tenantId) {
    return { ok: false, reason: "refused.tenant_mismatch", record };
  }
  if (approval.decision === "refuse") {
    return { ok: false, reason: "refused.execute_without_authorization", record };
  }
  return advanceActionState(record, "authorized", {
    at: ctx.at,
    authorization: approval.guardianDecision,
    tenantId: ctx.tenantId,
  });
}

/**
 * Record a REFUSED marketplace approval through the protocol's `rejected`
 * state via the EXISTING `advanceActionState` — the auditable refusal trail.
 *
 * REFUSES when:
 *   - the approval's tenant differs from the record's intent tenant
 *     (reason `refused.tenant_mismatch`);
 *   - the approval decision is `approve` — an approved order is never
 *     silently rejected through the refusal path (operator cancellation
 *     is the existing `cancelled` transition; reason
 *     `refused.no_op_transition`);
 *   - the caller's tenant differs (reason `refused.tenant_mismatch`).
 */
export function rejectMarketplaceOrderAction(
  record: ActionRecord,
  approval: MarketplaceOrderApproval,
  ctx: { readonly at: string; readonly tenantId: string },
): AdvanceResult {
  if (approval.tenantId !== record.intent.tenant.tenantId) {
    return { ok: false, reason: "refused.tenant_mismatch", record };
  }
  if (approval.decision !== "refuse") {
    return { ok: false, reason: "refused.no_op_transition", record };
  }
  return advanceActionState(record, "rejected", { at: ctx.at, tenantId: ctx.tenantId });
}
