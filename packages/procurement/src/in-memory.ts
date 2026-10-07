/**
 * @fleetos/procurement — In-memory reference ProcurementRepository.
 *
 * Deterministic, replayable. NOT authoritative business truth (law A1).
 * Tenant isolation enforced at the repository boundary.
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
  DemandId,
} from "./contracts.js";
import type { ProcurementRepositoryPort } from "./directory.js";

export function createInMemoryProcurementRepository(
  initialQuotes?: readonly Quote[],
  initialOrders?: readonly Order[],
  initialFulfillments?: readonly Fulfillment[],
): ProcurementRepositoryPort {
  const quotes = new Map<string, Quote>();
  const orders = new Map<string, Order>();
  const fulfillments = new Map<string, Fulfillment>();
  for (const q of initialQuotes ?? []) {
    quotes.set(`${q.tenant.tenantId}::${q.id.value}`, q);
  }
  for (const o of initialOrders ?? []) {
    orders.set(`${o.tenant.tenantId}::${o.id.value}`, o);
  }
  for (const f of initialFulfillments ?? []) {
    fulfillments.set(`${f.tenant.tenantId}::${f.id.value}`, f);
  }
  return {
    async loadQuote(tenant: TenantScope, id: QuoteId): Promise<Quote | null> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return quotes.get(`${tc.scope.tenantId}::${id.value}`) ?? null;
    },
    async storeQuote(tenant: TenantScope, quote: Quote): Promise<void> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (quote.tenant.tenantId !== tc.scope.tenantId) return;
      quotes.set(`${tc.scope.tenantId}::${quote.id.value}`, quote);
    },
    async loadOrder(tenant: TenantScope, id: OrderId): Promise<Order | null> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return orders.get(`${tc.scope.tenantId}::${id.value}`) ?? null;
    },
    async storeOrder(tenant: TenantScope, order: Order): Promise<void> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (order.tenant.tenantId !== tc.scope.tenantId) return;
      orders.set(`${tc.scope.tenantId}::${order.id.value}`, order);
    },
    async loadFulfillment(tenant: TenantScope, id: FulfillmentId): Promise<Fulfillment | null> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return fulfillments.get(`${tc.scope.tenantId}::${id.value}`) ?? null;
    },
    async storeFulfillment(tenant: TenantScope, fulfillment: Fulfillment): Promise<void> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (fulfillment.tenant.tenantId !== tc.scope.tenantId) return;
      fulfillments.set(`${tc.scope.tenantId}::${fulfillment.id.value}`, fulfillment);
    },
    async listQuotesForDemand(tenant: TenantScope, demandId: DemandId): Promise<readonly Quote[]> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return [];
      const prefix = `${tc.scope.tenantId}::`;
      const out: Quote[] = [];
      for (const [k, q] of quotes.entries()) {
        if (!k.startsWith(prefix)) continue;
        if (q.demandId.value !== demandId.value) continue;
        out.push(q);
      }
      out.sort((a, b) => a.id.value.localeCompare(b.id.value));
      return out;
    },
  };
}
