/**
 * @fleetos/adcos — Wave 0 contracts.
 *
 * Pure TypeScript domain contracts ONLY. No I/O, no servers, no databases.
 *
 * ADCOS is an EXECUTION provider ONLY — it never owns connectivity truth
 * (that belongs to @fleetos/connectivity). ADCOS receives commands and
 * returns results; it does not own device state.
 *
 * The AdcosProviderPort is a STRUCTURAL interface — the seam. The reference
 * adapter is deterministic and makes NO network calls; it returns honest
 * degraded/unavailable states instead of fabricating success.
 *
 * Cross-worker seam: structural `DeviceIdLike`, `TenantIdLike`.
 */

// ---------------------------------------------------------------------------
// Structural seam types
// ---------------------------------------------------------------------------

export type DeviceIdLike = string;
export type TenantIdLike = string;

// ---------------------------------------------------------------------------
// Command + result
// ---------------------------------------------------------------------------

export type AdcosCommandKind =
  | "connect"
  | "disconnect"
  | "ping"
  | "send-payload"
  | "reboot";

export interface AdcosCommand {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly kind: AdcosCommandKind;
  readonly payload?: Readonly<Uint8Array>;
}

export type AdcosRejectionCode =
  | "device-not-found"
  | "command-unsupported"
  | "provider-unavailable"
  | "rate-limited"
  | "missing-tenant-id"
  | "missing-device-id"
  | "unknown-error";

export interface AdcosRejection {
  readonly ok: false;
  readonly reason: AdcosRejectionCode;
  readonly degraded: boolean; // true means caller SHOULD retry / fall back
}

export interface AdcosSuccess {
  readonly ok: true;
  readonly result: Readonly<Record<string, unknown>>;
  readonly requestId: string;
}

export type AdcosResult = AdcosSuccess | AdcosRejection;

export type AdcosHealth = "healthy" | "degraded" | "unavailable";

// ---------------------------------------------------------------------------
// AdcosProviderPort — the structural seam. Promise-returning because real
// adapters are async; the reference adapter resolves synchronously but still
// returns a Promise to honor the port's shape.
// ---------------------------------------------------------------------------

export interface AdcosProviderPort {
  readonly sendCommand: (command: AdcosCommand) => Promise<AdcosResult>;
  readonly healthCheck: () => Promise<AdcosHealth>;
}

// ---------------------------------------------------------------------------
// ReferenceAdcosProvider — deterministic, no-network reference impl.
//
// Behavior:
//   - Empty/whitespace tenantId or deviceId -> rejection (no fabricated success).
//   - Unknown command kind -> "command-unsupported" rejection.
//   - Unknown deviceId (not in the known-device map) -> "device-not-found" rejection.
//   - If the provider is marked unavailable -> "provider-unavailable" rejection.
//   - Otherwise: success with a deterministic result derived from the command.
// ---------------------------------------------------------------------------

export class ReferenceAdcosProvider implements AdcosProviderPort {
  private readonly knownDevices: ReadonlySet<DeviceIdLike>;
  private readonly supportedKinds: ReadonlySet<AdcosCommandKind>;
  private readonly health: AdcosHealth;
  private readonly requestCounter = { current: 0 };

  constructor(init?: {
    readonly knownDevices?: ReadonlyArray<DeviceIdLike>;
    readonly supportedKinds?: ReadonlyArray<AdcosCommandKind>;
    readonly health?: AdcosHealth;
  }) {
    this.knownDevices = new Set(init?.knownDevices ?? ["dev_truck-001", "dev_sensor-002"]);
    this.supportedKinds = new Set(
      init?.supportedKinds ?? ["connect", "disconnect", "ping", "send-payload", "reboot"],
    );
    this.health = init?.health ?? "healthy";
  }

  async sendCommand(command: AdcosCommand): Promise<AdcosResult> {
    // Fail-closed validations: never fabricate success on malformed input.
    if (typeof command.tenantId !== "string" || command.tenantId === "") {
      return { ok: false, reason: "missing-tenant-id", degraded: false };
    }
    if (typeof command.deviceId !== "string" || command.deviceId === "") {
      return { ok: false, reason: "missing-device-id", degraded: false };
    }
    if (this.health === "unavailable") {
      return { ok: false, reason: "provider-unavailable", degraded: true };
    }
    if (!this.supportedKinds.has(command.kind)) {
      return { ok: false, reason: "command-unsupported", degraded: false };
    }
    if (!this.knownDevices.has(command.deviceId)) {
      return { ok: false, reason: "device-not-found", degraded: false };
    }
    if (this.health === "degraded") {
      // In degraded mode, requests succeed but carry a degraded flag for retry/fallback.
      this.requestCounter.current += 1;
      return {
        ok: true,
        result: { acknowledged: true, degraded: true, kind: command.kind },
        requestId: `req_${this.requestCounter.current}`,
      };
    }
    this.requestCounter.current += 1;
    return {
      ok: true,
      result: { acknowledged: true, kind: command.kind },
      requestId: `req_${this.requestCounter.current}`,
    };
  }

  async healthCheck(): Promise<AdcosHealth> {
    return this.health;
  }
}

// ---------------------------------------------------------------------------
// Honest degraded helpers
// ---------------------------------------------------------------------------

export function unavailableAdcosResult(): AdcosRejection {
  return { ok: false, reason: "provider-unavailable", degraded: true };
}
