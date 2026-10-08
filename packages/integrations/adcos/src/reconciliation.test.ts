/**
 * @fleetos/adcos — Wave 5 reconciliation tests (F250A).
 *
 * Covers: all four classification classes; the twin-authoritative
 * resolution rule; fail-closed tenant/now; determinism (input order
 * independence, digest stability); duplicate/missing record refusals.
 */

import { describe, it, expect } from "vitest";
import {
  applyReconciliation,
  computeReconciliationDiff,
  resolveReconciliation,
  verifyReconciliation,
  verifyReconciliationDiff,
  type ReconcileRecord,
} from "./reconciliation.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";

function rec(id: string, digest: string, tenantId?: string): ReconcileRecord {
  return tenantId === undefined ? { id, digest } : { id, digest, tenantId };
}

describe("adcos reconciliation: classification", () => {
  it("empty sides are in-sync", () => {
    const r = computeReconciliationDiff({ tenantId: TENANT_A, now: NOW, adapterRecords: [], twinRecords: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.diff.outcome).toBe("in-sync");
      expect(r.diff.entries).toEqual([]);
    }
  });

  it("classifies in-sync, adapter-ahead, twin-ahead and conflict in one diff", () => {
    const r = computeReconciliationDiff({
      tenantId: TENANT_A,
      now: NOW,
      adapterRecords: [
        rec("cmd_a", "d-a", TENANT_A),
        rec("cmd_b", "d-b", TENANT_A),
        rec("cmd_c", "d-c", TENANT_A),
      ],
      twinRecords: [
        rec("cmd_a", "d-a"),
        rec("cmd_c", "d-c-CHANGED"),
        rec("cmd_d", "d-d"),
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = new Map(r.diff.entries.map((e) => [e.id, e.class] as const));
    expect(byId.get("cmd_a")).toBe("in-sync");
    expect(byId.get("cmd_b")).toBe("adapter-ahead");
    expect(byId.get("cmd_d")).toBe("twin-ahead");
    expect(byId.get("cmd_c")).toBe("conflict");
    expect(r.diff.counts).toEqual({ inSync: 1, adapterAhead: 1, twinAhead: 1, conflict: 1 });
    expect(r.diff.outcome).toBe("conflict"); // any conflict dominates
  });

  it("pure adapter-ahead / twin-ahead outcomes", () => {
    const a = computeReconciliationDiff({
      tenantId: TENANT_A, now: NOW,
      adapterRecords: [rec("x", "1", TENANT_A)], twinRecords: [],
    });
    expect(a.ok && a.diff.outcome).toBe("adapter-ahead");
    const t = computeReconciliationDiff({
      tenantId: TENANT_A, now: NOW,
      adapterRecords: [], twinRecords: [rec("x", "1")],
    });
    expect(t.ok && t.diff.outcome).toBe("twin-ahead");
  });

  it("mutual divergence (both sides ahead) is a conflict outcome", () => {
    const r = computeReconciliationDiff({
      tenantId: TENANT_A, now: NOW,
      adapterRecords: [rec("a", "1", TENANT_A)], twinRecords: [rec("b", "2")],
    });
    expect(r.ok && r.diff.outcome).toBe("conflict");
  });

  it("entries are sorted by id regardless of input order (determinism)", () => {
    const adapter = [rec("c", "3", TENANT_A), rec("a", "1", TENANT_A), rec("b", "2", TENANT_A)];
    const twin = [rec("b", "2"), rec("c", "3"), rec("a", "1")];
    const r1 = computeReconciliationDiff({ tenantId: TENANT_A, now: NOW, adapterRecords: adapter, twinRecords: twin });
    const r2 = computeReconciliationDiff({
      tenantId: TENANT_A, now: NOW,
      adapterRecords: [...adapter].reverse(), twinRecords: [...twin].reverse(),
    });
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.diff.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
      expect(r1.diff.digest).toBe(r2.diff.digest); // byte-identical
      expect(JSON.stringify(r1.diff)).toBe(JSON.stringify(r2.diff));
    }
  });
});

describe("adcos reconciliation: fail-closed inputs", () => {
  it("refuses an adapter record from another tenant (fail-closed, whole call)", () => {
    const r = computeReconciliationDiff({
      tenantId: TENANT_A, now: NOW,
      adapterRecords: [rec("x", "1", TENANT_B)], twinRecords: [],
    });
    expect(r).toMatchObject({ ok: false, reason: "tenant-mismatch" });
  });

  it("refuses invalid now and missing tenant", () => {
    expect(computeReconciliationDiff({ tenantId: "", now: NOW, adapterRecords: [], twinRecords: [] })).toMatchObject({ ok: false, reason: "missing-tenant-id" });
    expect(computeReconciliationDiff({ tenantId: TENANT_A, now: 0, adapterRecords: [], twinRecords: [] })).toMatchObject({ ok: false, reason: "invalid-now" });
    expect(computeReconciliationDiff({ tenantId: TENANT_A, now: Number.NaN, adapterRecords: [], twinRecords: [] })).toMatchObject({ ok: false, reason: "invalid-now" });
  });

  it("refuses duplicate ids and missing id/digest within a side", () => {
    expect(computeReconciliationDiff({
      tenantId: TENANT_A, now: NOW,
      adapterRecords: [rec("x", "1", TENANT_A), rec("x", "2", TENANT_A)], twinRecords: [],
    })).toMatchObject({ ok: false, reason: "duplicate-record" });
    expect(computeReconciliationDiff({
      tenantId: TENANT_A, now: NOW,
      adapterRecords: [rec("", "1", TENANT_A)], twinRecords: [],
    })).toMatchObject({ ok: false, reason: "missing-record-id" });
    expect(computeReconciliationDiff({
      tenantId: TENANT_A, now: NOW,
      adapterRecords: [], twinRecords: [rec("x", "")],
    })).toMatchObject({ ok: false, reason: "missing-record-digest" });
  });
});

describe("adcos reconciliation: twin-authoritative resolution", () => {
  const adapter = [rec("a", "1", TENANT_A), rec("b", "2", TENANT_A), rec("c", "3", TENANT_A)];
  const twin = [rec("a", "1"), rec("b", "2-CHANGED"), rec("d", "4")];

  it("diff digest verifies and detects tampering (any entry field)", () => {
    const r = computeReconciliationDiff({ tenantId: TENANT_A, now: NOW, adapterRecords: adapter, twinRecords: twin });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(verifyReconciliationDiff(r.diff)).toBe(true);
    // Tamper an entry class (e.g. hide a conflict as in-sync).
    const tamperedClass = {
      ...r.diff,
      entries: r.diff.entries.map((e) => ({ ...e, class: "in-sync" as const })),
    };
    expect(verifyReconciliationDiff(tamperedClass)).toBe(false);
    // Tamper an entry digest.
    const tamperedDigest = {
      ...r.diff,
      entries: r.diff.entries.map((e) => ({ ...e, twinDigest: e.twinDigest === null ? null : "x" })),
    };
    expect(verifyReconciliationDiff(tamperedDigest)).toBe(false);
    // Tamper the at.
    expect(verifyReconciliationDiff({ ...r.diff, at: r.diff.at + 1 })).toBe(false);
  });

  it("conflicts adopt the twin; adapter-only is dropped; twin-only adopted", () => {
    const r = computeReconciliationDiff({ tenantId: TENANT_A, now: NOW, adapterRecords: adapter, twinRecords: twin });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const plan = resolveReconciliation(r.diff);
    const actions = new Map(plan.actions.map((a) => [a.id, a.action] as const));
    expect(actions.get("a")).toBe("none"); // in-sync
    expect(actions.get("b")).toBe("adopt-twin"); // conflict -> twin wins
    expect(actions.get("c")).toBe("drop-adapter"); // adapter-only -> twin omission authoritative
    expect(actions.get("d")).toBe("adopt-twin"); // twin-only

    const post = applyReconciliation(adapter, plan, twin);
    const byId = new Map(post.map((p) => [p.id, p.digest] as const));
    expect(byId.get("b")).toBe("2-CHANGED");
    expect(byId.has("c")).toBe(false);
    expect(byId.get("d")).toBe("4");
    expect(verifyReconciliation(post, twin)).toBe(true);
  });

  it("verifyReconciliation detects residual divergence", () => {
    expect(verifyReconciliation([rec("a", "1", TENANT_A)], [rec("a", "2")])).toBe(false);
    expect(verifyReconciliation([rec("a", "1", TENANT_A)], [rec("a", "1"), rec("b", "2")])).toBe(false);
    expect(verifyReconciliation([], [])).toBe(true);
  });
});
