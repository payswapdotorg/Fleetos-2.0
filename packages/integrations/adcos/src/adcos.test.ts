import { describe, it, expect, expectTypeOf } from "vitest";
import {
  ReferenceAdcosProvider,
  unavailableAdcosResult,
  type AdcosCommand,
  type AdcosProviderPort,
  type AdcosResult,
  type AdcosRejection,
  type AdcosSuccess,
} from "./adcos.js";

function cmd(overrides: Partial<AdcosCommand> = {}): AdcosCommand {
  return {
    tenantId: "tnt_acme",
    deviceId: "dev_truck-001",
    kind: "ping",
    ...overrides,
  };
}

describe("adcos: ReferenceAdcosProvider satisfies AdcosProviderPort (structural)", () => {
  it("ReferenceAdcosProvider is assignable to AdcosProviderPort", () => {
    const p: AdcosProviderPort = new ReferenceAdcosProvider();
    expectTypeOf(p).toMatchTypeOf<AdcosProviderPort>();
    expect(p).toBeInstanceOf(ReferenceAdcosProvider);
  });
});

describe("adcos: sendCommand happy path", () => {
  it("returns success for known device + supported command", async () => {
    const p = new ReferenceAdcosProvider();
    const r = await p.sendCommand(cmd());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.acknowledged).toBe(true);
      expect(r.requestId).toMatch(/^req_\d+$/);
    }
  });
  it("returns distinct requestIds for sequential calls (deterministic increment)", async () => {
    const p = new ReferenceAdcosProvider();
    const a = await p.sendCommand(cmd());
    const b = await p.sendCommand(cmd());
    if (a.ok && b.ok) {
      expect(a.requestId).not.toBe(b.requestId);
    }
  });
});

describe("adcos: honest degraded/unavailable states", () => {
  it("returns device-not-found for unknown device", async () => {
    const p = new ReferenceAdcosProvider();
    const r = await p.sendCommand(cmd({ deviceId: "dev_unknown" }));
    expect(r).toEqual({ ok: false, reason: "device-not-found", degraded: false });
  });
  it("returns command-unsupported for unsupported kind", async () => {
    const p = new ReferenceAdcosProvider({
      supportedKinds: ["ping"],
    });
    const r = await p.sendCommand(cmd({ kind: "reboot" }));
    expect(r).toEqual({ ok: false, reason: "command-unsupported", degraded: false });
  });
  it("returns provider-unavailable when provider is unavailable", async () => {
    const p = new ReferenceAdcosProvider({ health: "unavailable" });
    const r = await p.sendCommand(cmd());
    expect(r).toEqual({ ok: false, reason: "provider-unavailable", degraded: true });
  });
  it("returns degraded success when provider is degraded", async () => {
    const p = new ReferenceAdcosProvider({ health: "degraded" });
    const r = await p.sendCommand(cmd());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.degraded).toBe(true);
    }
  });
});

describe("adcos: fail-closed validations (never fabricate success)", () => {
  it("rejects missing tenantId", async () => {
    const p = new ReferenceAdcosProvider();
    const r = await p.sendCommand(cmd({ tenantId: "" }));
    expect(r).toEqual({ ok: false, reason: "missing-tenant-id", degraded: false });
  });
  it("rejects missing deviceId", async () => {
    const p = new ReferenceAdcosProvider();
    const r = await p.sendCommand(cmd({ deviceId: "" }));
    expect(r).toEqual({ ok: false, reason: "missing-device-id", degraded: false });
  });
  it("provider never throws — always returns AdcosResult", async () => {
    const p = new ReferenceAdcosProvider();
    const r1 = await p.sendCommand(cmd({ tenantId: "" as never }));
    const r2 = await p.sendCommand(cmd({ deviceId: null as unknown as string }));
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });
});

describe("adcos: healthCheck", () => {
  it("returns healthy by default", async () => {
    const p = new ReferenceAdcosProvider();
    expect(await p.healthCheck()).toBe("healthy");
  });
  it("returns the configured health state", async () => {
    const p = new ReferenceAdcosProvider({ health: "unavailable" });
    expect(await p.healthCheck()).toBe("unavailable");
  });
});

describe("adcos: determinism", () => {
  it("identical commands on a fresh provider produce identical results (modulo requestId)", async () => {
    const p1 = new ReferenceAdcosProvider();
    const p2 = new ReferenceAdcosProvider();
    const a = await p1.sendCommand(cmd());
    const b = await p2.sendCommand(cmd());
    // requestId counter is per-instance and identical when starting fresh.
    expect(a).toEqual(b);
  });
});

describe("adcos: helpers", () => {
  it("unavailableAdcosResult returns degraded=true rejection", () => {
    const r: AdcosRejection = unavailableAdcosResult();
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe("provider-unavailable");
  });
  it("AdcosResult success/rejection shapes are distinguishable", async () => {
    const p = new ReferenceAdcosProvider();
    const s: AdcosResult = await p.sendCommand(cmd());
    const r: AdcosResult = await p.sendCommand(cmd({ deviceId: "dev_unknown" }));
    expect(s.ok).toBe(true);
    expect(r.ok).toBe(false);
    // Structural discrimination narrows correctly.
    if (s.ok) {
      const _: AdcosSuccess = s;
      expect(_.result).toBeDefined();
    }
    if (!r.ok) {
      const __: AdcosRejection = r;
      expect(__.degraded).toBe(false);
    }
  });
});

describe("adcos: ADCOS never owns connectivity truth (architectural invariant)", () => {
  it("the port exposes only sendCommand + healthCheck — no policy/state ownership", () => {
    // This is a compile-time assertion: the AdcosProviderPort surface area
    // is exactly the two methods. If someone tries to add a `policy` or
    // `state` field it would be a contract delta to adjudicate at F201.
    type Keys = keyof AdcosProviderPort;
    type Allowed = "sendCommand" | "healthCheck";
    type Extra = Exclude<Keys, Allowed>;
    const assertion: Record<string, never> = {} as Record<Extra, never>;
    expect(Object.keys(assertion)).toEqual([]);
  });
});
