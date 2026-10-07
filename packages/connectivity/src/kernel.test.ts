import { describe, it, expect } from "vitest";
import {
  ConnectivityDirectory,
  InMemoryConnectivityDirectory,
  type TenantStatusRecord,
} from "./kernel.js";
import { failClosedPolicy, type ConnectivityRule } from "./connectivity.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEV1 = "dev_truck-001";
const DEV2 = "dev_sensor-002";

function makeDir(rules: ReadonlyArray<ConnectivityRule> = []): ConnectivityDirectory {
  return new ConnectivityDirectory(
    new InMemoryConnectivityDirectory(),
    rules.length > 0 ? { rules, defaultEffect: "deny" as const } : failClosedPolicy(),
  );
}

describe("connectivity kernel: AuditEventRef shape", () => {
  it("recordStatus emits audit with all five fields", () => {
    const dir = makeDir();
    const r = dir.recordStatus({
      tenantId: TENANT_A,
      deviceId: DEV1,
      state: "online",
      observedAt: NOW,
      actor: "act_a-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.audit.intent).toBe("connectivity:record-status");
      expect(r.audit.tenant).toBe(TENANT_A);
      expect(r.audit.timestamp).toBe(NOW);
      expect(r.audit.digest.length).toBe(64);
    }
  });

  it("evaluate emits audit with connectivity:evaluate:<effect> intent", () => {
    const dir = makeDir();
    const { decision, audit } = dir.evaluate({ tenantId: TENANT_A, deviceId: DEV1, desiredState: "online", actor: "a", at: NOW });
    // With fail-closed default, the decision should be "deny".
    expect(decision.effect).toBe("deny");
    expect(audit.intent).toBe("connectivity:evaluate:deny");
  });

  it("audit digest is deterministic for identical inputs", () => {
    const dir1 = makeDir();
    const dir2 = makeDir();
    const r1 = dir1.recordStatus({ tenantId: TENANT_A, deviceId: DEV1, state: "online", observedAt: NOW, actor: "a" });
    const r2 = dir2.recordStatus({ tenantId: TENANT_A, deviceId: DEV1, state: "online", observedAt: NOW, actor: "a" });
    if (!r1.ok || !r2.ok) throw new Error("expected ok");
    expect(r1.audit.digest).toBe(r2.audit.digest);
  });
});

describe("connectivity kernel: recordStatus validation", () => {
  it("refuses missing-tenant-id", () => {
    const dir = makeDir();
    const r = dir.recordStatus({ tenantId: "", deviceId: DEV1, state: "online", observedAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-tenant-id");
  });

  it("refuses missing-device-id", () => {
    const dir = makeDir();
    const r = dir.recordStatus({ tenantId: TENANT_A, deviceId: "", state: "online", observedAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-device-id");
  });

  it("refuses invalid-observed-at (NaN)", () => {
    const dir = makeDir();
    const r = dir.recordStatus({ tenantId: TENANT_A, deviceId: DEV1, state: "online", observedAt: NaN, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-observed-at");
  });
});

describe("connectivity kernel: tenant-scoped status (fail-closed)", () => {
  it("status returns unknown for a device with no recorded status", () => {
    const dir = makeDir();
    const s = dir.status(TENANT_A, DEV1);
    expect(s.state).toBe("unknown");
    expect(s.observedAt).toBe(0);
  });

  it("status returns the recorded state for the same tenant", () => {
    const dir = makeDir();
    dir.recordStatus({ tenantId: TENANT_A, deviceId: DEV1, state: "online", observedAt: NOW, actor: "a" });
    expect(dir.status(TENANT_A, DEV1).state).toBe("online");
  });

  it("status returns unknown for cross-tenant reads (fail-closed)", () => {
    const dir = makeDir();
    dir.recordStatus({ tenantId: TENANT_A, deviceId: DEV1, state: "online", observedAt: NOW, actor: "a" });
    expect(dir.status(TENANT_B, DEV1).state).toBe("unknown");
  });

  it("listStatuses returns only the requested tenant's statuses", () => {
    const dir = makeDir();
    dir.recordStatus({ tenantId: TENANT_A, deviceId: DEV1, state: "online", observedAt: NOW, actor: "a" });
    dir.recordStatus({ tenantId: TENANT_B, deviceId: DEV2, state: "offline", observedAt: NOW, actor: "a" });
    expect(dir.listStatuses(TENANT_A)).toHaveLength(1);
    expect(dir.listStatuses(TENANT_B)).toHaveLength(1);
    expect(dir.listStatuses(TENANT_A)[0]?.deviceId).toBe(DEV1);
  });

  it("recordStatus is idempotent for identical inputs (same audit digest)", () => {
    const dir = makeDir();
    const r1 = dir.recordStatus({ tenantId: TENANT_A, deviceId: DEV1, state: "online", observedAt: NOW, actor: "a" });
    const r2 = dir.recordStatus({ tenantId: TENANT_A, deviceId: DEV1, state: "online", observedAt: NOW, actor: "a" });
    if (!r1.ok || !r2.ok) throw new Error("expected ok");
    expect(r1.audit.digest).toBe(r2.audit.digest);
  });

  it("recording a new state overwrites the prior (last write wins)", () => {
    const dir = makeDir();
    dir.recordStatus({ tenantId: TENANT_A, deviceId: DEV1, state: "online", observedAt: NOW, actor: "a" });
    dir.recordStatus({ tenantId: TENANT_A, deviceId: DEV1, state: "offline", observedAt: NOW + 1000, actor: "a" });
    expect(dir.status(TENANT_A, DEV1).state).toBe("offline");
  });
});

describe("connectivity kernel: evaluate (policy-aware)", () => {
  it("with empty rules and deny default, returns deny (fail-closed)", () => {
    const dir = makeDir();
    const { decision } = dir.evaluate({ tenantId: TENANT_A, deviceId: DEV1, desiredState: "online", actor: "a", at: NOW });
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toBe("no-matching-rule");
  });

  it("with a matching allow rule, returns allow", () => {
    const dir = makeDir([
      { tenantId: TENANT_A, deviceId: DEV1, effect: "allow", priority: 100, reason: "trusted" },
    ]);
    const { decision } = dir.evaluate({ tenantId: TENANT_A, deviceId: DEV1, desiredState: "online", actor: "a", at: NOW });
    expect(decision.effect).toBe("allow");
    if (decision.matchedRule) expect(decision.matchedRule.reason).toBe("trusted");
  });

  it("highest priority rule wins", () => {
    const dir = makeDir([
      { tenantId: TENANT_A, effect: "deny", priority: 50, reason: "low" },
      { tenantId: TENANT_A, effect: "allow", priority: 100, reason: "high" },
    ]);
    const { decision } = dir.evaluate({ tenantId: TENANT_A, deviceId: DEV1, desiredState: "online", actor: "a", at: NOW });
    expect(decision.effect).toBe("allow");
  });

  it("rules from another tenant do not affect this tenant's evaluation", () => {
    const dir = makeDir([
      { tenantId: TENANT_B, effect: "allow", priority: 100, reason: "trusted" },
    ]);
    const { decision } = dir.evaluate({ tenantId: TENANT_A, deviceId: DEV1, desiredState: "online", actor: "a", at: NOW });
    expect(decision.effect).toBe("deny");
  });

  it("audit intent reflects the decision effect", () => {
    const dir = makeDir([
      { tenantId: TENANT_A, effect: "allow", priority: 100, reason: "trusted" },
    ]);
    const { audit } = dir.evaluate({ tenantId: TENANT_A, deviceId: DEV1, desiredState: "online", actor: "a", at: NOW });
    expect(audit.intent).toBe("connectivity:evaluate:allow");
  });
});

describe("connectivity kernel: InMemoryConnectivityDirectory port determinism", () => {
  it("two ports with identical save calls produce identical reads", () => {
    const a = new InMemoryConnectivityDirectory();
    const b = new InMemoryConnectivityDirectory();
    const rec: TenantStatusRecord = { tenantId: TENANT_A, deviceId: DEV1, state: "online", observedAt: NOW };
    a.saveStatus(rec);
    b.saveStatus(rec);
    expect(a.findStatus(TENANT_A, DEV1)).toEqual(b.findStatus(TENANT_A, DEV1));
  });
  it("listStatusesByTenant sorts by deviceId for determinism", () => {
    const port = new InMemoryConnectivityDirectory();
    port.saveStatus({ tenantId: TENANT_A, deviceId: "dev_zzz", state: "online", observedAt: NOW });
    port.saveStatus({ tenantId: TENANT_A, deviceId: "dev_aaa", state: "online", observedAt: NOW });
    const list = port.listStatusesByTenant(TENANT_A);
    expect(list[0]?.deviceId).toBe("dev_aaa");
    expect(list[1]?.deviceId).toBe("dev_zzz");
  });
});
