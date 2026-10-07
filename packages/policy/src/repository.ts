/**
 * @fleetos/policy — Policy repository port + in-memory reference.
 *
 * Law A12: deterministic reference path. The repository is a STRUCTURAL port
 * so production can inject a PostgreSQL-backed repository; the in-memory
 * reference is deterministic and side-effect-free (no I/O in the reference).
 *
 * Law A8: tenant isolation — policies are scoped by tenantId. Cross-tenant
 * reads return null (fail-closed), never another tenant's policy.
 */

import type { Policy } from "./policy.ts";

/**
 * Structural port — production injects a PostgreSQL/object-store-backed
 * repository; tests + reference paths use the in-memory implementation.
 *
 * All methods are async because production repositories are async (network/disk).
 * The in-memory reference is synchronous-under-the-hood but wrapped in
 * Promise.resolve so the interface shape is stable.
 */
export interface PolicyRepositoryPort {
  readonly load: (policyId: string, tenantId: string) => Promise<Policy | null>;
  readonly save: (policy: Policy) => Promise<void>;
  readonly list: (tenantId: string) => Promise<readonly Policy[]>;
  readonly delete: (policyId: string, tenantId: string) => Promise<boolean>;
}

/**
 * Deterministic in-memory reference repository.
 *
 * Keyed by `${tenantId}/${policyId}` to enforce tenant isolation at the
 * storage layer. Cross-tenant reads return null (fail-closed, law A8).
 */
export class InMemoryPolicyRepository implements PolicyRepositoryPort {
  private readonly store = new Map<string, Policy>();

  private key(tenantId: string, policyId: string): string {
    return `${tenantId}/${policyId}`;
  }

  async load(policyId: string, tenantId: string): Promise<Policy | null> {
    return this.store.get(this.key(tenantId, policyId)) ?? null;
  }

  async save(policy: Policy): Promise<void> {
    this.store.set(this.key(policy.tenantId, policy.id), policy);
  }

  async list(tenantId: string): Promise<readonly Policy[]> {
    const out: Policy[] = [];
    for (const [key, policy] of this.store) {
      if (key.startsWith(`${tenantId}/`)) out.push(policy);
    }
    return out;
  }

  async delete(policyId: string, tenantId: string): Promise<boolean> {
    const k = this.key(tenantId, policyId);
    return this.store.delete(k);
  }

  /** Test-only snapshot — returns a deterministic copy of all keys. */
  snapshot(): readonly string[] {
    return [...this.store.keys()].sort();
  }
}
