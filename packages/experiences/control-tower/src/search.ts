/**
 * @fleetos/control-tower — universal search (F241 deliverable 3).
 *
 * Deterministic ranked token lookup over the tower's read-models: the SAME
 * typed drill-down refs the cockpit presents (assets, findings, work
 * items). Produces typed refs (lane, entity kind, id, provenance) ranked
 * by a fixed scoring ladder with stable tie-breaks (score desc, lane asc,
 * entityKind asc, id asc) — never input order, never partial results.
 *
 * TENANT FAIL-CLOSED: search runs ONLY over a verified tower view (the
 * tower digest must verify — a tampered tower refuses). The corpus is
 * built exclusively from the tenant-scoped tower, so a token that matches
 * another tenant's entities yields ZERO results — cross-tenant entities
 * cannot appear, not even partially.
 *
 * Determinism: pure function; identical (tower, query) pairs produce
 * byte-identical results including the digest.
 */

import { towerDigestOf } from "./tower-core.js";
import type { TowerEntityRef } from "./tower-refs.js";
import { verifyControlTowerDigest, type ControlTowerView } from "./tower-assembly.js";

// ---------------------------------------------------------------------------
// Tokenization + the corpus
// ---------------------------------------------------------------------------

/** Lowercase tokens split on non-alphanumeric boundaries. */
export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** One searchable corpus document: a typed ref plus weighted token bags. */
export interface TowerSearchDoc {
  readonly ref: TowerEntityRef;
  readonly titleTokens: readonly string[];
  readonly idTokens: readonly string[];
  readonly kindToken: string;
}

/** Build the search corpus from the tower's drill-down refs (lane order fixed). */
export function towerSearchCorpus(tower: ControlTowerView): readonly TowerSearchDoc[] {
  const docs: TowerSearchDoc[] = [];
  for (const ref of tower.fleet.assetRefs) {
    docs.push(docOf(ref));
  }
  for (const ref of tower.safety.findingRefs) {
    docs.push(docOf(ref));
  }
  for (const ref of tower.work.workRefs) {
    docs.push(docOf(ref));
  }
  return docs;
}

function docOf(ref: TowerEntityRef): TowerSearchDoc {
  return {
    ref,
    titleTokens: tokenize(ref.title),
    idTokens: tokenize(ref.id),
    kindToken: ref.entityKind,
  };
}

// ---------------------------------------------------------------------------
// Scoring — fixed weights, stable tie-breaks
// ---------------------------------------------------------------------------

const WEIGHT_TITLE_EXACT = 3;
const WEIGHT_ID_EXACT = 2;
const WEIGHT_TITLE_PREFIX = 2;
const WEIGHT_ID_PREFIX = 1;
const WEIGHT_KIND_EXACT = 1;

/**
 * Score one query token against a document: the highest single weight the
 * token earns (exact title > exact id > title prefix > id prefix > kind).
 */
function scoreToken(doc: TowerSearchDoc, token: string): number {
  if (doc.titleTokens.includes(token)) return WEIGHT_TITLE_EXACT;
  if (doc.idTokens.includes(token)) return WEIGHT_ID_EXACT;
  if (doc.titleTokens.some((t) => t.startsWith(token))) return WEIGHT_TITLE_PREFIX;
  if (doc.idTokens.some((t) => t.startsWith(token))) return WEIGHT_ID_PREFIX;
  if (doc.kindToken === token) return WEIGHT_KIND_EXACT;
  return 0;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface TowerSearchResultItem {
  readonly ref: TowerEntityRef;
  /** Sum of per-token scores; every query token matched at least once. */
  readonly score: number;
  readonly matchedTokens: readonly string[];
}

export interface TowerSearchResult {
  readonly tenantId: string;
  readonly query: string;
  readonly queryTokens: readonly string[];
  readonly items: readonly TowerSearchResultItem[];
  readonly digest: string;
}

export type TowerSearchRefusal =
  | "missing-tenant"
  | "empty-query"
  | "tower-digest-invalid";

export type TowerSearchResultShape =
  | { readonly ok: true; readonly result: TowerSearchResult }
  | { readonly ok: false; readonly refused: TowerSearchRefusal; readonly detail: string };

/** Deterministic total order: score desc, then lane, entityKind, id asc. */
function compareItems(a: TowerSearchResultItem, b: TowerSearchResultItem): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.ref.lane !== b.ref.lane) return a.ref.lane < b.ref.lane ? -1 : 1;
  if (a.ref.entityKind !== b.ref.entityKind) return a.ref.entityKind < b.ref.entityKind ? -1 : 1;
  if (a.ref.id !== b.ref.id) return a.ref.id < b.ref.id ? -1 : 1;
  return 0;
}

/**
 * Universal search over the tower's read-models. AND semantics: a document
 * matches only when EVERY query token matches it; the score sums the
 * per-token weights.
 */
export function searchTower(
  tower: ControlTowerView,
  query: string,
): TowerSearchResultShape {
  if (tower.tenantId === "") {
    return { ok: false, refused: "missing-tenant", detail: "tower tenant scope is empty" };
  }
  if (!verifyControlTowerDigest(tower)) {
    return { ok: false, refused: "tower-digest-invalid", detail: "tower digest failed to verify (tampered view)" };
  }
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return { ok: false, refused: "empty-query", detail: `query '${query}' produced no tokens` };
  }
  const corpus = towerSearchCorpus(tower);
  const items: TowerSearchResultItem[] = [];
  for (const doc of corpus) {
    let score = 0;
    let matchedAll = true;
    const matched: string[] = [];
    for (const token of queryTokens) {
      const tokenScore = scoreToken(doc, token);
      if (tokenScore === 0) {
        matchedAll = false;
        break;
      }
      score += tokenScore;
      matched.push(token);
    }
    if (matchedAll) {
      items.push({ ref: doc.ref, score, matchedTokens: matched });
    }
  }
  const ordered = [...items].sort(compareItems);
  const result: TowerSearchResult = {
    tenantId: tower.tenantId,
    query,
    queryTokens,
    items: ordered,
    digest: towerDigestOf("tower-search", {
      tenantId: tower.tenantId,
      queryTokens,
      items: ordered.map((item) => [item.ref.lane, item.ref.entityKind, item.ref.id, item.score]),
    }),
  };
  return { ok: true, result };
}

/** Recompute the search-result digest; false means tampered output. */
export function verifyTowerSearchDigest(result: TowerSearchResult): boolean {
  const body = {
    tenantId: result.tenantId,
    queryTokens: result.queryTokens,
    items: result.items.map((item) => [item.ref.lane, item.ref.entityKind, item.ref.id, item.score]),
  };
  return towerDigestOf("tower-search", body) === result.digest;
}
