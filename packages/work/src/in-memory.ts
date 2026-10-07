/**
 * @fleetos/work — In-memory reference WorkRepository (deterministic,
 * replayable). Used by tests and as a wiring fallback. NOT authoritative
 * business truth (law A1 — the authoritative store is composed by the
 * TL at F211).
 *
 * Tenant isolation is enforced at the repository boundary: cross-tenant
 * reads return null, cross-tenant writes are silently ignored (the
 * directory layer surfaces a TENANT_MISMATCH refusal). This makes the
 * fail-closed boundary observable in tests.
 */

import type { TenantScope } from "./tenant.js";
import { validateTenantScope } from "./tenant.js";
import type {
  WorkItem,
  WorkItemId,
  WorkItemStatus,
} from "./contracts.js";
import type { WorkRepositoryPort } from "./directory.js";

interface InMemoryStore {
  // Keyed by `${tenantId}::${workItemId.value}` to enforce tenant isolation.
  readonly items: Map<string, WorkItem>;
}

export function createInMemoryWorkRepository(
  initial?: readonly WorkItem[],
): WorkRepositoryPort {
  const store: InMemoryStore = { items: new Map() };
  for (const item of initial ?? []) {
    const key = keyFor(item.tenant.tenantId, item.id.value);
    store.items.set(key, item);
  }
  return {
    async load(tenant: TenantScope, id: WorkItemId): Promise<WorkItem | null> {
      const tenantCheck = validateTenantScope(tenant);
      if (!tenantCheck.ok) return null;
      const key = keyFor(tenantCheck.scope.tenantId, id.value);
      return store.items.get(key) ?? null;
    },
    async store(tenant: TenantScope, item: WorkItem): Promise<void> {
      const tenantCheck = validateTenantScope(tenant);
      if (!tenantCheck.ok) return;
      // Refuse cross-tenant writes silently — the directory surfaces a
      // TENANT_MISMATCH refusal. This is the fail-closed boundary.
      if (item.tenant.tenantId !== tenantCheck.scope.tenantId) return;
      // Refuse id-kind mismatch — defensive integrity.
      if (item.id.kind !== "work-item") return;
      const key = keyFor(tenantCheck.scope.tenantId, item.id.value);
      store.items.set(key, item);
    },
    async list(
      tenant: TenantScope,
      filter?: { readonly statuses?: readonly WorkItemStatus[] },
    ): Promise<readonly WorkItem[]> {
      const tenantCheck = validateTenantScope(tenant);
      if (!tenantCheck.ok) return [];
      const prefix = `${tenantCheck.scope.tenantId}::`;
      const out: WorkItem[] = [];
      for (const [key, item] of store.items.entries()) {
        if (!key.startsWith(prefix)) continue;
        if (filter?.statuses && !filter.statuses.includes(item.status)) continue;
        out.push(item);
      }
      // Deterministic ordering: by work item id value. Same input set
      // always produces the same output order (law A12).
      out.sort((a, b) => a.id.value.localeCompare(b.id.value));
      return out;
    },
  };
}

function keyFor(tenantId: string, workItemId: string): string {
  return `${tenantId}::${workItemId}`;
}
