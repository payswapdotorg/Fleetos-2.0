/**
 * @fleetos/control-tower — typed drill-down refs + the cross-lane attention
 * queue (F241 tower-assembly support).
 *
 * Every ref is TYPED (lane, entity kind, id, provenance) so a drill-down
 * from the cockpit lands on the owning lane's read-model — and so universal
 * search (./search.ts) can index the SAME refs deterministically.
 *
 * The attention queue is the tower's deterministic cross-lane priority
 * ordering: a fixed severity ladder with stable tie-breaks (priority asc,
 * lane asc, id asc) — never input order.
 */

import type { TowerLane } from "./tower-core.js";

// ---------------------------------------------------------------------------
// Typed drill-down refs
// ---------------------------------------------------------------------------

/** A typed pointer from the tower into an owning lane's read-model. */
export interface TowerEntityRef {
  readonly lane: TowerLane;
  readonly entityKind: "asset" | "finding" | "work-item" | "advisory-card";
  readonly id: string;
  /** Presentation label (asset display name, finding kind, work title…). */
  readonly title: string;
  readonly provenance: { readonly recordKind: string; readonly recordId: string };
}

export function towerRef(
  lane: TowerLane,
  entityKind: TowerEntityRef["entityKind"],
  id: string,
  title: string,
  recordKind: string,
): TowerEntityRef {
  return {
    lane,
    entityKind,
    id,
    title,
    provenance: { recordKind, recordId: id },
  };
}

// ---------------------------------------------------------------------------
// The attention queue — cross-lane, deterministic priority ordering
// ---------------------------------------------------------------------------

/** Lower priority value = more urgent. The ladder is tower-local policy. */
export const ATTENTION_PRIORITY = {
  criticalFinding: 0,
  highFinding: 1,
  criticalAssetPosture: 2,
  blockedWorkItem: 3,
  mediumFinding: 4,
  warningAssetPosture: 5,
} as const;

/** One cross-lane attention item presented on the tower. */
export interface TowerAttentionItem {
  readonly priority: number;
  readonly lane: TowerLane;
  readonly entityKind: TowerEntityRef["entityKind"];
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly ref: TowerEntityRef;
}

/** Deterministic total order: priority asc, lane asc, id asc. */
export function compareAttentionItems(
  a: TowerAttentionItem,
  b: TowerAttentionItem,
): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.lane !== b.lane) return a.lane < b.lane ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function sortAttentionItems(
  items: readonly TowerAttentionItem[],
): readonly TowerAttentionItem[] {
  return [...items].sort(compareAttentionItems);
}
