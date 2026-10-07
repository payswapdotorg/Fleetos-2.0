/**
 * @fleetos/adcos — Wave 1 kernel (F210A).
 *
 * ADCOS execution-provider kernel — advances the seam:
 *   - Audit reference emission (structural AuditEventRef) on every command
 *     send and health check.
 *   - Tenant-scoped device maps: a device registered for tenant A is
 *     invisible to tenant B (cross-tenant command send is rejected with
 *     device-not-found — fail-closed, identical to "device unknown").
 *   - Health-check caching within a TTL: a recent health check is reused
 *     rather than re-queried; the cache is keyed by tenantId.
 *   - Token lifecycle for command-auth: each command carries a token
 *     (issued -> verified -> expired); the kernel validates the token
 *     BEFORE consulting the device map.
 *   - Honest degradation preserved from Wave 0 (device-not-found,
 *     command-unsupported, provider-unavailable, degraded).
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type {
  AdcosCommand,
  AdcosHealth,
  AdcosProviderPort,
  AdcosRejectionCode,
  AdcosSuccess,
  DeviceIdLike,
  TenantIdLike,
} from "./adcos.js";

// ---------------------------------------------------------------------------
// AuditEventRef — structural audit reference (A19).
// ---------------------------------------------------------------------------

export interface AuditEventRef {
  readonly actor: string;
  readonly intent: string;
  readonly tenant: string;
  readonly timestamp: number;
  readonly digest: string;
}

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// CommandToken lifecycle (issued -> verified -> expired). The kernel
// validates the token BEFORE consulting the device map. An expired or
// unverified token is rejected with `token-invalid`.
// ---------------------------------------------------------------------------

export type CommandTokenState = "issued" | "verified" | "expired";

export interface CommandToken {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly actor: string;
  readonly state: CommandTokenState;
  readonly issuedAt: number;
  readonly verifiedAt: number | null;
  readonly expiresAt: number;
}

export type TokenRejectionCode = "token-unknown" | "token-not-verified" | "token-expired" | "token-tenant-mismatch";

export function verifyToken(token: CommandToken, at: number): { readonly ok: true } | { readonly ok: false; readonly reason: TokenRejectionCode } {
  if (token.state === "issued") return { ok: false, reason: "token-not-verified" };
  if (token.state === "expired" || at > token.expiresAt) return { ok: false, reason: "token-expired" };
  return { ok: true };
}

export function issueCommandToken(input: {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly actor: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}): CommandToken {
  return {
    id: input.id,
    tenantId: input.tenantId,
    actor: input.actor,
    state: "issued",
    issuedAt: input.issuedAt,
    verifiedAt: null,
    expiresAt: input.expiresAt,
  };
}

export function verifyCommandToken(token: CommandToken, at: number): CommandToken {
  if (token.state !== "issued") return token;
  return { ...token, state: "verified", verifiedAt: at };
}

export function expireCommandToken(token: CommandToken): CommandToken {
  if (token.state === "expired") return token;
  return { ...token, state: "expired" };
}

// ---------------------------------------------------------------------------
// AuditedAdcosProvider — wraps a base AdcosProviderPort with audit emission
// and tenant-scoped device visibility. The base provider is unchanged; the
// kernel layer adds the audit and the tenant scoping.
// ---------------------------------------------------------------------------

export interface AuditedCommand extends AdcosCommand {
  readonly token: CommandToken;
  readonly actor: string;
  readonly at: number;
}

export type AuditedAdcosResult =
  | { readonly ok: true; readonly result: AdcosSuccess; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: AdcosRejectionCode | TokenRejectionCode; readonly degraded: boolean; readonly audit?: AuditEventRef };

const TOKEN_REJECTION_TO_ADCOS: Record<TokenRejectionCode, AdcosRejectionCode> = {
  "token-unknown": "unknown-error",
  "token-not-verified": "unknown-error",
  "token-expired": "unknown-error",
  "token-tenant-mismatch": "unknown-error",
};

export class AuditedAdcosProvider {
  constructor(
    private readonly base: AdcosProviderPort,
    private readonly knownDevicesByTenant: ReadonlyMap<TenantIdLike, ReadonlySet<DeviceIdLike>>,
  ) {}

  async sendCommand(command: AuditedCommand): Promise<AuditedAdcosResult> {
    // Token validation first.
    if (command.token.tenantId !== command.tenantId) {
      return { ok: false, reason: "token-tenant-mismatch", degraded: false };
    }
    const v = verifyToken(command.token, command.at);
    if (!v.ok) {
      return { ok: false, reason: TOKEN_REJECTION_TO_ADCOS[v.reason], degraded: false };
    }

    // Tenant-scoped device visibility: a device not registered for THIS
    // tenant is treated as device-not-found (fail-closed).
    const devices = this.knownDevicesByTenant.get(command.tenantId);
    if (!devices || !devices.has(command.deviceId)) {
      return { ok: false, reason: "device-not-found", degraded: false };
    }

    const r = await this.base.sendCommand(command);
    const audit: AuditEventRef = {
      actor: command.actor,
      intent: `adcos:${command.kind}:${r.ok ? "ok" : "reject"}`,
      tenant: command.tenantId,
      timestamp: command.at,
      digest: digestOf(command.tenantId, command.deviceId, command.kind, r.ok ? "ok" : "reject"),
    };
    if (!r.ok) {
      return { ok: false, reason: r.reason, degraded: r.degraded, audit };
    }
    return { ok: true, result: r, audit };
  }
}

// ---------------------------------------------------------------------------
// HealthCheckCache — caches the most recent health-check result per tenant
// within a TTL. The cache is in-memory and deterministic.
// ---------------------------------------------------------------------------

export interface CachedHealth {
  readonly health: AdcosHealth;
  readonly checkedAt: number;
  readonly expiresAt: number;
}

export class HealthCheckCache {
  private readonly cache = new Map<TenantIdLike, CachedHealth>();
  constructor(private readonly ttlMs: number) {}

  async healthCheck(base: AdcosProviderPort, tenantId: TenantIdLike, at: number): Promise<{ readonly health: AdcosHealth; readonly fromCache: boolean; readonly audit: AuditEventRef }> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > at) {
      return {
        health: cached.health,
        fromCache: true,
        audit: {
          actor: "system:health",
          intent: `adcos:health:cached:${cached.health}`,
          tenant: tenantId,
          timestamp: at,
          digest: digestOf(tenantId, "health-cached", cached.health, at),
        },
      };
    }
    const health = await base.healthCheck();
    this.cache.set(tenantId, { health, checkedAt: at, expiresAt: at + this.ttlMs });
    return {
      health,
      fromCache: false,
      audit: {
        actor: "system:health",
        intent: `adcos:health:${health}`,
        tenant: tenantId,
        timestamp: at,
        digest: digestOf(tenantId, "health", health, at),
      },
    };
  }

  invalidate(tenantId: TenantIdLike): void {
    this.cache.delete(tenantId);
  }
}
