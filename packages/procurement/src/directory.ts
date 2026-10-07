/**
 * @fleetos/procurement — Audit event contract + ProcurementDirectory +
 * repository port + in-memory reference (kernel grade).
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type {
  Quote,
  QuoteId,
  Order,
  OrderId,
  Fulfillment,
  FulfillmentId,
  ProcurementDemand,
  DemandId,
  GuardianDecisionRefLike,
} from "./contracts.js";
import {
  transitionQuote,
  supersedeQuote,
  createOrder,
  transitionOrder,
  transitionFulfillment,
  type QuoteTransitionCommand,
  type QuoteTransition,
  type SupersedeQuoteResult,
} from "./lifecycle.js";
import { matchVendors, type VendorMatch } from "./matching.js";

// ---------------------------------------------------------------------------
// Audit events.
// ---------------------------------------------------------------------------

export type AuditEventKind =
  | "procurement.quote-transitioned"
  | "procurement.quote-superseded"
  | "procurement.order-created"
  | "procurement.order-transitioned"
  | "procurement.fulfillment-transitioned"
  | "procurement.match-computed";

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly occurredAt: string;
  readonly digest: string;
  readonly quoteId?: string | null;
  readonly orderId?: string | null;
  readonly fulfillmentId?: string | null;
  readonly demandId?: string | null;
  readonly fromStatus?: string | null;
  readonly toStatus?: string | null;
  readonly reasonCode?: string | null;
  readonly matchCount?: number | null;
  readonly authorizationDecisionId?: string | null;
}

export function computeAuditDigest(inputs: {
  readonly kind: AuditEventKind;
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly entityId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
}): string {
  const parts = [
    inputs.kind,
    inputs.tenantId,
    inputs.occurredAt,
    inputs.entityId,
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
  readonly occurredAt: string;
  readonly entityId: string;
  readonly fromStatus?: string | null;
  readonly toStatus?: string | null;
  readonly quoteId?: string | null;
  readonly orderId?: string | null;
  readonly fulfillmentId?: string | null;
  readonly demandId?: string | null;
  readonly reasonCode?: string | null;
  readonly matchCount?: number | null;
  readonly authorizationDecisionId?: string | null;
}): AuditEvent {
  const digest = computeAuditDigest({
    kind: inputs.kind,
    tenantId: inputs.tenant.tenantId,
    occurredAt: inputs.occurredAt,
    entityId: inputs.entityId,
    fromStatus: inputs.fromStatus ?? null,
    toStatus: inputs.toStatus ?? null,
  });
  return {
    kind: inputs.kind,
    tenant: inputs.tenant,
    occurredAt: inputs.occurredAt,
    digest,
    quoteId: inputs.quoteId ?? null,
    orderId: inputs.orderId ?? null,
    fulfillmentId: inputs.fulfillmentId ?? null,
    demandId: inputs.demandId ?? null,
    fromStatus: inputs.fromStatus ?? null,
    toStatus: inputs.toStatus ?? null,
    reasonCode: inputs.reasonCode ?? null,
    matchCount: inputs.matchCount ?? null,
    authorizationDecisionId: inputs.authorizationDecisionId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository port. In-memory reference implementation lives in
// ./in-memory.ts to keep this file under the 400-line oxlint limit.
// ---------------------------------------------------------------------------

export interface ProcurementRepositoryPort {
  loadQuote(tenant: TenantScope, id: QuoteId): Promise<Quote | null>;
  storeQuote(tenant: TenantScope, quote: Quote): Promise<void>;
  loadOrder(tenant: TenantScope, id: OrderId): Promise<Order | null>;
  storeOrder(tenant: TenantScope, order: Order): Promise<void>;
  loadFulfillment(tenant: TenantScope, id: FulfillmentId): Promise<Fulfillment | null>;
  storeFulfillment(tenant: TenantScope, fulfillment: Fulfillment): Promise<void>;
  listQuotesForDemand(tenant: TenantScope, demandId: DemandId): Promise<readonly Quote[]>;
}

// ---------------------------------------------------------------------------
// ProcurementDirectory.
// ---------------------------------------------------------------------------

export type DirectoryReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "QUOTE_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "FULFILLMENT_NOT_FOUND"
  | "ILLEGAL_TRANSITION"
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "AUTHORIZATION_TENANT_MISMATCH"
  | "VERIFICATION_EVIDENCE_REQUIRED"
  | "VERIFICATION_EVIDENCE_TENANT_MISMATCH";

export interface DirectorySuccess {
  readonly ok: true;
  readonly quote?: Quote;
  readonly order?: Order;
  readonly fulfillment?: Fulfillment;
  readonly matches?: readonly VendorMatch[];
  readonly auditEvents: readonly AuditEvent[];
}

export interface DirectoryRefusal {
  readonly ok: false;
  readonly reasonCode: DirectoryReasonCode;
  readonly auditEvents?: readonly AuditEvent[];
}

export type DirectoryResult = DirectorySuccess | DirectoryRefusal;

export interface ProcurementDirectory {
  transitionQuote(
    tenant: TenantScope,
    id: QuoteId,
    command: QuoteTransitionCommand,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  supersedeQuote(
    tenant: TenantScope,
    previousQuoteId: QuoteId,
    newQuoteId: QuoteId,
    newVendorId: string,
    newUnitCost: number,
    newTotalCost: number,
    newSubmittedAt: string,
    newExpiresAt: string,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  /**
   * Create an order from an accepted quote. REQUIRES a Guardian
   * authorization (law A5 — procurement never self-authorizes).
   */
  createOrder(
    tenant: TenantScope,
    orderId: OrderId,
    quoteId: QuoteId,
    authorization: GuardianDecisionRefLike,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  matchVendors(
    tenant: TenantScope,
    demand: ProcurementDemand,
    vendors: readonly { readonly vendorId: string; readonly tenant: TenantScope; readonly capabilityTags: readonly string[]; readonly serviceLevel: number; readonly unitCost: number }[],
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  getQuote(tenant: TenantScope, id: QuoteId): Promise<Quote | null>;
  getOrder(tenant: TenantScope, id: OrderId): Promise<Order | null>;
}

export function createProcurementDirectory(
  repository: ProcurementRepositoryPort,
): ProcurementDirectory {
  return new DirectoryImpl(repository);
}

class DirectoryImpl implements ProcurementDirectory {
  constructor(private readonly repo: ProcurementRepositoryPort) {}

  async transitionQuote(
    tenant: TenantScope,
    id: QuoteId,
    command: QuoteTransitionCommand,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const current = await this.repo.loadQuote(tenant, id);
    if (current === null) return refuse("QUOTE_NOT_FOUND");
    if (current.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const result = transitionQuote(current, command);
    if (!result.ok) return refuse(result.reasonCode);
    await this.repo.storeQuote(tenant, result.next);
    const audit = makeAuditEvent({
      kind: "procurement.quote-transitioned",
      tenant,
      occurredAt: options.occurredAt,
      entityId: id.value,
      quoteId: id.value,
      fromStatus: current.status,
      toStatus: result.next.status,
    });
    return { ok: true, quote: result.next, auditEvents: [audit] };
  }

  async supersedeQuote(
    tenant: TenantScope,
    previousQuoteId: QuoteId,
    newQuoteId: QuoteId,
    newVendorId: string,
    newUnitCost: number,
    newTotalCost: number,
    newSubmittedAt: string,
    newExpiresAt: string,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const previous = await this.repo.loadQuote(tenant, previousQuoteId);
    if (previous === null) return refuse("QUOTE_NOT_FOUND");
    if (previous.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const result = supersedeQuote(
      previous,
      newQuoteId,
      tenant,
      previous.demandId,
      newVendorId,
      newUnitCost,
      newTotalCost,
      newSubmittedAt,
      newExpiresAt,
    );
    if (!result.ok) return refuse(result.reasonCode);
    await this.repo.storeQuote(tenant, result.previousWithdrew);
    await this.repo.storeQuote(tenant, result.next);
    const audit = makeAuditEvent({
      kind: "procurement.quote-superseded",
      tenant,
      occurredAt: options.occurredAt,
      entityId: newQuoteId.value,
      quoteId: newQuoteId.value,
      fromStatus: previous.status,
      toStatus: "submitted",
    });
    return {
      ok: true,
      quote: result.next,
      auditEvents: [audit],
    };
  }

  async createOrder(
    tenant: TenantScope,
    orderId: OrderId,
    quoteId: QuoteId,
    authorization: GuardianDecisionRefLike,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const quote = await this.repo.loadQuote(tenant, quoteId);
    if (quote === null) return refuse("QUOTE_NOT_FOUND");
    if (quote.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    // The quote must be accepted before an order can be created from it.
    if (quote.status !== "accepted") {
      return refuse("ILLEGAL_TRANSITION");
    }
    const result = createOrder(orderId, tenant, quoteId, authorization);
    if (!result.ok) return refuse(result.reasonCode);
    await this.repo.storeOrder(tenant, result.next);
    const audit = makeAuditEvent({
      kind: "procurement.order-created",
      tenant,
      occurredAt: options.occurredAt,
      entityId: orderId.value,
      orderId: orderId.value,
      quoteId: quoteId.value,
      toStatus: "draft",
      authorizationDecisionId: authorization.decisionId,
    });
    return { ok: true, order: result.next, auditEvents: [audit] };
  }

  async matchVendors(
    tenant: TenantScope,
    demand: ProcurementDemand,
    vendors: readonly { readonly vendorId: string; readonly tenant: TenantScope; readonly capabilityTags: readonly string[]; readonly serviceLevel: number; readonly unitCost: number }[],
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    if (demand.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const matches = matchVendors(demand, vendors);
    const audit = makeAuditEvent({
      kind: "procurement.match-computed",
      tenant,
      occurredAt: options.occurredAt,
      entityId: demand.id.value,
      demandId: demand.id.value,
      matchCount: matches.length,
    });
    return { ok: true, matches, auditEvents: [audit] };
  }

  async getQuote(tenant: TenantScope, id: QuoteId): Promise<Quote | null> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return null;
    const item = await this.repo.loadQuote(tenant, id);
    if (item === null) return null;
    if (item.tenant.tenantId !== tenantCheck.scope.tenantId) return null;
    return item;
  }

  async getOrder(tenant: TenantScope, id: OrderId): Promise<Order | null> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return null;
    const item = await this.repo.loadOrder(tenant, id);
    if (item === null) return null;
    if (item.tenant.tenantId !== tenantCheck.scope.tenantId) return null;
    return item;
  }
}

function refuse(reasonCode: DirectoryReasonCode): DirectoryRefusal {
  return { ok: false, reasonCode };
}

// Re-export lifecycle exports for callers.
export { transitionQuote, supersedeQuote, createOrder, transitionOrder, transitionFulfillment };
export type { QuoteTransition, QuoteTransitionCommand, SupersedeQuoteResult };
