/**
 * F241 universal search tests — deterministic ranked token lookup over the
 * tower's read-models, tenant fail-closed, stable tie-breaks.
 */

import { describe, expect, it } from "vitest";
import {
  searchTower,
  tokenize,
  verifyTowerSearchDigest,
  type TowerSearchResult,
} from "../src/search.js";
import { assembleControlTower, type ControlTowerView } from "../src/tower-assembly.js";
import { makeTowerState, NOW, TENANT } from "./helpers.js";

function towerOk(): ControlTowerView {
  const result = assembleControlTower(makeTowerState(), { now: NOW });
  if (!result.ok) throw new Error(result.detail);
  return result.tower;
}

function searchOk(tower: ControlTowerView, query: string): TowerSearchResult {
  const result = searchTower(tower, query);
  if (!result.ok) throw new Error(`${result.refused}: ${result.detail}`);
  return result.result;
}

describe("tokenize", () => {
  it("splits lowercase alphanumeric tokens and drops separators", () => {
    expect(tokenize("Tower-Crane 3!")).toEqual(["tower", "crane", "3"]);
    expect(tokenize("...")).toEqual([]);
  });
});

describe("searchTower — ranked typed refs", () => {
  it("finds assets by title token with typed lane refs and provenance", () => {
    const result = searchOk(towerOk(), "crane");
    expect(result.items.length).toBe(1);
    const item = result.items[0]!;
    expect(item.ref).toMatchObject({
      lane: "asset-field",
      entityKind: "asset",
      id: "ast_towercrane",
      title: "Tower Crane 3",
    });
    expect(item.ref.provenance).toEqual({ recordKind: "managed-asset", recordId: "ast_towercrane" });
    expect(item.score).toBe(3); // exact title token
  });

  it("finds findings by kind token and work items by id token", () => {
    const tower = towerOk();
    const firmware = searchOk(tower, "firmware");
    expect(firmware.items.map((item) => item.ref.id)).toEqual(["sf-001"]);
    const byId = searchOk(tower, "102");
    expect(byId.items.map((item) => item.ref.id)).toEqual(["w-102"]);
    expect(byId.items[0]?.ref.entityKind).toBe("work-item");
  });

  it("applies AND semantics across query tokens (no partial matches)", () => {
    const tower = towerOk();
    expect(searchOk(tower, "tower crane").items.map((item) => item.ref.id)).toEqual(["ast_towercrane"]);
    expect(searchOk(tower, "crane generator").items).toEqual([]);
  });

  it("ranks by score desc with stable tie-breaks (lane, entityKind, id)", () => {
    const tower = towerOk();
    // 'title-' is an exact title token for all three work items -> equal score
    const result = searchOk(tower, "title");
    expect(result.items.map((item) => item.ref.id)).toEqual(["w-101", "w-102", "w-103"]);
    // a title exact (3) outranks an id prefix (1)
    const mixed = searchOk(tower, "crane 3");
    expect(mixed.items[0]?.ref.id).toBe("ast_towercrane");
  });

  it("scores id-prefix matches below exact matches", () => {
    const result = searchOk(towerOk(), "ast");
    expect(result.items.every((item) => item.score >= 1)).toBe(true);
    expect(result.items.map((item) => item.ref.id)).toEqual(["ast_genset01", "ast_towercrane"]);
  });

  it("matches the entity-kind token", () => {
    const result = searchOk(towerOk(), "finding");
    expect(result.items.map((item) => item.ref.id)).toEqual(["sf-001", "sf-002", "sf-003"]);
  });

  it("carries matched tokens per item", () => {
    const result = searchOk(towerOk(), "tower crane");
    expect(result.items[0]?.matchedTokens).toEqual(["tower", "crane"]);
  });
});

describe("searchTower — tenant fail-closed + tamper evidence", () => {
  it("refuses a missing tenant scope", () => {
    const tower = { ...towerOk(), tenantId: "" } as ControlTowerView;
    const result = searchTower(tower, "crane");
    expect(result).toMatchObject({ ok: false, refused: "missing-tenant" });
  });

  it("refuses search over a tampered tower (digest must verify first)", () => {
    const tampered = { ...towerOk(), rollups: { ...towerOk().rollups, assets: 99 } } as ControlTowerView;
    const result = searchTower(tampered, "crane");
    expect(result).toMatchObject({ ok: false, refused: "tower-digest-invalid" });
  });

  it("yields ZERO results (never partial) for tokens of another tenant's entities", () => {
    const tower = towerOk(); // tenant A's corpus only
    const result = searchOk(tower, "other99");
    expect(result.items).toEqual([]);
    expect(result.tenantId).toBe(TENANT);
  });

  it("refuses an empty query", () => {
    const result = searchTower(towerOk(), "  ...  ");
    expect(result).toMatchObject({ ok: false, refused: "empty-query" });
  });

  it("verifies its own result digest and detects tampering", () => {
    const tower = towerOk();
    const result = searchOk(tower, "crane");
    expect(verifyTowerSearchDigest(result)).toBe(true);
    const tampered = { ...result, items: [...result.items, result.items[0]!] };
    expect(verifyTowerSearchDigest(tampered as TowerSearchResult)).toBe(false);
  });
});

describe("searchTower — determinism", () => {
  it("is byte-identical for identical (tower, query) pairs", () => {
    const a = searchOk(towerOk(), "tower");
    const b = searchOk(towerOk(), "tower");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces identical results for towers assembled from reordered lane input", () => {
    const state = makeTowerState();
    const reordered = assembleControlTower(
      {
        ...state,
        work: { ...state.work, workItems: [...state.work.workItems].reverse() },
        safety: { ...state.safety, findings: [...state.safety.findings].reverse() },
      },
      { now: NOW },
    );
    if (!reordered.ok) throw new Error(reordered.detail);
    const a = searchOk(towerOk(), "title");
    const b = searchOk(reordered.tower, "title");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
