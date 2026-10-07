/**
 * F241 tower-assembly tests — the tenant-scoped cockpit composed from the
 * three Wave-4 experience lanes' REAL read-model outputs.
 */

import { describe, expect, it } from "vitest";
import { assembleFleetOverview } from "@fleetos/experience-asset-field";
import { buildFindingViews, type AdvisoryCardView } from "@fleetos/experience-safety-intel";
import { buildWorkBoard } from "@fleetos/experience-work-commerce";
import {
  assembleControlTower,
  verifyControlTowerDigest,
  type ControlTowerState,
  type TowerFindingRecord,
} from "../src/tower-assembly.js";
import {
  makeAdvisoryCards,
  makeFinding,
  makeRemediation,
  makeTowerState,
  makeWorkItem,
  NOW,
  TENANT,
  TENANT_B,
} from "./helpers.js";

function assembleOk(state: ControlTowerState, now: number = NOW) {
  const result = assembleControlTower(state, { now });
  if (!result.ok) throw new Error(`tower refused: ${result.refused} ${result.detail}`);
  return result.tower;
}

describe("assembleControlTower — real cross-lane composition", () => {
  it("derives every section from the lanes' REAL read-model outputs", () => {
    const state = makeTowerState();
    const tower = assembleOk(state);
    const fleet = assembleFleetOverview(state.assetField, { now: NOW });
    const safety = buildFindingViews({
      tenantId: TENANT,
      findings: state.safety.findings,
      remediations: state.safety.remediations,
    });
    const work = buildWorkBoard({
      tenant: { tenantId: TENANT },
      workItems: state.work.workItems,
      computedAt: state.work.computedAt,
    });
    if (!fleet.ok || !safety.ok || !work.ok) throw new Error("lane refused");
    expect(tower.fleet.digest).toBe(fleet.view.digest);
    expect(tower.fleet.counters).toEqual(fleet.view.counters);
    expect(tower.safety.digest).toBe(safety.views.rollup.digest);
    expect(tower.safety.totalFindings).toBe(safety.views.rollup.totalFindings);
    expect(tower.safety.bySeverity).toEqual(safety.views.rollup.bySeverity);
    expect(tower.work.digest).toBe(work.board.digest);
    expect(tower.work.totals).toEqual(work.board.totals);
    expect(tower.advisory.digest.length).toBeGreaterThan(0);
  });

  it("computes global rollups across the lanes", () => {
    const tower = assembleOk(makeTowerState());
    expect(tower.rollups).toEqual({
      assets: 2,
      devices: 2,
      activeAssets: 2,
      openFindings: 3,
      criticalFindings: 1,
      workItems: 3,
      blockedWorkItems: 1,
      advisoryCards: 1,
    });
  });

  it("presents typed drill-down refs for every lane entity", () => {
    const tower = assembleOk(makeTowerState());
    expect(tower.fleet.assetRefs.map((ref) => [ref.lane, ref.entityKind, ref.id])).toEqual([
      ["asset-field", "asset", "ast_genset01"],
      ["asset-field", "asset", "ast_towercrane"],
    ]);
    expect(tower.safety.findingRefs.map((ref) => ref.id)).toEqual(["sf-001", "sf-002", "sf-003"]);
    // work refs follow the lane board's canonical column order (todo → …)
    expect(tower.work.workRefs.map((ref) => ref.id)).toEqual(["w-103", "w-101", "w-102"]);
    expect(tower.fleet.assetRefs[0]?.provenance).toEqual({
      recordKind: "managed-asset",
      recordId: "ast_genset01",
    });
  });

  it("orders the attention queue by the deterministic cross-lane ladder", () => {
    const tower = assembleOk(makeTowerState());
    expect(tower.attention.map((item) => [item.priority, item.lane, item.id])).toEqual([
      [0, "safety-intel", "sf-001"], // critical finding
      [1, "safety-intel", "sf-002"], // high finding
      [2, "asset-field", "ast_towercrane"], // critical asset posture
      [3, "work-commerce", "w-102"], // blocked work item
      [5, "asset-field", "ast_genset01"], // warning asset posture
    ]);
  });

  it("carries the machine-carried advisory marker through the advisory section", () => {
    const tower = assembleOk(makeTowerState());
    expect(tower.advisory.advisory).toBe(true);
    expect(tower.advisory.cardRefs.length).toBe(1);
    expect(tower.advisory.cardRefs[0]?.entityKind).toBe("advisory-card");
  });

  it("advisory cards are structurally unable to feed back as authoritative state", () => {
    const cards = makeAdvisoryCards();
    const card = cards[0] as AdvisoryCardView;
    expect(card.advisory).toBe(true);
    // The advisory card is NOT a finding record — structurally rejected:
    // @ts-expect-error an AdvisoryCardView is not a TowerFindingRecord
    const findings: readonly TowerFindingRecord[] = [card];
    expect(findings.length).toBe(1); // only proves the cast would be needed; the type system refuses it above
  });
});

describe("assembleControlTower — fail-closed tenancy across the whole tower", () => {
  it("refuses a missing tenant scope with no partial tower", () => {
    const state = makeTowerState();
    const result = assembleControlTower({ ...state, tenantId: "" }, { now: NOW });
    expect(result).toMatchObject({ ok: false, refused: "missing-tenant" });
  });

  it("refuses a tower/slice tenant mismatch", () => {
    const state = makeTowerState();
    const result = assembleControlTower({ ...state, tenantId: TENANT_B }, { now: NOW });
    expect(result).toMatchObject({ ok: false, refused: "tenant-mismatch" });
  });

  it("refuses an invalid logical now", () => {
    const result = assembleControlTower(makeTowerState(), { now: 0 });
    expect(result).toMatchObject({ ok: false, refused: "invalid-now" });
  });

  it("surfaces lane A's REAL refusal for a cross-tenant asset", () => {
    const base = makeTowerState();
    const state: ControlTowerState = {
      ...base,
      assetField: {
        ...base.assetField,
        assets: [
          ...base.assetField.assets,
          { ...base.assetField.assets[0]!, id: "ast_foreign" as never, tenantId: TENANT_B },
        ],
      },
    };
    const result = assembleControlTower(state, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.refused).toBe("asset-field-refused");
    expect(result.laneCode).toBe("cross-tenant-ref");
  });

  it("surfaces lane B's REAL refusal for a cross-tenant finding", () => {
    const state = makeTowerState();
    state.safety.findings = [
      ...state.safety.findings,
      makeFinding({ findingId: "sf-x", tenantId: TENANT_B }),
    ];
    const result = assembleControlTower(state, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.refused).toBe("safety-intel-refused");
    expect(result.laneCode).toBe("views.cross-tenant-finding");
  });

  it("surfaces lane C's REAL refusal for a cross-tenant work item", () => {
    const state = makeTowerState();
    state.work.workItems = [
      ...state.work.workItems,
      makeWorkItem("w-999", "todo", { tenant: { tenantId: TENANT_B } }),
    ];
    const result = assembleControlTower(state, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.refused).toBe("work-commerce-refused");
    expect(result.detail).toContain("TENANT_MISMATCH");
  });

  it("refuses the whole tower when an advisory card is cross-tenant", () => {
    const state = makeTowerState();
    state.advisoryCards = makeAdvisoryCards(TENANT_B);
    const result = assembleControlTower(state, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.refused).toBe("advisory-refused");
    expect(result.laneCode).toBe("card.cross-tenant-card");
  });

  it("presents an empty advisory section (not a refusal) when no cards exist", () => {
    const state = makeTowerState();
    const result = assembleControlTower({ ...state, advisoryCards: [] }, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(result.tower.advisory.cardRefs).toEqual([]);
    expect(result.tower.rollups.advisoryCards).toBe(0);
  });
});

describe("assembleControlTower — determinism + tamper evidence", () => {
  it("is byte-identical for identical inputs", () => {
    const a = assembleOk(makeTowerState());
    const b = assembleOk(makeTowerState());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is order-independent over lane record inputs (identical digest)", () => {
    const a = assembleOk(makeTowerState());
    const state = makeTowerState();
    const tower = assembleOk({
      ...state,
      assetField: {
        ...state.assetField,
        assets: [...state.assetField.assets].reverse(),
        devices: [...state.assetField.devices].reverse(),
        findings: [...state.assetField.findings].reverse(),
      },
      safety: {
        findings: [...state.safety.findings].reverse(),
        remediations: [...state.safety.remediations].reverse(),
      },
      work: { ...state.work, workItems: [...state.work.workItems].reverse() },
    });
    expect(tower.digest).toBe(a.digest);
  });

  it("verifies the tower digest and detects tampering", () => {
    const tower = assembleOk(makeTowerState());
    expect(verifyControlTowerDigest(tower)).toBe(true);
    const tampered = { ...tower, rollups: { ...tower.rollups, assets: 99 } };
    expect(verifyControlTowerDigest(tampered)).toBe(false);
  });

  it("includes every section digest in the tower digest (advisory included)", () => {
    const tower = assembleOk(makeTowerState());
    const withoutAdvisory = assembleOk({ ...makeTowerState(), advisoryCards: [] });
    expect(tower.digest).not.toBe(withoutAdvisory.digest);
    const remediating = assembleOk({
      ...makeTowerState(),
      safety: {
        ...makeTowerState().safety,
        remediations: [makeRemediation({ state: "verified" })],
      },
    });
    // the rollup digest covers findings; the remediation digest covers proposals
    expect(tower.safety.digest).toBe(remediating.safety.digest);
    expect(tower.safety.remediationDigest).not.toBe(remediating.safety.remediationDigest);
    expect(tower.digest).not.toBe(remediating.digest);
  });
});
