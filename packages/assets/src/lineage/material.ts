/**
 * @fleetos/assets — Wave 9 lineage material-lot domain (F290A).
 *
 * Tenant-scoped material lots: lot id, kind, attributes, quantity + unit,
 * logical timestamps. Lot lifecycle:
 *   - created (remaining === initial)
 *   - partially-consumed (0 < remaining < initial)
 *   - exhausted (remaining === 0)
 *
 * Over-consumption refusals are HONEST and REASON-CODED — a consume call
 * that asks for more than the lot's remaining returns the refusual with the
 * REAL numbers (requested vs remaining), never a silent clamp.
 *
 * Deterministic per-lot digest via the lane's FNV-1a family (local copy in
 * `./digest.ts` — same family the repo's digest chains use).
 *
 * Pure TypeScript, no I/O, no Date.now, no Math.random, no timers, no network.
 * Logical `now` is caller-supplied at every consequential operation.
 */

import { fnv1a32, canonicalJson } from "./digest.js";
import type { TenantIdLike } from "../assets.js";

// ---------------------------------------------------------------------------
// Branded ids — local to the lineage material domain.
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type MaterialLotId = Brand<string, "MaterialLotId">;

const LOT_ID_RE = /^lot_[A-Za-z0-9_-]{4,128}$/;

export const isMaterialLotId = (v: string): v is MaterialLotId =>
  typeof v === "string" && LOT_ID_RE.test(v);

// ---------------------------------------------------------------------------
// Vocabulary — material kinds + units.
// ---------------------------------------------------------------------------

export type MaterialKind =
  | "lubricant"
  | "coolant"
  | "filter"
  | "fuel"
  | "battery"
  | "paint"
  | "sealant"
  | "refrigerant"
  | "other";

export type MaterialUnit =
  | "litre"
  | "millilitre"
  | "gram"
  | "kilogram"
  | "unit"
  | "metre";

const MATERIAL_KINDS: ReadonlyArray<MaterialKind> = [
  "lubricant",
  "coolant",
  "filter",
  "fuel",
  "battery",
  "paint",
  "sealant",
  "refrigerant",
  "other",
];

const MATERIAL_UNITS: ReadonlyArray<MaterialUnit> = [
  "litre",
  "millilitre",
  "gram",
  "kilogram",
  "unit",
  "metre",
];

// ---------------------------------------------------------------------------
// MaterialLot — the durable record.
// ---------------------------------------------------------------------------

export type MaterialLotLifecycleState = "created" | "partially-consumed" | "exhausted";

export interface MaterialLot {
  readonly id: MaterialLotId;
  readonly tenantId: TenantIdLike;
  readonly kind: MaterialKind;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly initialQuantity: number;
  readonly remainingQuantity: number;
  readonly unit: MaterialUnit;
  readonly createdAt: number;
  /** Set when remaining reaches 0. null while the lot is still alive. */
  readonly exhaustedAt: number | null;
  /** Caller-supplied monotonic sequence of consume operations on this lot. */
  readonly consumeSeq: number;
}

// ---------------------------------------------------------------------------
// Lifecycle state — derived from the lot's quantities (no stored state).
// ---------------------------------------------------------------------------

export function materialLotLifecycleState(lot: MaterialLot): MaterialLotLifecycleState {
  if (lot.remainingQuantity <= 0) return "exhausted";
  if (lot.remainingQuantity >= lot.initialQuantity) return "created";
  return "partially-consumed";
}

// ---------------------------------------------------------------------------
// Creation — fail-closed validations.
// ---------------------------------------------------------------------------

export type MaterialLotRejectionCode =
  | "malformed-lot-id"
  | "missing-tenant-id"
  | "unknown-kind"
  | "unknown-unit"
  | "malformed-attributes"
  | "invalid-quantity"
  | "invalid-created-at";

export interface MaterialLotInput {
  readonly lotId: string;
  readonly tenantId: TenantIdLike;
  readonly kind: MaterialKind;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly quantity: number;
  readonly unit: MaterialUnit;
  readonly createdAt: number;
}

export type MaterialLotResult =
  | { readonly ok: true; readonly lot: MaterialLot }
  | { readonly ok: false; readonly reason: MaterialLotRejectionCode };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function createMaterialLot(input: MaterialLotInput): MaterialLotResult {
  if (!isMaterialLotId(input.lotId)) return { ok: false, reason: "malformed-lot-id" };
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    return { ok: false, reason: "missing-tenant-id" };
  }
  if (!MATERIAL_KINDS.includes(input.kind)) return { ok: false, reason: "unknown-kind" };
  if (!MATERIAL_UNITS.includes(input.unit)) return { ok: false, reason: "unknown-unit" };
  if (!isPlainObject(input.attributes)) return { ok: false, reason: "malformed-attributes" };
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || !Number.isInteger(input.quantity)) {
    return { ok: false, reason: "invalid-quantity" };
  }
  if (!Number.isFinite(input.createdAt) || input.createdAt <= 0) {
    return { ok: false, reason: "invalid-created-at" };
  }
  const lot: MaterialLot = {
    id: input.lotId,
    tenantId: input.tenantId,
    kind: input.kind,
    attributes: input.attributes,
    initialQuantity: input.quantity,
    remainingQuantity: input.quantity,
    unit: input.unit,
    createdAt: input.createdAt,
    exhaustedAt: null,
    consumeSeq: 0,
  };
  return { ok: true, lot };
}

// ---------------------------------------------------------------------------
// Consumption — honest, reason-coded over-consumption refusals.
// ---------------------------------------------------------------------------

export type MaterialConsumptionRejectionCode =
  | "unknown-lot"
  | "tenant-mismatch"
  | "lot-exhausted"
  | "over-consumption"
  | "invalid-quantity"
  | "stale-consumed-at"
  | "non-monotonic-consume-seq";

export interface MaterialConsumptionInput {
  readonly tenantId: TenantIdLike;
  readonly lotId: MaterialLotId;
  readonly quantity: number;
  readonly consumedAt: number;
  /** Caller-supplied monotonic per-lot seq; must exceed lot.consumeSeq. */
  readonly consumeSeq: number;
}

export type MaterialConsumptionResult =
  | { readonly ok: true; readonly lot: MaterialLot; readonly consumed: number; readonly exhausted: boolean }
  | {
      readonly ok: false;
      readonly reason: MaterialConsumptionRejectionCode;
      readonly requested?: number;
      readonly remaining?: number;
    };

export function consumeMaterialLot(
  lot: MaterialLot,
  input: MaterialConsumptionInput,
): MaterialConsumptionResult {
  if (lot.id !== input.lotId) return { ok: false, reason: "unknown-lot" };
  if (lot.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || !Number.isInteger(input.quantity)) {
    return { ok: false, reason: "invalid-quantity", requested: input.quantity, remaining: lot.remainingQuantity };
  }
  if (lot.remainingQuantity <= 0) {
    return { ok: false, reason: "lot-exhausted", requested: input.quantity, remaining: 0 };
  }
  if (input.quantity > lot.remainingQuantity) {
    return {
      ok: false,
      reason: "over-consumption",
      requested: input.quantity,
      remaining: lot.remainingQuantity,
    };
  }
  if (!Number.isFinite(input.consumedAt) || input.consumedAt < lot.createdAt) {
    return { ok: false, reason: "stale-consumed-at" };
  }
  if (!Number.isFinite(input.consumeSeq) || input.consumeSeq <= lot.consumeSeq) {
    return { ok: false, reason: "non-monotonic-consume-seq" };
  }
  const nextRemaining = lot.remainingQuantity - input.quantity;
  const exhausted = nextRemaining === 0;
  const next: MaterialLot = {
    ...lot,
    remainingQuantity: nextRemaining,
    exhaustedAt: exhausted ? input.consumedAt : lot.exhaustedAt,
    consumeSeq: input.consumeSeq,
  };
  return { ok: true, lot: next, consumed: input.quantity, exhausted };
}

// ---------------------------------------------------------------------------
// Digest — FNV-1a over the lot's canonical fields.
// ---------------------------------------------------------------------------

export function materialLotDigest(lot: MaterialLot): string {
  // Order-stable: the lot's id/tenant/kind/quantity/unit/timestamps/consumeSeq.
  return fnv1a32([
    "material-lot",
    lot.id,
    lot.tenantId,
    lot.kind,
    lot.unit,
    lot.initialQuantity,
    lot.remainingQuantity,
    lot.createdAt,
    lot.exhaustedAt ?? "",
    lot.consumeSeq,
    canonicalJson(lot.attributes),
  ]);
}
