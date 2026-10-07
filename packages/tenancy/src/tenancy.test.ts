import { describe, it, expect } from "vitest";
import {
  evaluateTenantTransition,
  makeTenantBoundary,
  assertSameTenant,
  type TenantLifecycleCommand,
} from "./tenancy.js";

const T0 = 1_727_000_000_000;

const cmd = (kind: TenantLifecycleCommand["kind"], reason?: string): TenantLifecycleCommand => ({
  kind,
  reason,
  initiatedAt: T0,
});

describe("tenancy: legal transitions", () => {
  it("provision: provisioning -> active", () => {
    const r = evaluateTenantTransition("provisioning", cmd("provision"));
    expect(r).toEqual({ ok: true, from: "provisioning", to: "active" });
  });
  it("suspend: active -> suspended (with reason)", () => {
    const r = evaluateTenantTransition("active", cmd("suspend", "billing-overdue"));
    expect(r).toEqual({ ok: true, from: "active", to: "suspended" });
  });
  it("resume: suspended -> active", () => {
    const r = evaluateTenantTransition("suspended", cmd("resume"));
    expect(r).toEqual({ ok: true, from: "suspended", to: "active" });
  });
  it("close: active -> closing", () => {
    const r = evaluateTenantTransition("active", cmd("close", "owner-request"));
    expect(r).toEqual({ ok: true, from: "active", to: "closing" });
  });
  it("close: closing -> closed", () => {
    const r = evaluateTenantTransition("closing", cmd("close"));
    expect(r).toEqual({ ok: true, from: "closing", to: "closed" });
  });
  it("suspend: suspended -> closing (close while suspended is legal)", () => {
    const r = evaluateTenantTransition("suspended", cmd("close", "force-close"));
    expect(r).toEqual({ ok: true, from: "suspended", to: "closing" });
  });
});

describe("tenancy: illegal transitions refused with stable reason codes", () => {
  it("provision from active -> already-in-target-state", () => {
    const r = evaluateTenantTransition("active", cmd("provision"));
    expect(r).toEqual({ ok: false, reason: "already-in-target-state" });
  });
  it("suspend from suspended -> already-in-target-state", () => {
    const r = evaluateTenantTransition("suspended", cmd("suspend", "x"));
    expect(r).toEqual({ ok: false, reason: "already-in-target-state" });
  });
  it("resume from active -> illegal-transition", () => {
    const r = evaluateTenantTransition("active", cmd("resume"));
    expect(r).toEqual({ ok: false, reason: "illegal-transition" });
  });
  it("provision from closed -> illegal-transition", () => {
    const r = evaluateTenantTransition("closed", cmd("provision"));
    expect(r).toEqual({ ok: false, reason: "illegal-transition" });
  });
  it("resume from closed -> illegal-transition", () => {
    const r = evaluateTenantTransition("closed", cmd("resume"));
    expect(r).toEqual({ ok: false, reason: "illegal-transition" });
  });
  it("suspend without reason -> missing-reason", () => {
    const r = evaluateTenantTransition("active", cmd("suspend"));
    expect(r).toEqual({ ok: false, reason: "missing-reason" });
  });
  it("suspend with empty-string reason -> missing-reason", () => {
    const r = evaluateTenantTransition("active", cmd("suspend", ""));
    expect(r).toEqual({ ok: false, reason: "missing-reason" });
  });
  it("unknown command kind -> unknown-command", () => {
    const r = evaluateTenantTransition("active", { kind: "nope" as never, initiatedAt: T0 });
    expect(r).toEqual({ ok: false, reason: "unknown-command" });
  });
});

describe("tenancy: deterministic & pure", () => {
  it("identical inputs produce identical outputs", () => {
    const a = evaluateTenantTransition("active", cmd("suspend", "x"));
    const b = evaluateTenantTransition("active", cmd("suspend", "x"));
    expect(a).toEqual(b);
  });
  it("evaluating a transition does not mutate the command", () => {
    const c = cmd("suspend", "x");
    evaluateTenantTransition("active", c);
    expect(c).toEqual({ kind: "suspend", reason: "x", initiatedAt: T0 });
  });
});

describe("tenancy: isolation vocabulary", () => {
  it("makeTenantBoundary defaults to cross-tenant forbidden", () => {
    const b = makeTenantBoundary("tnt_acme");
    expect(b.readCrossTenant).toBe(false);
    expect(b.writeCrossTenant).toBe(false);
  });
  it("makeTenantBoundary rejects empty id", () => {
    expect(() => makeTenantBoundary("")).toThrow();
  });
  it("assertSameTenant: same tenant -> ok", () => {
    expect(assertSameTenant("tnt_a", "tnt_a")).toEqual({ ok: true });
  });
  it("assertSameTenant: different tenants -> cross-tenant-forbidden", () => {
    expect(assertSameTenant("tnt_a", "tnt_b")).toEqual({ ok: false, reason: "cross-tenant-forbidden" });
  });
  it("assertSameTenant: empty caller fails closed", () => {
    expect(assertSameTenant("", "tnt_a")).toEqual({ ok: false, reason: "cross-tenant-forbidden" });
  });
});
