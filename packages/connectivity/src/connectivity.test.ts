import { describe, it, expect, expectTypeOf } from "vitest";
import {
  InMemoryConnectivityProvider,
  evaluateIntent,
  failClosedPolicy,
  type ConnectivityIntent,
  type ConnectivityPolicy,
  type ConnectivityProviderPort,
} from "./connectivity.js";

const NOW = 1_727_000_000_000;

function intent(overrides: Partial<ConnectivityIntent> = {}): ConnectivityIntent {
  return {
    tenantId: "tnt_acme",
    deviceId: "dev_truck-001",
    desiredState: "online",
    ...overrides,
  };
}

function policy(rules: ConnectivityPolicy["rules"], defaultEffect: ConnectivityPolicy["defaultEffect"] = "deny"): ConnectivityPolicy {
  return { rules, defaultEffect };
}

describe("connectivity: InMemoryConnectivityProvider satisfies ConnectivityProviderPort (structural)", () => {
  it("InMemoryConnectivityProvider is assignable to ConnectivityProviderPort", () => {
    const p: ConnectivityProviderPort = new InMemoryConnectivityProvider();
    expectTypeOf(p).toMatchTypeOf<ConnectivityProviderPort>();
    expect(p).toBeInstanceOf(InMemoryConnectivityProvider);
  });
});

describe("connectivity: evaluateIntent — rule matching", () => {
  it("matches a device-specific allow rule", () => {
    const p = policy([
      { deviceId: "dev_truck-001", effect: "allow", priority: 1, reason: "fleet-vehicle" },
    ]);
    const d = evaluateIntent(intent(), p);
    expect(d.effect).toBe("allow");
    expect(d.matchedRule?.deviceId).toBe("dev_truck-001");
  });
  it("matches a tenant-wide rule when no device rule", () => {
    const p = policy([
      { tenantId: "tnt_acme", effect: "allow", priority: 1, reason: "fleet-default" },
    ]);
    const d = evaluateIntent(intent(), p);
    expect(d.effect).toBe("allow");
  });
  it("returns defaultEffect when no rule matches", () => {
    const p = policy([
      { tenantId: "tnt_other", effect: "allow", priority: 1, reason: "other" },
    ]);
    const d = evaluateIntent(intent(), p);
    expect(d.effect).toBe("deny");
    expect(d.reason).toBe("no-matching-rule");
  });
  it("empty policy returns defaultEffect (fail-closed default)", () => {
    const d = evaluateIntent(intent(), failClosedPolicy());
    expect(d.effect).toBe("deny");
  });
});

describe("connectivity: evaluateIntent — priority resolution", () => {
  it("higher-priority rule wins (deny overrides allow)", () => {
    const p = policy([
      { tenantId: "tnt_acme", effect: "allow", priority: 1, reason: "default" },
      { deviceId: "dev_truck-001", effect: "deny", priority: 10, reason: "grounded" },
    ]);
    const d = evaluateIntent(intent(), p);
    expect(d.effect).toBe("deny");
    expect(d.matchedRule?.priority).toBe(10);
  });
  it("ties broken by first-seen order (stable)", () => {
    const p = policy([
      { tenantId: "tnt_acme", effect: "allow", priority: 5, reason: "first" },
      { deviceId: "dev_truck-001", effect: "deny", priority: 5, reason: "second" },
    ]);
    const d = evaluateIntent(intent(), p);
    expect(d.effect).toBe("allow");
    expect(d.matchedRule?.reason).toBe("first");
  });
});

describe("connectivity: determinism", () => {
  it("identical inputs produce identical decisions", () => {
    const p = policy([
      { tenantId: "tnt_acme", effect: "allow", priority: 1, reason: "x" },
    ]);
    const a = evaluateIntent(intent(), p);
    const b = evaluateIntent(intent(), p);
    expect(a).toEqual(b);
  });
});

describe("connectivity: InMemoryConnectivityProvider status store", () => {
  it("status() returns 'unknown' for unseen device", () => {
    const p = new InMemoryConnectivityProvider();
    expect(p.status("dev_x").state).toBe("unknown");
  });
  it("recordStatus stores and returns the latest status", () => {
    const p = new InMemoryConnectivityProvider();
    p.recordStatus({ deviceId: "dev_truck-001", state: "online", observedAt: NOW });
    expect(p.status("dev_truck-001")).toEqual({
      deviceId: "dev_truck-001",
      state: "online",
      observedAt: NOW,
    });
  });
  it("provider.evaluate is consistent with standalone evaluateIntent", () => {
    const p = new InMemoryConnectivityProvider();
    const pol = policy([
      { tenantId: "tnt_acme", effect: "allow", priority: 1, reason: "x" },
    ]);
    expect(p.evaluate(intent(), pol)).toEqual(evaluateIntent(intent(), pol));
  });
});

describe("connectivity: fail-closed defaults", () => {
  it("failClosedPolicy has empty rules and deny default", () => {
    const p = failClosedPolicy();
    expect(p.rules).toEqual([]);
    expect(p.defaultEffect).toBe("deny");
  });
});
