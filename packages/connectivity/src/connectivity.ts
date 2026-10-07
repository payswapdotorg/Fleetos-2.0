/**
 * @fleetos/connectivity — Wave 0 contracts.
 *
 * Pure TypeScript domain contracts ONLY. No I/O, no servers, no databases.
 *
 * Owns (per spec/BOUNDED-CONTEXTS.md "Connectivity"):
 *   - FleetOS connectivity intent and policy;
 *   - ADCOS remains the network-native execution provider (handled by
 *     @fleetos/integrations/adcos — Connectivity never owns ADCOS truth).
 *
 * The ConnectivityProviderPort is a STRUCTURAL interface — the seam. A
 * deterministic in-memory reference implementation satisfies the port and is
 * used as the System-1 reference path (A12).
 *
 * Cross-worker seam: structural `TenantIdLike`, `DeviceIdLike`.
 */

// ---------------------------------------------------------------------------
// Structural seam types
// ---------------------------------------------------------------------------

export type TenantIdLike = string;
export type DeviceIdLike = string;

// ---------------------------------------------------------------------------
// Intent / Policy vocabulary
// ---------------------------------------------------------------------------

export type ConnectivityDesiredState = "online" | "offline";

export interface ConnectivityIntent {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly desiredState: ConnectivityDesiredState;
}

export type ConnectivityEffect = "allow" | "deny";

export interface ConnectivityRule {
  readonly tenantId?: TenantIdLike;
  readonly deviceId?: DeviceIdLike;
  readonly effect: ConnectivityEffect;
  readonly priority: number; // higher wins
  readonly reason: string;
}

export interface ConnectivityPolicy {
  readonly rules: ReadonlyArray<ConnectivityRule>;
  readonly defaultEffect: ConnectivityEffect; // applied when no rule matches
}

// ---------------------------------------------------------------------------
// Decision + status
// ---------------------------------------------------------------------------

export interface ConnectivityDecision {
  readonly effect: ConnectivityEffect;
  readonly matchedRule?: ConnectivityRule;
  readonly reason: string;
}

export type ConnectivityState = "online" | "offline" | "unknown";

export interface ConnectivityStatus {
  readonly deviceId: DeviceIdLike;
  readonly state: ConnectivityState;
  readonly observedAt: number;
}

// ---------------------------------------------------------------------------
// ConnectivityProviderPort — the structural seam.
//
// Implementations may be:
//   - InMemoryConnectivityProvider (deterministic reference, this package);
//   - real adapters (ADCOS, etc.) — those never own connectivity truth; they
//     only execute decisions that Connectivity authoritatively produced.
// ---------------------------------------------------------------------------

export interface ConnectivityProviderPort {
  readonly evaluate: (intent: ConnectivityIntent, policy: ConnectivityPolicy) => ConnectivityDecision;
  readonly recordStatus: (status: ConnectivityStatus) => void;
  readonly status: (deviceId: DeviceIdLike) => ConnectivityStatus;
}

// ---------------------------------------------------------------------------
// InMemoryConnectivityProvider — deterministic reference (no network).
// ---------------------------------------------------------------------------

export function evaluateIntent(
  intent: ConnectivityIntent,
  policy: ConnectivityPolicy,
): ConnectivityDecision {
  // Filter rules that apply to this (tenantId, deviceId) pair.
  const matching = policy.rules.filter((rule) => {
    if (rule.tenantId !== undefined && rule.tenantId !== intent.tenantId) return false;
    if (rule.deviceId !== undefined && rule.deviceId !== intent.deviceId) return false;
    return true;
  });
  if (matching.length === 0) {
    return {
      effect: policy.defaultEffect,
      reason: "no-matching-rule",
    };
  }
  // Highest priority wins; ties broken by first-seen order (stable).
  let winner = matching[0]!;
  for (const r of matching) {
    if (r.priority > winner.priority) winner = r;
  }
  return { effect: winner.effect, matchedRule: winner, reason: winner.reason };
}

export class InMemoryConnectivityProvider implements ConnectivityProviderPort {
  private readonly statuses = new Map<DeviceIdLike, ConnectivityStatus>();

  evaluate(intent: ConnectivityIntent, policy: ConnectivityPolicy): ConnectivityDecision {
    return evaluateIntent(intent, policy);
  }

  recordStatus(status: ConnectivityStatus): void {
    this.statuses.set(status.deviceId, status);
  }

  status(deviceId: DeviceIdLike): ConnectivityStatus {
    return (
      this.statuses.get(deviceId) ?? {
        deviceId,
        state: "unknown",
        observedAt: 0,
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Honest degraded helpers
// ---------------------------------------------------------------------------

export function failClosedPolicy(): ConnectivityPolicy {
  return { rules: [], defaultEffect: "deny" };
}
