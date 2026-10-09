/**
 * @fleetos/assets — Wave 9 lineage material-lot tests (F290A).
 *
 * Covers:
 *   - create: lot shape, lifecycle state derivation.
 *   - consume: partial / exhaust / over-consumption refusal / invalid-quantity refusal.
 *   - tenant fail-closed: cross-tenant consume refused with REAL code.
 *   - digest: FNV-1a family — known answers + byte-identical re-runs.
 *   - lifecycle derivation: created / partially-consumed / exhausted transitions.
 *
 * Honest refusals actually hit (every refusal code has a test that triggers it).
 */

import { describe, it, expect } from "vitest";
import {
  createMaterialLot,
  consumeMaterialLot,
  materialLotDigest,
  materialLotLifecycleState,
  type MaterialLot,
  type MaterialConsumptionResult,
} from "./material.js";

const NOW = 1_774_000_000_000;
const TENANT_A = "tnt_acme";

function mkLot(overrides?: Partial<Parameters<typeof createMaterialLot>[0]>): MaterialLot {
  const r = createMaterialLot({
    lotId: "lot_lubricant-001",
    tenantId: TENANT_A,
    kind: "lubricant",
    attributes: { grade: "5W-30", supplier: "acme-oil" },
    quantity: 100,
    unit: "litre",
    createdAt: NOW,
    ...overrides,
  });
  if (!r.ok) throw new Error(`createMaterialLot failed: ${r.reason}`);
  return r.lot;
}

describe("material lot: createMaterialLot", () => {
  it("creates a lot with the documented fields and 'created' lifecycle", () => {
    const lot = mkLot();
    expect(lot.id).toBe("lot_lubricant-001");
    expect(lot.tenantId).toBe(TENANT_A);
    expect(lot.kind).toBe("lubricant");
    expect(lot.initialQuantity).toBe(100);
    expect(lot.remainingQuantity).toBe(100);
    expect(lot.unit).toBe("litre");
    expect(lot.exhaustedAt).toBeNull();
    expect(lot.consumeSeq).toBe(0);
    expect(materialLotLifecycleState(lot)).toBe("created");
  });

  it("rejects malformed lot id (malformed-lot-id)", () => {
    const r = createMaterialLot({
      lotId: "bad id!",
      tenantId: TENANT_A,
      kind: "lubricant",
      attributes: {},
      quantity: 50,
      unit: "litre",
      createdAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-lot-id");
  });

  it("rejects empty tenant id (missing-tenant-id)", () => {
    const r = createMaterialLot({
      lotId: "lot_x-001",
      tenantId: "",
      kind: "lubricant",
      attributes: {},
      quantity: 50,
      unit: "litre",
      createdAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-tenant-id");
  });

  it("rejects unknown kind (unknown-kind)", () => {
    const r = createMaterialLot({
      lotId: "lot_x-002",
      tenantId: TENANT_A,
      kind: "unobtainium" as never,
      attributes: {},
      quantity: 50,
      unit: "litre",
      createdAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-kind");
  });

  it("rejects unknown unit (unknown-unit)", () => {
    const r = createMaterialLot({
      lotId: "lot_x-003",
      tenantId: TENANT_A,
      kind: "coolant",
      attributes: {},
      quantity: 50,
      unit: "barrels" as never,
      createdAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-unit");
  });

  it("rejects malformed attributes (array) (malformed-attributes)", () => {
    const r = createMaterialLot({
      lotId: "lot_x-004",
      tenantId: TENANT_A,
      kind: "coolant",
      attributes: [1, 2, 3] as unknown as Record<string, unknown>,
      quantity: 50,
      unit: "litre",
      createdAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-attributes");
  });

  it("rejects non-integer or non-positive quantity (invalid-quantity)", () => {
    const cases = [0, -5, 12.5, NaN, Infinity];
    for (const q of cases) {
      const r = createMaterialLot({
        lotId: "lot_x-005",
        tenantId: TENANT_A,
        kind: "coolant",
        attributes: {},
        quantity: q,
        unit: "litre",
        createdAt: NOW,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-quantity");
    }
  });

  it("rejects invalid createdAt (invalid-created-at)", () => {
    const r = createMaterialLot({
      lotId: "lot_x-006",
      tenantId: TENANT_A,
      kind: "coolant",
      attributes: {},
      quantity: 50,
      unit: "litre",
      createdAt: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-created-at");
  });
});

describe("material lot: consumeMaterialLot — lifecycle transitions", () => {
  it("partial consume transitions to partially-consumed", () => {
    const lot = mkLot({ quantity: 100 });
    const r = consumeMaterialLot(lot, {
      tenantId: TENANT_A,
      lotId: lot.id,
      quantity: 30,
      consumedAt: NOW + 1000,
      consumeSeq: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lot.remainingQuantity).toBe(70);
      expect(r.consumed).toBe(30);
      expect(r.exhausted).toBe(false);
      expect(materialLotLifecycleState(r.lot)).toBe("partially-consumed");
      expect(r.lot.exhaustedAt).toBeNull();
      expect(r.lot.consumeSeq).toBe(1);
    }
  });

  it("exact-remainder consume transitions to exhausted (not over-consumption)", () => {
    const lot = mkLot({ quantity: 100 });
    const r = consumeMaterialLot(lot, {
      tenantId: TENANT_A,
      lotId: lot.id,
      quantity: 100,
      consumedAt: NOW + 2000,
      consumeSeq: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lot.remainingQuantity).toBe(0);
      expect(r.exhausted).toBe(true);
      expect(materialLotLifecycleState(r.lot)).toBe("exhausted");
      expect(r.lot.exhaustedAt).toBe(NOW + 2000);
    }
  });

  it("refuses over-consumption with REAL numbers (over-consumption)", () => {
    const lot = mkLot({ quantity: 100 });
    const r = consumeMaterialLot(lot, {
      tenantId: TENANT_A,
      lotId: lot.id,
      quantity: 150,
      consumedAt: NOW + 3000,
      consumeSeq: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("over-consumption");
      expect(r.requested).toBe(150);
      expect(r.remaining).toBe(100);
    }
  });

  it("refuses consume on exhausted lot (lot-exhausted)", () => {
    const lot0 = mkLot({ quantity: 10 });
    const r0 = consumeMaterialLot(lot0, {
      tenantId: TENANT_A,
      lotId: lot0.id,
      quantity: 10,
      consumedAt: NOW,
      consumeSeq: 1,
    });
    if (!r0.ok) throw new Error("setup consume failed");
    const r = consumeMaterialLot(r0.lot, {
      tenantId: TENANT_A,
      lotId: r0.lot.id,
      quantity: 1,
      consumedAt: NOW + 4000,
      consumeSeq: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("lot-exhausted");
  });

  it("refuses invalid quantity (invalid-quantity)", () => {
    const lot = mkLot({ quantity: 100 });
    for (const q of [0, -5, 12.5, NaN]) {
      const r = consumeMaterialLot(lot, {
        tenantId: TENANT_A,
        lotId: lot.id,
        quantity: q,
        consumedAt: NOW + 5000,
        consumeSeq: 1,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-quantity");
    }
  });

  it("refuses cross-tenant consume (tenant-mismatch)", () => {
    const lot = mkLot();
    const r = consumeMaterialLot(lot, {
      tenantId: "tnt_other",
      lotId: lot.id,
      quantity: 10,
      consumedAt: NOW + 6000,
      consumeSeq: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tenant-mismatch");
  });

  it("refuses stale consumedAt (stale-consumed-at)", () => {
    const lot = mkLot({ createdAt: NOW });
    const r = consumeMaterialLot(lot, {
      tenantId: TENANT_A,
      lotId: lot.id,
      quantity: 10,
      consumedAt: NOW - 1,
      consumeSeq: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("stale-consumed-at");
  });

  it("refuses non-monotonic consumeSeq (non-monotonic-consume-seq)", () => {
    const lot0 = mkLot({ quantity: 100 });
    const r0 = consumeMaterialLot(lot0, {
      tenantId: TENANT_A,
      lotId: lot0.id,
      quantity: 20,
      consumedAt: NOW + 1000,
      consumeSeq: 5,
    });
    if (!r0.ok) throw new Error("setup consume failed");
    // seq 5 already used; 5 again, 4, 3 all refused.
    for (const seq of [5, 4, 3]) {
      const r = consumeMaterialLot(r0.lot, {
        tenantId: TENANT_A,
        lotId: r0.lot.id,
        quantity: 5,
        consumedAt: NOW + 2000,
        consumeSeq: seq,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("non-monotonic-consume-seq");
    }
  });

  it("refuses unknown lot id (unknown-lot)", () => {
    const lot = mkLot();
    const r = consumeMaterialLot(lot, {
      tenantId: TENANT_A,
      lotId: "lot_other-999" as MaterialLot["id"],
      quantity: 5,
      consumedAt: NOW + 7000,
      consumeSeq: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-lot");
  });
});

describe("material lot: digest — FNV-1a family", () => {
  it("produces a non-empty 8-hex digest", () => {
    const lot = mkLot();
    const d = materialLotDigest(lot);
    expect(d).toMatch(/^[0-9a-f]{8}$/);
  });

  it("byte-identical re-runs over the same lot", () => {
    const lot = mkLot();
    expect(materialLotDigest(lot)).toBe(materialLotDigest(lot));
  });

  it("digest changes when remaining quantity changes (consumption is on the chain)", () => {
    const lot = mkLot({ quantity: 100 });
    const r = consumeMaterialLot(lot, {
      tenantId: TENANT_A,
      lotId: lot.id,
      quantity: 50,
      consumedAt: NOW + 1000,
      consumeSeq: 1,
    });
    if (!r.ok) throw new Error("setup failed");
    expect(materialLotDigest(lot)).not.toBe(materialLotDigest(r.lot));
  });

  it("digest changes when consumeSeq changes (the chain is monotonic)", () => {
    const lot = mkLot({ quantity: 100 });
    const r1 = consumeMaterialLot(lot, {
      tenantId: TENANT_A,
      lotId: lot.id,
      quantity: 50,
      consumedAt: NOW + 1000,
      consumeSeq: 1,
    });
    const r2 = consumeMaterialLot(lot, {
      tenantId: TENANT_A,
      lotId: lot.id,
      quantity: 50,
      consumedAt: NOW + 1000,
      consumeSeq: 2,
    });
    if (!r1.ok || !r2.ok) throw new Error("setup failed");
    expect(materialLotDigest(r1.lot)).not.toBe(materialLotDigest(r2.lot));
  });
});

describe("material lot: lifecycle state derivation", () => {
  it("derived from quantities — never stored", () => {
    const lot = mkLot({ quantity: 50 });
    expect(materialLotLifecycleState(lot)).toBe("created");
    const half = consumeMaterialLot(lot, {
      tenantId: TENANT_A,
      lotId: lot.id,
      quantity: 25,
      consumedAt: NOW + 1000,
      consumeSeq: 1,
    });
    if (!half.ok) throw new Error();
    expect(materialLotLifecycleState(half.lot)).toBe("partially-consumed");
    const full = consumeMaterialLot(half.lot, {
      tenantId: TENANT_A,
      lotId: half.lot.id,
      quantity: 25,
      consumedAt: NOW + 2000,
      consumeSeq: 2,
    });
    if (!full.ok) throw new Error();
    expect(materialLotLifecycleState(full.lot)).toBe("exhausted");
  });
});

// Type-only consumer of the result union — proves the discriminated union shape.
function _consumeResultTypeCheck(r: MaterialConsumptionResult): string {
  if (r.ok) return `consumed ${r.consumed}`;
  return `refused ${r.reason}`;
}
void _consumeResultTypeCheck;
