/**
 * @fleetos/world-model — deterministic world state as a pure fold (Wave 3,
 * F230B): the `./world-fold` subpath BARREL.
 *
 * Mirrors the journal-fold pattern from `packages/mission` (the exemplar):
 * world state is a PURE FOLD over an append-only, digest-CHAINED world-event
 * journal — replaying the same entries reproduces the identical state, and
 * a tampered/gapped/mixed-tenant chain is refused with a reason code.
 * Checkpoints fold a journal prefix once; `resumeWorld` continues the fold
 * from a checkpoint over a suffix without re-folding the prefix.
 *
 * Entities (assets/agents/orgs) are OPAQUE refs: the world model stores ids,
 * last-observation-driven state, tags and staleness classification — never
 * domain truth owned by other contexts.
 *
 * Predictive integration is TYPE-ONLY from `@fleetos/predictive` (intra-lane,
 * established): `askWorldProjection` maps a world entity's observation log
 * into a `TwinStateInput` and hands it to any `ModelPort`. LAW: the result is
 * ADVISORY — it carries `advisory: true`, and nothing here feeds a
 * projection back into the journal or into authoritative state.
 *
 * Deterministic: no clock, no randomness, no I/O; all ages/thresholds are
 * integer milliseconds.
 *
 * Split note (F230B lint conformance): this file was the single 547-line
 * world-fold module; it is now a pure barrel over cohesive modules so every
 * src file stays under the repo's max-lines lint budget. The exported
 * surface is symbol-for-symbol identical:
 *
 *   - `./world/journal.ts` — world events, journal entries, folded-state
 *     contracts, the digest chain (genesis/entry digests), and the
 *     deterministic `nextWorldEntry` builder.
 *   - `./world/state.ts` — the pure fold (`foldWorldState`), checkpoints
 *     (`checkpointWorld`/`resumeWorld`/`worldStateDigest`) and every fold
 *     rejection code.
 *   - `./world/staleness.ts` — fresh/stale/unknown classification by
 *     integer-ms age thresholds (`classifyStaleness`/`projectEntity`).
 *   - `./world/projection-bridge.ts` — advisory predictive integration via
 *     `askWorldProjection` + the `@fleetos/predictive` seam types.
 */

export * from "./world/journal.ts";
export * from "./world/state.ts";
export * from "./world/staleness.ts";
export * from "./world/projection-bridge.ts";
