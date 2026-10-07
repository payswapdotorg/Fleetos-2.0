/**
 * @fleetos/procurement — Procurement bounded context public contracts.
 *
 * Wave 1 lane C (F210C) kernel-grade.
 *
 * Law A16 — Exchange semantics: Needs, demands, quotes, orders and
 * fulfillment RETAIN INDEPENDENT CONTRACT IDENTITY. A quote is NEVER an
 * order; a demand is NEVER a need. Each contract has its own branded id
 * kind, its own state machine, and its own validation path.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - quote lifecycle with SUPERSESSION (draft -> submitted ->
 *     accepted/rejected/withdrawn with supersession; old quote closes
 *     with supersededBy ref, never mutated);
 *   - order lifecycle with fulfillment verification hooks;
 *   - matching engine depth: deterministic scoring with TIE-BREAKING
 *     RULES RECORDED IN THE MATCH RECORD;
 *   - GuardianDecisionRefLike seam: every order-creating transition
 *     requires authorization — procurement never self-authorizes (law A5).
 *
 * Laws: A1, A4, A5 (no self-authorization), A7, A8, A16, A19, A20.
 */

export interface TenantScope {
  readonly tenantId: string;
}

export type TenantValidation =
  | { ok: true; scope: TenantScope }
  | { ok: false; reasonCode: TenantReasonCode };

export type TenantReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS";

const TENANT_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateTenantScope(scope: unknown): TenantValidation {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  }
  const candidate = scope as Record<string, unknown>;
  const tenantId = candidate["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  }
  if (tenantId.length > 128) {
    return { ok: false, reasonCode: "TENANT_ID_TOO_LONG" };
  }
  if (!TENANT_PATTERN.test(tenantId)) {
    return { ok: false, reasonCode: "TENANT_ID_INVALID_CHARS" };
  }
  return { ok: true, scope: { tenantId } };
}

// ---------------------------------------------------------------------------
// Independent contract identities (law A16). Each carries a branded id
// `kind`. The types enforce pairwise distinctness at compile time.
// ---------------------------------------------------------------------------

export interface NeedId { readonly kind: "need"; readonly value: string }
export interface DemandId { readonly kind: "procurement-demand"; readonly value: string }
export interface QuoteId { readonly kind: "quote"; readonly value: string }
export interface OrderId { readonly kind: "order"; readonly value: string }
export interface FulfillmentId { readonly kind: "fulfillment"; readonly value: string }

// ---------------------------------------------------------------------------
// Need + ProcurementDemand.
// ---------------------------------------------------------------------------

export interface Need {
  readonly id: NeedId;
  readonly tenant: TenantScope;
  readonly description: string;
  readonly requiredCapabilityTags: readonly string[];
}

export interface ProcurementDemand {
  readonly id: DemandId;
  readonly tenant: TenantScope;
  readonly needId: NeedId;
  readonly quantity: number;
  readonly requiredBy: string;
  readonly capabilityTags: readonly string[];
}

// ---------------------------------------------------------------------------
// Vendor capability record — structural LOCAL seam (no @fleetos/vendors
// runtime import).
// ---------------------------------------------------------------------------

export interface VendorCapabilityRefLike {
  readonly vendorId: string;
  readonly tenant: TenantScope;
  readonly capabilityTags: readonly string[];
  readonly serviceLevel: number;
  readonly unitCost: number;
}

// ---------------------------------------------------------------------------
// Quote — with SUPERSESSION discipline.
// ---------------------------------------------------------------------------

export type QuoteStatus =
  | "draft"
  | "submitted"
  | "accepted"
  | "rejected"
  | "expired"
  | "withdrawn";

export interface Quote {
  readonly id: QuoteId;
  readonly tenant: TenantScope;
  readonly demandId: DemandId;
  readonly vendorId: string;
  readonly unitCost: number;
  readonly totalCost: number;
  readonly status: QuoteStatus;
  readonly submittedAt: string | null;
  readonly expiresAt: string | null;
  /**
   * The quote that this one supersedes (if any). When a vendor submits
   * a revised quote for the same demand, the previous quote is
   * WITHDRAWN with supersededBy pointing at the new quote — NEVER
   * mutated in place. The previous quote's supersededBy field is the
   * new quote's id.
   */
  readonly supersedes: string | null;
  /** True iff this quote has been superseded by a later one. */
  readonly superseded: boolean;
}

// ---------------------------------------------------------------------------
// Order + Fulfillment.
// ---------------------------------------------------------------------------

export type OrderStatus =
  | "draft"
  | "placed"
  | "confirmed"
  | "shipped"
  | "received"
  | "cancelled";

export interface Order {
  readonly id: OrderId;
  readonly tenant: TenantScope;
  readonly quoteId: QuoteId;
  readonly status: OrderStatus;
  /** Authorization that created this order (law A5 — Guardian required). */
  readonly authorization: GuardianDecisionRefLike;
  /** Verification hooks: fulfillment must be verified before received. */
  readonly fulfillmentVerified: boolean;
}

export type FulfillmentStatus =
  | "pending"
  | "in_transit"
  | "delivered"
  | "verified"
  | "failed";

export interface Fulfillment {
  readonly id: FulfillmentId;
  readonly tenant: TenantScope;
  readonly orderId: OrderId;
  readonly status: FulfillmentStatus;
  /** Evidence ref attached when the fulfillment is verified. */
  readonly verificationEvidence: EvidenceRefLike | null;
}

// ---------------------------------------------------------------------------
// LOCAL structural refs (cross-worker seams).
// ---------------------------------------------------------------------------

/**
 * LOCAL structural Guardian decision reference (law A5). The composing
 * application attaches the canonical GuardianDecision (worker B) at F211.
 * Same minimal shape as @fleetos/work's GuardianDecisionRefLike — frozen
 * for F211 composition.
 */
export interface GuardianDecisionRefLike {
  readonly decisionId: string;
  readonly authorized: boolean;
  readonly reasonCode: string;
}

/**
 * LOCAL structural evidence reference (law A13).
 */
export interface EvidenceRefLike {
  readonly evidenceId: string;
  readonly tenantId: string;
}

// ---------------------------------------------------------------------------
// contractsAreDistinct — runtime proof of law A16.
// ---------------------------------------------------------------------------

export function contractsAreDistinct(
  a: { readonly kind: string },
  b: { readonly kind: string },
): boolean {
  return a.kind !== b.kind;
}
