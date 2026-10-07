import { describe, it, expect } from "vitest";
import {
  declareRecoveryWindow,
  InMemoryRecoveryCaseRegistry,
  RecoveryCaseDirectory,
  windowActiveAt,
} from "./kernel.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEV1 = "dev_truck-001";
const CASE_1 = "rc_case-0001";

function ev(digest: string) {
  return { digest, kind: "test", observedAt: NOW };
}

function makeDir(): RecoveryCaseDirectory {
  return new RecoveryCaseDirectory(new InMemoryRecoveryCaseRegistry());
}

function openCase(dir: RecoveryCaseDirectory) {
  return dir.openCase({
    caseId: CASE_1,
    tenantId: TENANT_A,
    deviceId: DEV1,
    openedAt: NOW,
    actor: "act_a-001",
  });
}

describe("recovery kernel: AuditEventRef shape", () => {
  it("openCase emits audit with all five fields", () => {
    const dir = makeDir();
    const r = openCase(dir);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.audit).toBeTruthy();
      expect(r.audit.intent).toBe("recovery:open");
      expect(r.audit.tenant).toBe(TENANT_A);
      expect(r.audit.timestamp).toBe(NOW);
      expect(r.audit.digest.length).toBe(64);
    }
  });

  it("transition emits audit with recovery:<command> intent", () => {
    const dir = makeDir();
    openCase(dir);
    const r = dir.transition({
      tenantId: TENANT_A,
      caseId: CASE_1 as never,
      command: { kind: "investigate", initiatedAt: NOW + 1000 },
      actor: "act_a-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.audit.intent).toBe("recovery:investigate");
  });
});

describe("recovery kernel: openCase validation", () => {
  it("refuses malformed case id", () => {
    const dir = makeDir();
    const r = dir.openCase({ caseId: "bad", tenantId: TENANT_A, deviceId: DEV1, openedAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-case-id");
  });

  it("refuses missing tenantId", () => {
    const dir = makeDir();
    const r = dir.openCase({ caseId: CASE_1, tenantId: "", deviceId: DEV1, openedAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-tenant-id");
  });

  it("refuses missing deviceId", () => {
    const dir = makeDir();
    const r = dir.openCase({ caseId: CASE_1, tenantId: TENANT_A, deviceId: "", openedAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-device-id");
  });

  it("refuses duplicate case (same id, same tenant)", () => {
    const dir = makeDir();
    openCase(dir);
    const r = dir.openCase({ caseId: CASE_1, tenantId: TENANT_A, deviceId: DEV1, openedAt: NOW + 1, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate-case");
  });
});

describe("recovery kernel: transition legal/illegal (kernel-grade audit)", () => {
  it("open -> investigating -> proposal -> resolved with evidence chain", () => {
    const dir = makeDir();
    openCase(dir);
    const inv = dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "investigate", initiatedAt: NOW + 1000 }, actor: "a" });
    expect(inv.ok).toBe(true);
    if (inv.ok) expect(inv.case.state).toBe("investigating");

    const prop = dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "propose", reason: "swap", initiatedAt: NOW + 2000 }, actor: "a" });
    expect(prop.ok).toBe(true);
    if (prop.ok) expect(prop.case.state).toBe("proposal");

    const res = dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "resolve", reason: "device-replaced", evidence: [ev("a".repeat(64))], initiatedAt: NOW + 3000 }, actor: "a" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.case.state).toBe("resolved");
      expect(res.case.resolution?.rootCause).toBe("device-replaced");
    }
  });

  it("resolve without evidence -> missing-evidence", () => {
    const dir = makeDir();
    openCase(dir);
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "investigate", initiatedAt: NOW + 1000 }, actor: "a" });
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "propose", reason: "swap", initiatedAt: NOW + 2000 }, actor: "a" });
    const r = dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "resolve", reason: "x", initiatedAt: NOW + 3000 }, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-evidence");
  });

  it("reopen requires a reason (missing-reason)", () => {
    const dir = makeDir();
    openCase(dir);
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "investigate", initiatedAt: NOW + 1000 }, actor: "a" });
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "propose", reason: "swap", initiatedAt: NOW + 2000 }, actor: "a" });
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "resolve", reason: "x", evidence: [ev("a".repeat(64))], initiatedAt: NOW + 3000 }, actor: "a" });
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "close", initiatedAt: NOW + 4000 }, actor: "a" });
    const r = dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "reopen", initiatedAt: NOW + 5000 }, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });

  it("reopen with reason succeeds", () => {
    const dir = makeDir();
    openCase(dir);
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "investigate", initiatedAt: NOW + 1000 }, actor: "a" });
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "propose", reason: "swap", initiatedAt: NOW + 2000 }, actor: "a" });
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "resolve", reason: "x", evidence: [ev("a".repeat(64))], initiatedAt: NOW + 3000 }, actor: "a" });
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "close", initiatedAt: NOW + 4000 }, actor: "a" });
    const r = dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "reopen", reason: "new-evidence", initiatedAt: NOW + 5000 }, actor: "a" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.case.state).toBe("open");
  });

  it("transition on unknown case -> unknown-case", () => {
    const dir = makeDir();
    const r = dir.transition({ tenantId: TENANT_A, caseId: "rc_unknown-999" as never, command: { kind: "investigate", initiatedAt: NOW }, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-case");
  });

  it("audit log (history) is append-only", () => {
    const dir = makeDir();
    openCase(dir);
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "investigate", initiatedAt: NOW + 1000 }, actor: "a" });
    dir.transition({ tenantId: TENANT_A, caseId: CASE_1 as never, command: { kind: "propose", reason: "swap", initiatedAt: NOW + 2000 }, actor: "a" });
    const rc = dir.lookup(TENANT_A, CASE_1 as never);
    expect(rc).not.toBeNull();
    if (rc) expect(rc.history).toHaveLength(2);
  });
});

describe("recovery kernel: tenant fail-closed", () => {
  it("lookup returns null for cross-tenant reads", () => {
    const dir = makeDir();
    openCase(dir);
    expect(dir.lookup(TENANT_B, CASE_1 as never)).toBeNull();
  });

  it("listByTenant returns only the requested tenant's cases", () => {
    const dir = makeDir();
    openCase(dir);
    dir.openCase({ caseId: "rc_case-0002", tenantId: TENANT_B, deviceId: DEV1, openedAt: NOW, actor: "a" });
    expect(dir.listByTenant(TENANT_A)).toHaveLength(1);
    expect(dir.listByTenant(TENANT_B)).toHaveLength(1);
  });

  it("listByDevice filters by tenant and device", () => {
    const dir = makeDir();
    openCase(dir);
    expect(dir.listByDevice(TENANT_A, DEV1)).toHaveLength(1);
    expect(dir.listByDevice(TENANT_A, "dev_other")).toHaveLength(0);
    expect(dir.listByDevice(TENANT_B, DEV1)).toHaveLength(0);
  });
});

describe("recovery kernel: declareRecoveryWindow scheduling", () => {
  it("declares a valid window and emits audit", () => {
    const r = declareRecoveryWindow({
      caseId: CASE_1 as never,
      tenantId: TENANT_A,
      startsAt: NOW,
      endsAt: NOW + 3600_000,
      reason: "swap",
      actor: "a",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.window.startsAt).toBe(NOW);
      expect(r.window.endsAt).toBe(NOW + 3600_000);
      expect(r.audit.intent).toBe("recovery:window:declare");
    }
  });

  it("refuses empty reason (missing-reason)", () => {
    const r = declareRecoveryWindow({ caseId: CASE_1 as never, tenantId: TENANT_A, startsAt: NOW, endsAt: NOW + 1, reason: "", actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });

  it("refuses ends-before-start (ends-before-start)", () => {
    const r = declareRecoveryWindow({ caseId: CASE_1 as never, tenantId: TENANT_A, startsAt: NOW + 1000, endsAt: NOW, reason: "x", actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ends-before-start");
  });

  it("refuses invalid window (NaN startsAt)", () => {
    const r = declareRecoveryWindow({ caseId: CASE_1 as never, tenantId: TENANT_A, startsAt: NaN, endsAt: NOW + 1, reason: "x", actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-window");
  });

  it("windowActiveAt returns true for time within window, false otherwise", () => {
    const r = declareRecoveryWindow({ caseId: CASE_1 as never, tenantId: TENANT_A, startsAt: NOW, endsAt: NOW + 1000, reason: "x", actor: "a" });
    if (!r.ok) throw new Error("window failed");
    expect(windowActiveAt(r.window, NOW)).toBe(true);
    expect(windowActiveAt(r.window, NOW + 500)).toBe(true);
    expect(windowActiveAt(r.window, NOW - 1)).toBe(false);
    expect(windowActiveAt(r.window, NOW + 1001)).toBe(false);
  });
});
