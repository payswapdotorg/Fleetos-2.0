/**
 * @fleetos/policy — the F361B marketplace order Guardian approval contract.
 *
 * Frozen law: docs/product/MARKETPLACE-MVP-FREEZE.md §3.6 (F360) — "Guardian
 * request for consequential orders with limit checks; advisory
 * recommendations never self-authorize (existing law)".
 *
 * COMPOSITION LAW (no new authority truth): this module adds ZERO new
 * authority. The single authorization path is the EXISTING
 * `evaluateCapability` reference Guardian (guardian.ts, law A5) — invoked
 * here over the canonical `cap.marketplace.order` Capability. The
 * marketplace layer contributes only (a) the typed request, (b) limit
 * checks (amount / category / currency / units / policy references /
 * supplier-verification reference / offer-snapshot reference), and (c) a
 * deterministic mapping of the Guardian verdict + limit findings into an
 * approve/refuse decision with machine-stable reason codes.
 *
 * Advisory law (asserted): `MarketplaceAdvisoryRecommendation` is INPUT
 * DATA ONLY. It has NO authority field; the approval's only authorization
 * source is `authorityTrace.source === "guardian.evaluateCapability"`.
 * The advisory is EXCLUDED from the approval-digest inputs, so attaching
 * one can never alter verdict, reason, or digest — machine-asserted by
 * `assertAdvisoryNeverAuthorizes` (a REAL public API) and by tests.
 *
 * Tenant law (A8): tenant isolation is adjudicated by the Guardian over
 * the composed capability (block.cross_tenant) and mirrored here as the
 * machine-stable marketplace refusal `refuse.cross_tenant`.
 *
 * Money boundary (F360 §1): purchase + repair-service ONLY. Rental/lease
 * are typed as follow-on contract states and are ALWAYS refused with
 * `refuse.kind_not_in_pilot_scope` — recorded in the contract, never
 * implemented.
 *
 * Determinism: pure functions, no I/O, no clock, no randomness. Same
 * inputs => byte-identical decision (incl. approvalDigest).
 */

import type { Capability, AuthorityKind, TenantScopeLike } from "./capability.ts";
import type { GuardianContext, GuardianDecision, Policy } from "./policy.ts";
import { evaluateCapability } from "./guardian.ts";

/** The canonical marketplace order capability id (law A15 vocabulary). */
export const MARKETPLACE_ORDER_CAPABILITY_ID = "cap.marketplace.order" as const;

/** Frozen pilot categories (F360 §1: laptops + printers/photocopiers). */
export type MarketplaceCategory = "laptops" | "printers";

/** Frozen pilot transaction kinds; rental/lease are typed follow-on states. */
export type MarketplaceTransactionKind =
  | "purchase"
  | "repair-service"
  | "rental"
  | "lease";

/** The kinds that may actually be approved in the F360 frozen MVP. */
export const MARKETPLACE_PILOT_TRANSACTION_KINDS: readonly MarketplaceTransactionKind[] = [
  "purchase",
  "repair-service",
];

/** Reference to a governing policy document the order cites (limit check). */
export interface MarketplacePolicyRef {
  readonly policyKind: "procurement" | "budget" | "category";
  readonly policyId: string;
  readonly version: string;
}

/**
 * Advisory recommendation — INPUT DATA ONLY, never an authorization.
 *
 * Law (F360 §3.6 + mission §6): an advisory (predictive model, supplier
 * score, agent suggestion) can NEVER authorize a consequential order.
 * There is no authority field in this type at all, and the approval
 * digest excludes the advisory entirely.
 */
export interface MarketplaceAdvisoryRecommendation {
  readonly source: string;
  readonly recommendation: "approve" | "refuse" | "defer";
  readonly rationale: string;
}

/** The consequential marketplace order being submitted for approval. */
export interface MarketplaceOrder {
  readonly orderId: string;
  readonly category: MarketplaceCategory;
  readonly transactionKind: MarketplaceTransactionKind;
  readonly units: number;
  readonly amount: { readonly total: number; readonly currency: string };
  /** Supplier reference — the supplier profile is Worker C's context; B
   *  only requires that a verification REFERENCE exists (never adjudicates
   *  supplier truth). */
  readonly supplierRef: {
    readonly supplierId: string;
    readonly verificationRef: string;
  };
  /** Reference to the retained frozen offer snapshot (evidence contract). */
  readonly offerSnapshotRef: string;
}

/** The limit set the request is checked against. */
export interface MarketplaceApprovalLimits {
  /** Per-transaction-kind amount ceiling, in `currency`. */
  readonly amountCeiling: Readonly<Record<MarketplaceTransactionKind, number>>;
  readonly currency: string;
  readonly allowedCategories: readonly MarketplaceCategory[];
  readonly maxUnitsPerOrder: number;
  readonly requiredPolicyKinds: readonly MarketplacePolicyRef["policyKind"][];
}

/** The typed Guardian approval request for a consequential marketplace order. */
export interface MarketplaceOrderApprovalRequest {
  readonly requestId: string;
  readonly tenant: TenantScopeLike;
  readonly actor: {
    readonly actorId: string;
    readonly authority: readonly AuthorityKind[];
    readonly isAutonomous: boolean;
  };
  readonly order: MarketplaceOrder;
  readonly limits: MarketplaceApprovalLimits;
  /** Policy documents the order cites (limit check: required kinds present). */
  readonly policyRefs: readonly MarketplacePolicyRef[];
  readonly advisory?: MarketplaceAdvisoryRecommendation;
  readonly degraded?: boolean;
}

/** Machine-stable limit-check ids, in deterministic evaluation order. */
export type MarketplaceLimitCheckId =
  | "check.transaction_kind_in_scope"
  | "check.currency_is_pilot"
  | "check.amount_within_ceiling"
  | "check.category_allowed"
  | "check.units_within_max"
  | "check.policy_references_present"
  | "check.supplier_verification_ref_present"
  | "check.offer_snapshot_evidence_present";

/** One limit check's result — every check is always evaluated + reported. */
export interface MarketplaceLimitFinding {
  readonly check: MarketplaceLimitCheckId;
  readonly passed: boolean;
  readonly observed: string;
  readonly limit: string;
}

/** Machine-stable approval reason codes — never localized, never reordered. */
export type MarketplaceApprovalReasonCode =
  | "approve.within_limits"
  | "approve.guardian_warned"
  | "refuse.kind_not_in_pilot_scope"
  | "refuse.currency_not_pilot"
  | "refuse.amount_over_limit"
  | "refuse.category_not_allowed"
  | "refuse.units_over_limit"
  | "refuse.missing_policy_reference"
  | "refuse.missing_supplier_verification_ref"
  | "refuse.missing_offer_snapshot_evidence"
  | "refuse.cross_tenant"
  | "refuse.self_authorization"
  | "refuse.actor_missing_human_approval"
  | "refuse.guardian_refused";

/** The ONLY authorization source for a marketplace order (type-level law). */
export interface MarketplaceAuthorityTrace {
  readonly source: "guardian.evaluateCapability";
  readonly capabilityId: string;
  readonly guardianDecisionDigest: string;
}

/** The approval decision returned by the Guardian approval contract. */
export interface MarketplaceOrderApproval {
  readonly approvalId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly orderId: string;
  readonly decision: "approve" | "refuse";
  readonly reasonCode: MarketplaceApprovalReasonCode;
  /** The composed EXISTING Guardian decision — verbatim (the authority truth). */
  readonly guardianDecision: GuardianDecision;
  readonly limitFindings: readonly MarketplaceLimitFinding[];
  readonly authorityTrace: MarketplaceAuthorityTrace;
  readonly conditions: readonly string[];
  /** Stable digest of the decision inputs — the ADVISORY is excluded by law. */
  readonly approvalDigest: string;
}

/**
 * Build the canonical marketplace order Capability (law A15 vocabulary).
 *
 * Risk is `high` for every marketplace order: each commits money to an
 * external supplier (order + invoice-record + manual settlement boundary —
 * never payment/escrow/credit). Deterministic, no amount-derived risk.
 * The tenant is carried by the GuardianContext at evaluation time.
 */
export function marketplaceOrderCapability(order: MarketplaceOrder): Capability {
  return {
    id: MARKETPLACE_ORDER_CAPABILITY_ID,
    category: "execute.commerce",
    risk: "high",
    requiredAuthority: ["human.approval"],
    tenantScope: "single",
    resourceScope: { vendorIds: [order.supplierRef.supplierId] },
    sideEffects: [
      {
        kind: "domain.write",
        target: `marketplace-order:${order.orderId}`,
        reversible: false,
        description: "place a consequential marketplace equipment order (order + invoice-record; manual settlement only)",
      },
    ],
    idempotency: {
      supported: true,
      keyShape: ["tenantId", "orderId"],
      replayWindowSeconds: 86_400,
    },
    verification: { kind: "external.receipt" },
    inputs: [
      "orderId",
      "category",
      "transactionKind",
      "units",
      "amountTotal",
      "currency",
      "supplierId",
      "offerSnapshotRef",
    ],
    outputs: ["approvalId", "approvalDecision", "approvalReasonCode"],
    description: "Place a consequential marketplace equipment order (F360 frozen pilot: purchase + repair-service)",
    version: "1.0.0",
  };
}

/** Deterministic first-failure mapping from limit findings to a reason code. */
function limitRefusalReason(findings: readonly MarketplaceLimitFinding[]): MarketplaceApprovalReasonCode {
  const failed = findings.find((f) => !f.passed);
  switch (failed?.check) {
    case "check.transaction_kind_in_scope": return "refuse.kind_not_in_pilot_scope";
    case "check.currency_is_pilot": return "refuse.currency_not_pilot";
    case "check.amount_within_ceiling": return "refuse.amount_over_limit";
    case "check.category_allowed": return "refuse.category_not_allowed";
    case "check.units_within_max": return "refuse.units_over_limit";
    case "check.policy_references_present": return "refuse.missing_policy_reference";
    case "check.supplier_verification_ref_present": return "refuse.missing_supplier_verification_ref";
    case "check.offer_snapshot_evidence_present": return "refuse.missing_offer_snapshot_evidence";
    default: return "refuse.guardian_refused";
  }
}

/** Evaluate ALL limit checks — deterministic order, full audit trail. */
function evaluateLimits(
  order: MarketplaceOrder,
  limits: MarketplaceApprovalLimits,
  policyRefs: readonly MarketplacePolicyRef[],
): readonly MarketplaceLimitFinding[] {
  const findings: MarketplaceLimitFinding[] = [];
  findings.push({
    check: "check.transaction_kind_in_scope",
    passed: MARKETPLACE_PILOT_TRANSACTION_KINDS.includes(order.transactionKind),
    observed: order.transactionKind,
    limit: MARKETPLACE_PILOT_TRANSACTION_KINDS.join("|"),
  });
  findings.push({
    check: "check.currency_is_pilot",
    passed: order.amount.currency === limits.currency,
    observed: order.amount.currency,
    limit: limits.currency,
  });
  const ceiling = limits.amountCeiling[order.transactionKind] ?? 0;
  findings.push({
    check: "check.amount_within_ceiling",
    passed: order.amount.total >= 0 && order.amount.total <= ceiling,
    observed: String(order.amount.total),
    limit: String(ceiling),
  });
  findings.push({
    check: "check.category_allowed",
    passed: limits.allowedCategories.includes(order.category),
    observed: order.category,
    limit: limits.allowedCategories.join("|"),
  });
  findings.push({
    check: "check.units_within_max",
    passed: order.units >= 1 && order.units <= limits.maxUnitsPerOrder,
    observed: String(order.units),
    limit: String(limits.maxUnitsPerOrder),
  });
  const presentKinds = new Set(policyRefs.filter((r) => r.policyId !== "" && r.version !== "").map((r) => r.policyKind));
  const missingKinds = limits.requiredPolicyKinds.filter((k) => !presentKinds.has(k));
  findings.push({
    check: "check.policy_references_present",
    passed: missingKinds.length === 0,
    observed: [...presentKinds].sort().join("|"),
    limit: limits.requiredPolicyKinds.slice().sort().join("|"),
  });
  findings.push({
    check: "check.supplier_verification_ref_present",
    passed: order.supplierRef.verificationRef !== "",
    observed: order.supplierRef.verificationRef,
    limit: "non-empty supplier verification reference (supplier truth is Worker C's context)",
  });
  findings.push({
    check: "check.offer_snapshot_evidence_present",
    passed: order.offerSnapshotRef !== "",
    observed: order.offerSnapshotRef,
    limit: "non-empty retained offer-snapshot evidence reference",
  });
  return findings;
}

/**
 * Evaluate a marketplace order approval request.
 *
 * Adjudication order (deterministic):
 *  1. Compose the canonical capability and call the EXISTING Guardian
 *     (`evaluateCapability`) — the SOLE authority (law A5).
 *  2. Guardian BLOCK => refuse (cross_tenant / self_authorization mirror
 *     the Guardian reason verbatim; other blocks => refuse.guardian_refused).
 *  3. Guardian REQUIRE_APPROVAL => the request IS the approval path: it
 *     authorizes only when the requesting actor holds `human.approval`
 *     (the EXISTING AuthorityKind — no new authority kind is invented).
 *  4. Limit checks (ALL evaluated regardless; full audit trail). Any
 *     failure => refuse with the first failing check's reason code.
 *  5. Otherwise approve (ALLOW => within_limits; WARN => guardian_warned).
 *
 * The advisory NEVER participates: it is read by NO branch above and is
 * excluded from the digest inputs.
 */
export function evaluateMarketplaceOrderApproval(
  policy: Policy,
  request: MarketplaceOrderApprovalRequest,
): MarketplaceOrderApproval {
  const capability = marketplaceOrderCapability(request.order);
  const ctx: GuardianContext = {
    tenant: request.tenant,
    capability,
    actor: {
      actorId: request.actor.actorId,
      authority: request.actor.authority,
      isAutonomous: request.actor.isAutonomous,
    },
    degraded: request.degraded ?? false,
  };
  const guardianDecision = evaluateCapability(policy, capability, ctx);
  const limitFindings = evaluateLimits(request.order, request.limits, request.policyRefs);
  const limitsPass = limitFindings.every((f) => f.passed);

  let decision: "approve" | "refuse";
  let reasonCode: MarketplaceApprovalReasonCode;
  const conditions: string[] = [`guardian.verdict=${guardianDecision.verdict}`, `guardian.reason=${guardianDecision.reasonCode}`];

  if (guardianDecision.verdict === "BLOCK") {
    decision = "refuse";
    reasonCode = guardianDecision.reasonCode === "block.cross_tenant"
      ? "refuse.cross_tenant"
      : guardianDecision.reasonCode === "block.self_authorization"
        ? "refuse.self_authorization"
        : "refuse.guardian_refused";
    conditions.push("guardian blocked the composed capability — no marketplace authority exists outside the Guardian");
  } else if (guardianDecision.verdict === "REQUIRE_APPROVAL" && !request.actor.authority.includes("human.approval")) {
    decision = "refuse";
    reasonCode = "refuse.actor_missing_human_approval";
    conditions.push("guardian requires approval and the requesting actor lacks human.approval authority");
  } else if (!limitsPass) {
    decision = "refuse";
    reasonCode = limitRefusalReason(limitFindings);
    conditions.push("limit check failed — fail-closed");
  } else {
    decision = "approve";
    reasonCode = guardianDecision.verdict === "WARN" ? "approve.guardian_warned" : "approve.within_limits";
    conditions.push("guardian authorized the composed capability and every limit check passed");
  }

  // Digest inputs — the ADVISORY is deliberately excluded (the law).
  const digestParts = [
    `request=${request.requestId}`,
    `tenant=${request.tenant.tenantId}`,
    `actor=${request.actor.actorId}:auto=${request.actor.isAutonomous ? "1" : "0"}`,
    `order=${request.order.orderId}:${request.order.transactionKind}:${request.order.category}`,
    `amount=${request.order.amount.total}:${request.order.amount.currency}`,
    `units=${request.order.units}`,
    `supplier=${request.order.supplierRef.supplierId}:${request.order.supplierRef.verificationRef}`,
    `offer=${request.order.offerSnapshotRef}`,
    `limits=${JSON.stringify(request.limits)}`,
    `policyRefs=${JSON.stringify([...request.policyRefs].sort((a, b) => a.policyId < b.policyId ? -1 : 1))}`,
    `guardian=${guardianDecision.decisionDigest}`,
    `decision=${decision}`,
    `reason=${reasonCode}`,
  ];
  const approvalDigest = digestParts.join("|");

  return {
    approvalId: `mpa-${approvalDigest.slice(0, 12)}`,
    requestId: request.requestId,
    tenantId: request.tenant.tenantId,
    orderId: request.order.orderId,
    decision,
    reasonCode,
    guardianDecision,
    limitFindings,
    authorityTrace: {
      source: "guardian.evaluateCapability",
      capabilityId: capability.id,
      guardianDecisionDigest: guardianDecision.decisionDigest,
    },
    conditions,
    approvalDigest,
  };
}

/**
 * The advisory law as a REAL public API: evaluate the same request with and
 * without an advisory attached and machine-prove the decision is
 * byte-identical (verdict, reason, digest). Advisory recommendations NEVER
 * self-authorize — they cannot even influence the decision.
 */
export function assertAdvisoryNeverAuthorizes(
  policy: Policy,
  request: MarketplaceOrderApprovalRequest,
  advisory: MarketplaceAdvisoryRecommendation,
): {
  readonly holds: boolean;
  readonly withAdvisory: MarketplaceOrderApproval;
  readonly withoutAdvisory: MarketplaceOrderApproval;
} {
  const withAdvisory = evaluateMarketplaceOrderApproval(policy, { ...request, advisory });
  const withoutAdvisory = evaluateMarketplaceOrderApproval(policy, { ...request, advisory: undefined });
  const holds =
    withAdvisory.decision === withoutAdvisory.decision &&
    withAdvisory.reasonCode === withoutAdvisory.reasonCode &&
    withAdvisory.approvalDigest === withoutAdvisory.approvalDigest;
  return { holds, withAdvisory, withoutAdvisory };
}
