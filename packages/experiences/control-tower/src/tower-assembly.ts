/**
 * @fleetos/control-tower — `assembleControlTower` (F241 deliverable 1).
 *
 * The tenant-scoped cockpit: cross-lane sections assembled from the three
 * Wave-4 experience packages' REAL read-model outputs (fleet overview from
 * `@fleetos/experience-asset-field`, finding views + the advisory board
 * from `@fleetos/experience-safety-intel`, the work board from
 * `@fleetos/experience-work-commerce`), global rollups, typed drill-down
 * refs, the deterministic cross-lane attention queue, and ONE tower-level
 * tamper-evident FNV-1a digest chaining every section digest.
 *
 * TENANT FAIL-CLOSED across the WHOLE tower (A8): a missing tenant, a
 * tenant mismatch between the tower scope and any lane slice, or any lane
 * refusing its own assembly refuses the ENTIRE tower — there is no partial
 * tower. Every lane builder runs its own fail-closed guard (cross-tenant
 * records, duplicate ids, malformed tenants); the tower surfaces the lane's
 * refusal code verbatim in `laneCode`.
 *
 * ADIVISORY LAW (A2, structural): advisory cards are PRESENTED in their own
 * section carrying `advisory: true` machine-carried end-to-end; they are
 * never blended into the authoritative lane sections and can never feed
 * back as authoritative state (test-pinned at the type level).
 *
 * Determinism: pure fold over the caller-supplied state; identical inputs
 * produce a byte-identical tower including the digest.
 */

import {
  assembleFleetOverview,
  type ExperienceStateSlice,
  type FleetOverview,
} from "@fleetos/experience-asset-field";
import {
  buildAdvisoryBoard,
  buildFindingViews,
  type AdvisoryBoardView,
  type AdvisoryCardView,
  type SeverityRollupView,
} from "@fleetos/experience-safety-intel";
import { buildWorkBoard, type WorkBoard } from "@fleetos/experience-work-commerce";
import { TOWER_SCHEMA_VERSION, towerDigestOf, type TowerLane } from "./tower-core.js";
import {
  ATTENTION_PRIORITY,
  sortAttentionItems,
  towerRef,
  type TowerAttentionItem,
  type TowerEntityRef,
} from "./tower-refs.js";

export type { TowerLane } from "./tower-core.js";

// ---------------------------------------------------------------------------
// Input state — the tower's per-lane domain slices
// ---------------------------------------------------------------------------

/** Lane B finding record, extracted from the REAL builder's signature. */
export type TowerFindingRecord = Parameters<typeof buildFindingViews>[0]["findings"][number];
/** Lane B remediation proposal record, extracted the same way. */
export type TowerRemediationRecord = Parameters<typeof buildFindingViews>[0]["remediations"][number];
/** Lane C work item record, extracted from the REAL builder's signature. */
export type TowerWorkItemRecord = Parameters<typeof buildWorkBoard>[0]["workItems"][number];

/**
 * The tower's input state: the tenant scope plus each lane's domain slice
 * (the exact record shapes the lane's own builders consume).
 */
export interface ControlTowerState {
  readonly tenantId: string;
  readonly assetField: ExperienceStateSlice;
  readonly safety: {
    readonly findings: readonly TowerFindingRecord[];
    readonly remediations: readonly TowerRemediationRecord[];
  };
  readonly work: {
    readonly workItems: readonly TowerWorkItemRecord[];
    /** Lane C's logical computation timestamp (caller-supplied string). */
    readonly computedAt: string;
  };
  /** Advisory cards PRESENTED by the tower (never authoritative state). */
  readonly advisoryCards: readonly AdvisoryCardView[];
}

export interface ControlTowerOptions {
  readonly now: number;
}

// ---------------------------------------------------------------------------
// The tower view
// ---------------------------------------------------------------------------

export interface FleetTowerSection {
  readonly lane: "asset-field";
  readonly digest: string;
  readonly counters: FleetOverview["counters"];
  readonly assetRefs: readonly TowerEntityRef[];
}

export interface SafetyTowerSection {
  readonly lane: "safety-intel";
  readonly digest: string;
  readonly remediationDigest: string;
  readonly totalFindings: number;
  readonly bySeverity: SeverityRollupView["bySeverity"];
  readonly totalProposals: number;
  readonly remediatedCount: number;
  readonly findingRefs: readonly TowerEntityRef[];
}

export interface WorkTowerSection {
  readonly lane: "work-commerce";
  readonly digest: string;
  readonly totals: WorkBoard["totals"];
  readonly blockedCount: number;
  readonly workRefs: readonly TowerEntityRef[];
}

export interface AdvisoryTowerSection {
  readonly lane: "safety-intel";
  /** Machine-carried advisory marker (law A2) — never stripped. */
  readonly advisory: true;
  readonly digest: string;
  readonly cardRefs: readonly TowerEntityRef[];
}

export interface TowerRollups {
  readonly assets: number;
  readonly devices: number;
  readonly activeAssets: number;
  readonly openFindings: number;
  readonly criticalFindings: number;
  readonly workItems: number;
  readonly blockedWorkItems: number;
  readonly advisoryCards: number;
}

export interface ControlTowerView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly fleet: FleetTowerSection;
  readonly safety: SafetyTowerSection;
  readonly work: WorkTowerSection;
  readonly advisory: AdvisoryTowerSection;
  readonly rollups: TowerRollups;
  /** Deterministic cross-lane attention queue (priority asc, lane, id). */
  readonly attention: readonly TowerAttentionItem[];
  readonly digest: string;
}

export type TowerRefusal =
  | "missing-tenant"
  | "invalid-now"
  | "tenant-mismatch"
  | "asset-field-refused"
  | "safety-intel-refused"
  | "work-commerce-refused"
  | "advisory-refused";

export type ControlTowerResult =
  | { readonly ok: true; readonly tower: ControlTowerView }
  | {
      readonly ok: false;
      readonly refused: TowerRefusal;
      readonly detail: string;
      /** The refusing lane's own code, surfaced verbatim. */
      readonly laneCode?: string;
    };

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function refuse(
  refused: TowerRefusal,
  detail: string,
  laneCode?: string,
): { readonly ok: false; readonly refused: TowerRefusal; readonly detail: string; readonly laneCode?: string } {
  return laneCode === undefined ? { ok: false, refused, detail } : { ok: false, refused, detail, laneCode };
}

/** Assemble the tenant-scoped cockpit from the lanes' REAL read-models. */
export function assembleControlTower(
  state: ControlTowerState,
  options: ControlTowerOptions,
): ControlTowerResult {
  if (!Number.isFinite(options.now) || options.now <= 0) {
    return refuse("invalid-now", `logical now must be finite and positive, got ${String(options.now)}`);
  }
  if (state.tenantId === "" || state.assetField.tenantId === "") {
    return refuse("missing-tenant", "tower tenant scope or the asset-field slice tenant is empty");
  }
  if (state.tenantId !== state.assetField.tenantId) {
    return refuse(
      "tenant-mismatch",
      `tower scope ${state.tenantId} does not match the asset-field slice tenant ${state.assetField.tenantId}`,
    );
  }

  // --- lane A: the REAL fleet overview (its own fail-closed guard runs) ---
  const fleet = assembleFleetOverview(state.assetField, { now: options.now });
  if (!fleet.ok) {
    return refuse("asset-field-refused", fleet.detail, fleet.rejected);
  }
  const overview = fleet.view;

  // --- lane B: the REAL finding views (tenant fail-closed inside) ---
  const findings = buildFindingViews({
    tenantId: state.tenantId,
    findings: state.safety.findings,
    remediations: state.safety.remediations,
  });
  if (!findings.ok) {
    return refuse("safety-intel-refused", findings.detail, findings.refused);
  }
  const findingViews = findings.views;

  // --- lane C: the REAL work board (tenant fail-closed inside) ---
  const work = buildWorkBoard({
    tenant: { tenantId: state.tenantId },
    workItems: state.work.workItems,
    computedAt: state.work.computedAt,
  });
  if (!work.ok) {
    return refuse("work-commerce-refused", `${work.reasonCode}: ${work.detail}`);
  }
  const workBoard = work.board;

  // --- lane B advisory cards: PRESENTED through the REAL board builder ---
  // The board validates card-to-card consistency; the TOWER enforces the
  // board's tenant against its own scope (fail closed, no partial tower).
  let advisoryBoard: AdvisoryBoardView | null = null;
  if (state.advisoryCards.length > 0) {
    const board = buildAdvisoryBoard(state.advisoryCards);
    if (!board.ok) {
      return refuse("advisory-refused", board.detail, board.refused);
    }
    if (board.board.tenantId !== state.tenantId) {
      return refuse(
        "advisory-refused",
        `advisory board belongs to tenant ${board.board.tenantId}, not ${state.tenantId}`,
        "card.cross-tenant-card",
      );
    }
    advisoryBoard = board.board;
  }

  // --- sections ---
  const fleetSection: FleetTowerSection = {
    lane: "asset-field",
    digest: overview.digest,
    counters: overview.counters,
    assetRefs: overview.cards.map((card) =>
      towerRef("asset-field", "asset", card.assetId, card.displayName, "managed-asset"),
    ),
  };
  const safetySection: SafetyTowerSection = {
    lane: "safety-intel",
    digest: findingViews.rollup.digest,
    remediationDigest: findingViews.remediation.digest,
    totalFindings: findingViews.rollup.totalFindings,
    bySeverity: findingViews.rollup.bySeverity,
    totalProposals: findingViews.remediation.totalProposals,
    remediatedCount: findingViews.remediation.remediatedCount,
    findingRefs: findingViews.triageQueue.items.map((item) =>
      towerRef("safety-intel", "finding", item.findingId, item.kind, "security-finding"),
    ),
  };
  const blockedCards = workBoard.columns
    .flatMap((column) => column.cards)
    .filter((card) => card.blockedReason !== null);
  const workSection: WorkTowerSection = {
    lane: "work-commerce",
    digest: workBoard.digest,
    totals: workBoard.totals,
    blockedCount: blockedCards.length,
    workRefs: workBoard.columns
      .flatMap((column) => column.cards)
      .map((card) => towerRef("work-commerce", "work-item", card.workItemId, card.title, "work-item")),
  };
  const advisorySection: AdvisoryTowerSection = {
    lane: "safety-intel",
    advisory: true,
    digest: advisoryBoard === null
      ? towerDigestOf("advisory-section", { tenantId: state.tenantId, cards: [] })
      : advisoryBoard.digest,
    cardRefs: (advisoryBoard?.cards ?? []).map((card) =>
      towerRef("safety-intel", "advisory-card", card.cardId, card.title, "advisory-card"),
    ),
  };

  // --- rollups (derived from the lanes' own outputs) ---
  const rollups: TowerRollups = {
    assets: overview.counters.assets,
    devices: overview.counters.devices,
    activeAssets: overview.counters.active,
    openFindings: findingViews.rollup.totalFindings,
    criticalFindings: findingViews.rollup.bySeverity.critical,
    workItems: workBoard.totals.reduce((sum, total) => sum + total.count, 0),
    blockedWorkItems: blockedCards.length,
    advisoryCards: advisoryBoard?.cards.length ?? 0,
  };

  // --- the attention queue (deterministic cross-lane ordering) ---
  const attention: TowerAttentionItem[] = [];
  for (const card of overview.cards) {
    if (card.posture === "critical" || card.posture === "warning") {
      attention.push({
        priority: card.posture === "critical"
          ? ATTENTION_PRIORITY.criticalAssetPosture
          : ATTENTION_PRIORITY.warningAssetPosture,
        lane: "asset-field",
        entityKind: "asset",
        id: card.assetId,
        title: card.displayName,
        summary: `posture ${card.posture} (critical findings: ${card.severityCounts.critical})`,
        ref: towerRef("asset-field", "asset", card.assetId, card.displayName, "managed-asset"),
      });
    }
  }
  for (const item of findingViews.triageQueue.items) {
    if (item.severity === "critical" || item.severity === "high" || item.severity === "medium") {
      const priority = item.severity === "critical"
        ? ATTENTION_PRIORITY.criticalFinding
        : item.severity === "high"
          ? ATTENTION_PRIORITY.highFinding
          : ATTENTION_PRIORITY.mediumFinding;
      attention.push({
        priority,
        lane: "safety-intel",
        entityKind: "finding",
        id: item.findingId,
        title: item.kind,
        summary: `severity ${item.severity}, confidence ${item.confidence}`,
        ref: towerRef("safety-intel", "finding", item.findingId, item.kind, "security-finding"),
      });
    }
  }
  for (const card of blockedCards) {
    attention.push({
      priority: ATTENTION_PRIORITY.blockedWorkItem,
      lane: "work-commerce",
      entityKind: "work-item",
      id: card.workItemId,
      title: card.title,
      summary: `blocked: ${card.blockedReason ?? ""}`,
      ref: towerRef("work-commerce", "work-item", card.workItemId, card.title, "work-item"),
    });
  }

  const body = {
    tenantId: state.tenantId,
    asOf: options.now,
    fleet: { digest: fleetSection.digest, assets: fleetSection.counters.assets },
    safety: {
      digest: safetySection.digest,
      remediationDigest: safetySection.remediationDigest,
      total: safetySection.totalFindings,
    },
    work: { digest: workSection.digest, blocked: workSection.blockedCount },
    advisory: { digest: advisorySection.digest },
    rollups,
    attention: sortAttentionItems(attention).map((item) => [item.priority, item.lane, item.id]),
  };
  const tower: ControlTowerView = {
    schemaVersion: TOWER_SCHEMA_VERSION,
    tenantId: state.tenantId,
    asOf: options.now,
    fleet: fleetSection,
    safety: safetySection,
    work: workSection,
    advisory: advisorySection,
    rollups,
    attention: sortAttentionItems(attention),
    digest: towerDigestOf("control-tower", body),
  };
  return { ok: true, tower };
}

/** Recompute the tower digest from the presented view; false = tampered. */
export function verifyControlTowerDigest(tower: ControlTowerView): boolean {
  const body = {
    tenantId: tower.tenantId,
    asOf: tower.asOf,
    fleet: { digest: tower.fleet.digest, assets: tower.fleet.counters.assets },
    safety: {
      digest: tower.safety.digest,
      remediationDigest: tower.safety.remediationDigest,
      total: tower.safety.totalFindings,
    },
    work: { digest: tower.work.digest, blocked: tower.work.blockedCount },
    advisory: { digest: tower.advisory.digest },
    rollups: tower.rollups,
    attention: tower.attention.map((item) => [item.priority, item.lane, item.id]),
  };
  return towerDigestOf("control-tower", body) === tower.digest;
}
