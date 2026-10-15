/**
 * @fleetos/identity — F370A the authenticated marketplace composition.
 *
 * The F370A packet deliverable 4: the REAL public APIs of the Wave-17
 * lanes — the F361C request/offer/order surfaces, the F361A
 * receipt/enrollment surfaces, the F361B Guardian approval surface —
 * COMPOSED behind the authorization gate. The gate authenticates +
 * authorizes, then DELEGATES to the EXISTING kernels VERBATIM.
 *
 * COMPOSITION LAW (the packet, binding): NEVER re-implement a domain
 * behavior; NEVER edit the domain packages. Every function here is the
 * same thin, honest shape:
 *
 *   gate(authorizeMarketplaceAction) → refused? ⇒ the gate verdict as
 *   data; authorized? ⇒ the EXISTING kernel's own result, returned
 *   verbatim (its refusal codes are NEVER re-mapped, NEVER invented).
 *
 * The action tenant scope for each verb is derived from the operation's
 * OWN tenant context (the tenant the caller is operating as — law A8):
 * the TenantScope of the request/offer/order input, the tenantId of the
 * receipt/enrollment input, or the approval request's tenant. A session
 * of a DIFFERENT tenant is refused by the gate with TENANT_MISMATCH —
 * cross-tenant marketplace access fails closed at the boundary.
 *
 * The three workspace dependencies (procurement/policy/assets) are this
 * composition's mechanical consequence (the F361B/F362 precedent: the
 * composition happens at the composition site, law A20 — no domain
 * package is edited, and nothing here is a second domain truth).
 */

import {
  acknowledgeProviderOrder,
  captureMarketplaceOffer,
  compareMarketplaceOffers,
  draftEquipmentMarketplaceOrder,
  submitEquipmentRequest,
  transitionEquipmentMarketplaceOrder,
  type EquipmentOrderDraftInput,
  type EquipmentOrderDraftResult,
  type EquipmentOrderTransitionResult,
  type EquipmentRequest,
  type EquipmentRequestSubmitInput,
  type EquipmentRequestSubmitResult,
  type MarketplaceEquipmentOrder,
  type MarketplaceOffer,
  type MarketplaceOfferCaptureInput,
  type MarketplaceOfferCaptureResult,
  type MarketplaceOfferComparisonOptions,
  type MarketplaceOfferComparisonResult,
  type MarketplaceOfferDemand,
  type ProviderAckInput,
  type ProviderAckResult,
  type SupplierVerificationLike,
  type TenantScope,
} from "@fleetos/procurement";
import { evaluateMarketplaceOrderApproval } from "@fleetos/policy";
import type {
  MarketplaceOrderApproval,
  MarketplaceOrderApprovalRequest,
  Policy,
} from "@fleetos/policy";
import type {
  ReceiptEnrollCompleteResult,
  ReceiptEnrollOpenResult,
  ReceiptEnrollmentDirectory,
  ReceiptExpectation,
  ReceiptRecordInput,
  ReceiptVerifyLookupResult,
} from "@fleetos/assets";

import {
  authorizeMarketplaceAction,
  type AuthorizedMarketplaceAction,
  type MarketplaceActionKind,
  type RefusedMarketplaceAction,
} from "./marketplace-gate.js";
import type { SessionSigningKey } from "./session.js";

// ---------------------------------------------------------------------------
// The call shape + the composed result union
// ---------------------------------------------------------------------------

/** One authenticated marketplace call: the presented token + the key + now. */
export interface AuthenticatedMarketplaceCall {
  readonly token: string | null;
  readonly key: SessionSigningKey;
  /** Caller-supplied logical time (epoch ms) — the corpus law. */
  readonly now: number;
}

/**
 * The composed result: the gate verdict as DATA, or the domain kernel's
 * own result VERBATIM. `domainRefusal` carries the domain's refusal
 * variant exactly as the kernel produced it (reason codes are never
 * re-mapped — the domain vocabulary is the truth).
 */
export type AuthenticatedMarketplaceResult<R> =
  | { readonly ok: true; readonly authorization: AuthorizedMarketplaceAction; readonly result: R }
  | { readonly ok: false; readonly refusedBy: "gate"; readonly refusal: RefusedMarketplaceAction }
  | { readonly ok: false; readonly refusedBy: "domain"; readonly domainRefusal: R };

/**
 * Run the gate for one verb, then a caller continuation over the domain.
 * `domainOk` decides whether the kernel's own result is a success: the
 * default reads the standard `{ ok: true }` result unions; the Guardian
 * approval is exempted below (its decision — approve OR refuse — is
 * evaluated DATA, never an operational failure, so the composed call
 * always succeeds operationally when the gate authorizes).
 */
function gate<R>(
  call: AuthenticatedMarketplaceCall,
  action: { readonly kind: MarketplaceActionKind; readonly tenantId: string },
  then: (authorization: AuthorizedMarketplaceAction) => R,
  domainOk: (result: R) => boolean = (result) =>
    (result as { readonly ok?: unknown }).ok === true,
): AuthenticatedMarketplaceResult<R> {
  const authorization = authorizeMarketplaceAction({
    token: call.token,
    action,
    key: call.key,
    now: call.now,
  });
  if (!authorization.ok) {
    return { ok: false, refusedBy: "gate", refusal: authorization };
  }
  const result = then(authorization);
  if (domainOk(result)) {
    return { ok: true, authorization, result };
  }
  return { ok: false, refusedBy: "domain", domainRefusal: result };
}

// ---------------------------------------------------------------------------
// F361C request / offer / comparison — the procurement surfaces
// ---------------------------------------------------------------------------

/** The `request` verb: submitEquipmentRequest behind the gate. */
export function authenticatedSubmitEquipmentRequest(
  call: AuthenticatedMarketplaceCall,
  tenant: TenantScope,
  input: EquipmentRequestSubmitInput,
  existing: readonly EquipmentRequest[],
): AuthenticatedMarketplaceResult<EquipmentRequestSubmitResult> {
  return gate(call, { kind: "request", tenantId: tenant.tenantId }, () =>
    submitEquipmentRequest(tenant, input, existing));
}

/** The `offer` verb: captureMarketplaceOffer behind the gate. */
export function authenticatedCaptureMarketplaceOffer(
  call: AuthenticatedMarketplaceCall,
  tenant: TenantScope,
  input: MarketplaceOfferCaptureInput,
): AuthenticatedMarketplaceResult<MarketplaceOfferCaptureResult> {
  return gate(call, { kind: "offer", tenantId: tenant.tenantId }, () =>
    captureMarketplaceOffer(tenant, input));
}

/** The `comparison` verb: compareMarketplaceOffers behind the gate. */
export function authenticatedCompareMarketplaceOffers(
  call: AuthenticatedMarketplaceCall,
  demand: MarketplaceOfferDemand,
  offers: readonly MarketplaceOffer[],
  supplierVerifications: readonly SupplierVerificationLike[],
  options: MarketplaceOfferComparisonOptions,
): AuthenticatedMarketplaceResult<MarketplaceOfferComparisonResult> {
  return gate(call, { kind: "comparison", tenantId: demand.tenant.tenantId }, () =>
    compareMarketplaceOffers(demand, offers, supplierVerifications, options));
}

// ---------------------------------------------------------------------------
// F361C order — draft / place / the manual provider-ack seam
// ---------------------------------------------------------------------------

/** The `order` verb (draft): draftEquipmentMarketplaceOrder behind the gate. */
export function authenticatedDraftEquipmentMarketplaceOrder(
  call: AuthenticatedMarketplaceCall,
  tenant: TenantScope,
  input: EquipmentOrderDraftInput,
): AuthenticatedMarketplaceResult<EquipmentOrderDraftResult> {
  return gate(call, { kind: "order", tenantId: tenant.tenantId }, () =>
    draftEquipmentMarketplaceOrder(tenant, input));
}

/** The `order` verb (place): the §3.4 place transition behind the gate. */
export function authenticatedPlaceEquipmentMarketplaceOrder(
  call: AuthenticatedMarketplaceCall,
  order: MarketplaceEquipmentOrder,
  at: number,
): AuthenticatedMarketplaceResult<EquipmentOrderTransitionResult> {
  return gate(call, { kind: "order", tenantId: order.tenant.tenantId }, () =>
    transitionEquipmentMarketplaceOrder(order, { type: "place", at }));
}

/** The `ack` verb: acknowledgeProviderOrder (the manual seam) behind the gate. */
export function authenticatedAcknowledgeProviderOrder(
  call: AuthenticatedMarketplaceCall,
  order: MarketplaceEquipmentOrder,
  ack: ProviderAckInput,
): AuthenticatedMarketplaceResult<ProviderAckResult> {
  return gate(call, { kind: "ack", tenantId: order.tenant.tenantId }, () =>
    acknowledgeProviderOrder(order, ack));
}

// ---------------------------------------------------------------------------
// F361A receipt / enrollment — the assets surfaces
// ---------------------------------------------------------------------------

/** The `receipt` verb (record): ReceiptEnrollmentDirectory.recordReceipt behind the gate. */
export function authenticatedRecordReceipt(
  call: AuthenticatedMarketplaceCall,
  directory: ReceiptEnrollmentDirectory,
  input: ReceiptRecordInput,
): AuthenticatedMarketplaceResult<ReceiptVerifyLookupResult> {
  return gate(call, { kind: "receipt", tenantId: input.tenantId }, () =>
    directory.recordReceipt(input));
}

/** The `receipt` verb (verify): ReceiptEnrollmentDirectory.verifyReceipt behind the gate. */
export function authenticatedVerifyReceipt(
  call: AuthenticatedMarketplaceCall,
  directory: ReceiptEnrollmentDirectory,
  input: {
    readonly tenantId: string;
    readonly evidenceRef: string;
    readonly expectation: ReceiptExpectation;
    readonly decidedAt: number;
  },
): AuthenticatedMarketplaceResult<ReceiptVerifyLookupResult> {
  return gate(call, { kind: "receipt", tenantId: input.tenantId }, () =>
    directory.verifyReceipt(input));
}

/** The `enrollment` verb (open): ReceiptEnrollmentDirectory.openEnrollment behind the gate. */
export function authenticatedOpenEnrollment(
  call: AuthenticatedMarketplaceCall,
  directory: ReceiptEnrollmentDirectory,
  input: Parameters<ReceiptEnrollmentDirectory["openEnrollment"]>[0],
): AuthenticatedMarketplaceResult<ReceiptEnrollOpenResult> {
  return gate(call, { kind: "enrollment", tenantId: input.tenantId }, () =>
    directory.openEnrollment(input));
}

/** The `enrollment` verb (complete): ReceiptEnrollmentDirectory.completeEnrollment behind the gate. */
export function authenticatedCompleteEnrollment(
  call: AuthenticatedMarketplaceCall,
  directory: ReceiptEnrollmentDirectory,
  input: Parameters<ReceiptEnrollmentDirectory["completeEnrollment"]>[0],
): AuthenticatedMarketplaceResult<ReceiptEnrollCompleteResult> {
  return gate(call, { kind: "enrollment", tenantId: input.tenantId }, () =>
    directory.completeEnrollment(input));
}

// ---------------------------------------------------------------------------
// F361B Guardian approval — the policy surface
// ---------------------------------------------------------------------------

/**
 * The `approval` verb: evaluateMarketplaceOrderApproval (the Guardian
 * approval contract over the EXISTING evaluateCapability) behind the gate.
 */
export function authenticatedEvaluateMarketplaceOrderApproval(
  call: AuthenticatedMarketplaceCall,
  policy: Policy,
  request: MarketplaceOrderApprovalRequest,
): AuthenticatedMarketplaceResult<MarketplaceOrderApproval> {
  return gate(
    call,
    { kind: "approval", tenantId: request.tenant.tenantId },
    () => evaluateMarketplaceOrderApproval(policy, request),
    () => true, // the Guardian decision is data (approve or refuse), never a transport failure
  );
}
