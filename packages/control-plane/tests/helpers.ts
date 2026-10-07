/**
 * @fleetos/control-plane — test helpers.
 *
 * Tenant contexts are built literally against the kernel's TenantContext
 * TYPE (type-only import — no runtime dependency on the kernel).
 */

import type {
  ActorId,
  SessionId,
  TenantContext,
  TenantId,
} from "@fleetos/kernel";

export const NOW = 1_727_000_000_000;
export const TENANT_A = "tnt_acme-corp-001";
export const TENANT_B = "tnt_globex-002";
export const ACTOR_A = "act_alice-001";
export const ACTOR_B = "act_bob-002";
export const SESSION_A = "sess_abcdef0123456789";

export function ctxFor(
  tenant: string,
  actor: string = ACTOR_A,
): TenantContext {
  return {
    tenantId: tenant as TenantId,
    actorId: actor as ActorId,
    sessionId: SESSION_A as SessionId,
    establishedAt: NOW,
    scope: "tenant",
  };
}
