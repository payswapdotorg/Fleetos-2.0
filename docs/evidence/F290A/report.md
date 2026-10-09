# F290A — Worker A (Edge + Asset) Asset Lineage / Material / Method Graph Evidence

- **Work item:** F290A — asset lineage / material / method graph (Wave 9 lane A; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker A (edge-and-asset; `spec/worker-ownership.yaml` worker-a grants)
- **Base commit:** `ca2b4b4` ("TL: sync AI_CONTINUATION — WAVE 9 lane B (F290B) MERGED at aee6e30 …", origin/main HEAD — verified with `git log --oneline -1` before branching)
- **Branch:** `work/f290a` (created from origin/main HEAD)
- **Date:** 2026-10-09
- **Task ID:** `10-a`

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-a grants) — ONLY lane packages + this evidence dir:

- `packages/assets/**` — NEW `src/lineage/digest.ts` (88 lines), `src/lineage/material.ts` (260), `src/lineage/method.ts` (439 raw / 313 lint-effective), `src/lineage/graph.ts` (340), `src/lineage/queries.ts` (285), `src/lineage/anchor.ts` (130), `src/lineage/index.ts` (16); `src/index.ts` (+1: `export * from "./lineage/index.js"`); `package.json` (+ `./lineage` subpath export + NEW devDep `@fleetos/observations` — the test-composition binding, public root entry only); NEW tests `src/lineage/material.test.ts` (390 / 22 tests), `method.test.ts` (598 / 30 tests), `graph.test.ts` (329 / 18 tests), `queries.test.ts` (378 / 15 tests), `anchor.test.ts` (282 / 10 tests), `integration.test.ts` (553 / 13 tests).
- `docs/evidence/F290A/**` (this report).
- `pnpm-lock.yaml` — left UNCOMMITTED per packet precedent (the F270A/F271/F281/F290B semantic): the diff is exactly the 1-line `@fleetos/observations` workspace devDep link for `@fleetos/assets`. TL decides at merge.

Untouched: identity, tenancy, observations, health, recovery, maintenance, connectivity, integrations/adcos, sim-worlds, experiences/asset-field (all re-run green after the last edit, §2). No spec edits, no other lane's paths, no new top-level packages, no new runtime deps (`@fleetos/observations` is a devDep, public root entry only, and is a lane sibling — both owned by Worker A per `spec/worker-ownership.yaml`).

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

BEFORE (at `ca2b4b4`, clean tree; identical counts to the F290B §2 + the F281 release gate):

```text
assets 3/99   observations 5/157   identity 3/89   tenancy 3/67   health 4/89
recovery 3/60   maintenance 3/69   connectivity 7/120   integrations/adcos 8/143
sim-worlds 5/84   experiences/asset-field 4/69   acceptance/field 5/61
acceptance/adoption 7/90   acceptance/release 4/88
```

AFTER (last edit; full test+typecheck+lint per touched package, test re-runs per untouched lane package, all green):

```text
assets 9/207   observations 5/157   identity 3/89   tenancy 3/67   health 4/89
recovery 3/60   maintenance 3/69   connectivity 7/120   integrations/adcos 8/143
sim-worlds 5/84   experiences/asset-field 4/69   acceptance/field 5/61
acceptance/adoption 7/90   acceptance/release 4/88
```

**Wave-9 baselines preserved: field 61, adoption 90, release 88 — all green BEFORE AND AFTER.** Lane total unchanged for untouched packages; assets 99 → 207 (+108 net-new).

## 3. Deliverables (all pure deterministic TS; logical `now` / caller-supplied inputs everywhere)

### 3.1 `src/lineage/digest.ts` (88 lines) — LOCAL FNV-1a copy (the lane convention)

Per-package local copy of the lane's FNV-1a digest convention (same family the repo's digest chains use — the canonical home is TL-owned tower-core; cross-package imports of another owner's digest module are forbidden by the architecture lock). Same convention as F270A/F281/F290B (byte-identical behavior to the lane family):

- `fnv1a32(parts)` — 8 lowercase hex chars over parts joined with the unit-separator (␟, U+241F). Arrays flatten deterministically.
- `fnv1a32Int(parts)` — the raw uint32 behind `fnv1a32` (used as a mixing input elsewhere).
- `canonicalJson(value)` — object keys sorted recursively; arrays kept in order; byte-identical for structurally equal values regardless of key order.
- `fnv1a32OfJson(value)` — convenience: FNV-1a over the canonical-JSON encoding of a single value (used by the lineage chain for edge payloads — so edge ordering AND edge content both contribute to the chain; any edit breaks verification).

Pure TypeScript, no `Date.now` / `Math.random` / timers / network (the only textual matches are doc comments BANNING them).

### 3.2 `src/lineage/material.ts` (260 lines) — material lot domain

Tenant-scoped material lots: lot id (`lot_*` branded), kind (9-vocabulary: lubricant/coolant/filter/fuel/battery/paint/sealant/refrigerant/other), attributes (plain object), quantity + unit (6-vocabulary: litre/millilitre/gram/kilogram/unit/metre), logical timestamps.

- **Lot lifecycle (created → partially-consumed → exhausted)** is DERIVED from the lot's quantities (never stored) via `materialLotLifecycleState`: `remaining === initial` → `created`; `remaining === 0` → `exhausted`; otherwise → `partially-consumed`. The lifecycle is a function of the lot, not a stored state.
- **`createMaterialLot(input)`** — fail-closed validations: malformed-lot-id, missing-tenant-id, unknown-kind, unknown-unit, malformed-attributes, invalid-quantity (must be a positive integer), invalid-created-at. Returns the lot with `consumeSeq: 0`, `exhaustedAt: null`.
- **`consumeMaterialLot(lot, input)`** — honest, reason-coded over-consumption refusals: a consume call asking for more than `remaining` returns `over-consumption` with the REAL numbers (`requested`, `remaining`), never a silent clamp. Exhausting the lot exactly sets `exhaustedAt` (NOT an over-consumption — the exact-remainder edge is tested). Refuses on `unknown-lot` (id mismatch), `tenant-mismatch` (cross-tenant consume), `lot-exhausted` (consume on a 0-remaining lot), `invalid-quantity` (non-positive, non-integer, NaN, Infinity), `stale-consumed-at` (before `createdAt`), `non-monotonic-consume-seq` (≤ current `consumeSeq`).
- **`materialLotDigest(lot)`** — FNV-1a over the lot's canonical fields (id/tenant/kind/unit/quantities/timestamps/consumeSeq/attributes-canonical-JSON). Byte-identical re-runs; content-sensitive (every tested mutation changes the digest).

### 3.3 `src/lineage/method.ts` (439 raw / 313 lint-effective lines) — versioned method domain

Methods = operational/maintenance procedures with `(methodId, version)` identity and parameter schemas. Method application records are bound to REAL assets (validated against the assets kernel via a structural `AssetLookupPort` adapter) with outcomes. Deprecated versions stay READABLE (lineage is append-only history) but are REFUSED for NEW applications with a REAL reason code.

- **Method identity:** `MethodId` (branded, `mth_*` regex), `MethodApplicationId` (branded, `app_*` regex), `MethodVersion` (regex `MAJOR.MINOR.PATCH` with no leading zeros, no `v` prefix — the registry treats it as an opaque string; ordering is the caller's responsibility, the deprecation path is explicit, not derived).
- **MethodDefinition** carries `kind` (6-vocabulary: maintenance/operation/inspection/calibration/repair/commissioning), `displayName`, `parameterSchema` (typed parameters: string/number/boolean/text/enum with `enumValues` for enum and `defaultValue` for optional), `status` (`active`|`deprecated`), `createdAt`, `deprecatedAt`, free-form `description`.
- **`MethodRegistry`** (in-memory, immutable updates) keyed by `${methodId}@${version}`. `registerMethod` fail-closed: malformed-method-id, invalid-version, unknown-kind, missing-display-name, malformed-parameter-schema (duplicate names, missing enumValues, invalid parameter types), duplicate-method-version, invalid-created-at. `deprecateMethod` marks deprecated (stays readable via `lookupMethod`) — refuses re-deprecate (`already-deprecated`), unknown method, stale-deprecated-at (before createdAt).
- **`applyMethodToAsset(registry, assetLookup, input)`** — the REAL asset binding. The structural `AssetLookupPort` mirrors `AssetDirectory.findAsset(tenantId, id)` (tests wire the REAL directory). Validation order: malformed-application-id → missing-tenant-id → unknown-method (lookup) → method-deprecated (active methods only) → invalid-applied-at → unknown-asset (port lookup) → asset-tenant-mismatch (port returned a foreign-tenant record — the fail-closed double-check) → parameter validation (missing-parameter, invalid-parameter-type, invalid-enum-value) → unknown-parameter (schema is the contract — extra fields refused with invalid-parameter-type). Emits `AuditEventRef` (the existing kernel-audit primitive) and a deterministic `applicationDigest` (FNV-1a over the canonical fields + canonical-JSON parameters + observation anchor).
- **Parameter coercion** applies `defaultValue` for omitted optional parameters; required+omitted → `missing-parameter`; type-mismatch → `invalid-parameter-type`; enum out-of-vocabulary → `invalid-enum-value`.

### 3.4 `src/lineage/graph.ts` (340 lines) — typed directed edges + tamper-evident chain

Typed directed edges between assets, material lots, and method applications:

- **4 edge kinds:** `asset-consumed-lot` (asset → lot), `method-applied-to-asset` (method-application → asset), `lot-transformed-into-lot` (lot → lot, source≠target enforced), `asset-replaced-by-asset` (asset → asset, predecessor≠successor enforced).
- **`LineageEdge`** — `sequence` (1-indexed, deterministic append order), `tenantId`, `payload`, `at`, `prevDigest` (the previous edge's edgeDigest, or `"genesis"` for #1), `edgeDigest` (FNV-1a over `[lineage-edge, sequence, tenantId, at, prevDigest, canonicalJson(payload)]`).
- **`appendLineageEdge(graph, input)`** — fail-closed: missing-tenant-id, invalid-payload (per-kind validation including the source≠target law for transforms/replaces), invalid-at. Computes the next sequence + prevDigest from the current head; produces the edge with the recomputed edgeDigest.
- **`verifyLineageChain(graph)`** — tamper-evident: walks the edges in order, recomputes each edge's digest from its own fields + the running prevDigest, and refuses on `out-of-order-sequence` (sequence != expected), `broken-chain-link` (prevDigest mismatch), or `edge-digest-mismatch` (recomputed digest ≠ stored). Returns the failing sequence + expected/actual digests. The head digest must match the last edge's edgeDigest (or GENESIS_DIGEST for the empty graph). Three mutation fixtures (EDIT, REORDER, REWRITE) each break verification with a REAL reason code (machine-tested §4).
- **`computeEdgeDigest`** is exported so tamperers can re-stamp an edge — but the chain breaks at the NEXT edge because they cannot re-stamp the next edge's prevDigest (it was sealed with the original #N digest). Machine-tested.
- **`edgeSource` / `edgeTarget`** — typed extraction of an edge's endpoints as `{kind: "asset"|"lot"|"method-application", id: string}`. Used by `queries.ts` traversal.
- **`lineageGraphDigest`** — convenience: the head digest (last edge's edgeDigest or GENESIS_DIGEST).

### 3.5 `src/lineage/queries.ts` (285 lines) — cycle-safe traversal, bounded depth, tenant fail-closed

- **Documented bounds (machine-tested at the exact edge):** `MAX_TRAVERSAL_DEPTH = 64`, `MAX_TRAVERSAL_NODES = 1000`. A traversal that would exceed either is refused with `traversal-overflow` (never silently truncated — Honesty Law).
- **`ancestry(graph, input)`** — full BFS from `id` back through the directed edges (predecessors). Closest-first. Default `maxDepth = MAX_TRAVERSAL_DEPTH`.
- **`descendants(graph, input)`** — full BFS from `id` forward (successors). Closest-first.
- **`ancestryBounded` / `descendantsBounded`** — explicit bounded depth; `maxDepth < 1` or `> MAX` refuses with `traversal-overflow`.
- **Cycle-safe** — a `visited` set keyed by `kind#id` prevents infinite loops; self-edges and longer cycles record their edge but never re-enqueue an already-visited node. Machine-tested with 2-node (`A→B→A`) and 3-node (`A→B→C→A`) cycle fixtures.
- **BFS direction:** ancestry looks for edges where the seed is the TARGET (the predecessor is the SOURCE of the edge); descendants looks for edges where the seed is the SOURCE (the successor is the TARGET). Both recorded in the edge's typed `edgeSource`/`edgeTarget`.
- **Tenant fail-closed:** the BFS loop skips edges whose `tenantId` ≠ the caller's `tenantId` — cross-tenant edges are NEVER traversed, NEVER returned. Empty `tenantId` refuses with `tenant-id-empty`; empty `id` refuses with `missing-target`. `tenantEdges(graph, tenantId)` is the informational read (returns only same-tenant edges).
- **`TraversalResult`** — `ok`, `order`, `seed`, `edges` (BFS order, REAL `LineageEdge` objects), `visited` (distinct nodes), `depth` (max reached; 0 for the seed alone), `refusal?` (the reason code).

### 3.6 `src/lineage/anchor.ts` (130 lines) — observation anchoring (fail-closed)

A method application may reference a REAL observation record ingested through the observations package's public ingestion surface. The `ObservationLookupPort` is a STRUCTURAL seam — the test/composition site binds the REAL `admitToLog` surface; the lineage module NEVER imports `@fleetos/observations` at runtime (the assets package has zero cross-context runtime imports — the F290B invariant for this lane).

- **`ObservationSummary`** — structural shape: `{id, tenantId, deviceId, seq, observedAt, payloadDigest}`. The REAL `Observation` is a superset (also carries `kind`, `payload?`, `admittedAt`); the summary drops the extras the lineage module doesn't need.
- **`validateObservationAnchor(lookup, input)`** — fail-closed: `missing-anchor-field` (undefined anchor, empty observationId, or empty tenantId at the input), `malformed-observation-id` (regex `^obs_[A-Za-z0-9_-]{8,256}$`), `dangling-observation` (lookup returns null — covers the case where the REAL lookup filters by tenant), `observation-tenant-mismatch` (the lookup port itself returns a foreign-tenant record — the lineage module double-checks even when the port doesn't filter).
- **`anchorMethodApplication(lookup, application)`** — convenience: validates the anchor carried by a `MethodApplication` record (uses `application.observationAnchor` + `application.tenantId`).

### 3.7 `src/lineage/index.ts` (16 lines) + `src/index.ts` (+1 line) — barrel + wiring

The lineage barrel re-exports all 6 modules. `src/index.ts` adds `export * from "./lineage/index.js"`; `package.json` adds a `./lineage` subpath export so consumers can `import { ... } from "@fleetos/assets/lineage"`.

### 3.8 Tests — 108 net-new (6 files), against the packet's ≥ 60 floor

```text
assets src/lineage/  material 22 + method 30 + graph 18 + queries 15 + anchor 10
                    + integration 13 = 108 net-new
                    (assets 99 → 207; every test run and passed this session)
```

- `material.test.ts` (22) — create happy path + 7 refusal codes (malformed-lot-id/missing-tenant-id/unknown-kind/unknown-unit/malformed-attributes/invalid-quantity/invalid-created-at); consume transitions (partial / exhaust / over-consumption-with-REAL-numbers / lot-exhausted / invalid-quantity / tenant-mismatch / stale-consumed-at / non-monotonic-consume-seq / unknown-lot); digest byte-identical + content-sensitive + consumeSeq-sensitive; lifecycle derivation (created → partially-consumed → exhausted).
- `method.test.ts` (30) — register happy path + 7 refusal codes; deprecate + stays-readable + re-deprecate refused + unknown-method + stale-deprecated-at; apply happy path + default-for-omitted-optional + deprecated refused + unknown-method + unknown-asset + asset-tenant-mismatch (the synthetic-port case) + missing-parameter + invalid-parameter-type + invalid-enum-value + unknown-parameter + malformed-application-id + missing-tenant-id + invalid-applied-at + outcome-recorded-verbatim + REAL-asset-2-binding; digest byte-identical + content-sensitive + observation-anchor-on-chain.
- `graph.test.ts` (18) — empty graph (GENESIS_DIGEST, verify ok); append chain (4 edges, sequential numbers, chained digests, byte-identical re-runs, all 4 edge kinds); tamper-evident ×4 (EDIT breaks edge-digest with expected/actual; REORDER breaks chain-link or out-of-order; REWRITE detected at NEXT edge via broken-chain-link; HEAD-TAMPER detected at tail); append validations (missing-tenant-id, invalid-at, invalid-payload ×3: consume non-positive quantity, replace self-loop, transform self-loop); edgeSource/edgeTarget typed extraction ×4.
- `queries.test.ts` (15) — ancestry (full chain + leaf); descendants (full chain + leaf); bounded depth (maxDepth=1); cycle-safe (2-node cycle + 3-node cycle both traverse safely with the visited set preventing infinite loops); tenant fail-closed (cross-tenant edges filtered, never traversed; empty tenant id → tenant-id-empty; empty id → missing-target); documented bounds (MAX_TRAVERSAL_DEPTH=64 verified at the edge; depth=65 refused; MAX_TRAVERSAL_NODES=1000 — fan-out of 1001 successors refuses with traversal-overflow); tenantEdges explicit cross-tenant filter.
- `anchor.test.ts` (10) — REAL observation surface binding via the REAL `admitToLog` + lookup-port adapter (proves the structural port + the REAL surface agree on shape); valid anchor; missing-anchor-field ×2; empty tenant id fail-closed; malformed-observation-id; dangling-observation (well-formed id not in log); observation-tenant-mismatch (port returns a foreign-tenant record); anchorMethodApplication convenience (valid + missing-anchor-field).
- `integration.test.ts` (13) — the REAL-RUN: REAL `AssetDirectory` over `InMemoryAssetRepository` admits 2 assets + transitions to active; REAL `MethodRegistry` registers an active method + a deprecated method; REAL `consumeMaterialLot` partially consumes a lot; REAL `LineageGraph` builds a 4-edge chain (all 4 edge kinds); REAL `applyMethodToAsset` validates against the REAL directory via the port adapter; REAL `admitToLog` ingests an observation; REAL `validateObservationAnchor` validates the anchor against the REAL log; full traversal across all 4 edge kinds; ancestry of successor returns predecessor; cross-tenant fail-closed end-to-end (tenantEdges filter, descendants filter, foreign-tenant asset refused as unknown-asset); tamper propagation (EDIT + REWRITE detected); digest determinism (byte-identical re-runs of the full fixture); lifecycle refusals across the surface (over-consumption + deprecated-method + dangling-observation in one combined scenario + deprecated method remains readable via lookupMethod).

Every claimed law has a machine test in §3.

## 4. Machine-verified gate outputs (exact, in the package dir)

```text
cd packages/assets
  corepack pnpm run test
    Test Files  9 passed (9)      Tests  207 passed (207)          # PASS (≥ 60 net-new required; 108 added)
    Duration  1.99s
  corepack pnpm run typecheck
    # no output, exit 0                                          # PASS
  corepack pnpm run lint
    Found 0 warnings and 0 errors. Finished in 13ms on 23 files using 2 threads.   # PASS
```

## 5. Test-count accounting

```text
material 22 + method 30 + graph 18 + queries 15 + anchor 10 + integration 13 = 108 net-new (floor ≥ 60)
  (assets 99 → 207; every test run and passed this session)
```

## 6. Boundary verification (machine-tested)

- **Import scan** over src+tests → ONLY the declared lane packages, public entry points only:
  - `src/lineage/` has ZERO cross-package runtime imports (the structural ports `AssetLookupPort` + `ObservationLookupPort` are the only seam).
  - `src/lineage/{anchor,integration}.test.ts` import `@fleetos/observations` (lane sibling — both Worker A owned; devDep; public root entry only; TEST-SITE binding only).
- **Determinism sweep** → CLEAN (no `Date.now`, `Math.random`, `new Date(`, timers, `fetch` in src+tests; the only textual matches are doc comments BANNING them). Logical times are constants (`NOW = 1_774_000_000_000`).
- **File law** → all SOURCE files pass oxlint `max-lines 400` (skipBlankLines+skipComments — the green lint gate proves it): `method.ts` 439 raw / 313 lint-effective (largest); all other sources ≤ 340 raw. Test files exempt per the repo's `.oxlintrc.json` override (the largest test file `method.test.ts` 598 raw, `integration.test.ts` 553 raw — both contain extensive comment headers + assertion narratives).
- **`git status`** → exactly `packages/assets/**` (lineage src + tests + src/index.ts + package.json) + `docs/evidence/F290A/**` + `pnpm-lock.yaml` (UNCOMMITTED per packet). No spec edits; `spec/worker-ownership.yaml` untouched.
- **Baselines** → all four acceptance suites + all untouched lane packages re-run green AFTER the last edit (§2).

## 7. Seam findings (TL-relevant)

1. **NEW devDep edge `assets → @fleetos/observations`** — the observation anchoring module needs the REAL observations surface at the test/composition site to prove the structural port + the REAL `Observation` shape agree. The src keeps a LOCAL structural `ObservationLookupPort` + `ObservationSummary` shape — zero runtime coupling; the composition binding is machine-tested. The edge is IN-LANE (both Worker A owned per `spec/worker-ownership.yaml`), devDep scope only, public root entry only. Mirrors the F290B precedent (`world-model → @fleetos/world-context` devDep, lane sibling, TEST-SITE only).
2. **Local FNV-1a digest copy** — same lane convention as F270A/F281/F290B (the canonical home is TL-owned tower-core; cross-package imports of another owner's digest module are forbidden). Byte-identical behavior to the lane family (unit-separator ␟ joining, canonical-JSON key sorting). The TL-hoisting question stands.
3. **BFS direction (the lineage-graph traversal law)** — ancestry looks for edges where the seed is the TARGET (the predecessor is the SOURCE of the directed edge); descendants looks for edges where the seed is the SOURCE (the successor is the TARGET). This is the opposite of what one might naively expect; the direction was a bug during development that surfaced as zero edges returned for a 2-edge chain — caught by the integration test, fixed, and the direction is now documented in `queries.ts` BFS loop.
4. **MAX_TRAVERSAL_DEPTH = 64 + MAX_TRAVERSAL_NODES = 1000** — both documented constants in `queries.ts`; both machine-tested at the exact edge (depth = MAX is OK; depth = MAX + 1 refused; fan-out of 1001 successors refuses with `traversal-overflow`). The Honesty Law: every bound is documented with its tested limit.
5. **Cross-tenant edge filter** — applied INSIDE the BFS loop (foreign-tenant edges are skipped before they can be traversed, never returned) AND via `tenantEdges(graph, tenantId)` (the informational read). An empty `tenantId` refuses with `tenant-id-empty` (fail-closed — no traversal without a tenant scope); an empty `id` refuses with `missing-target`.
6. **The graph enforces source ≠ target** for `lot-transformed-into-lot` and `asset-replaced-by-asset` (no self-loops) — so cycle-safety is demonstrated via 2-node (`A→B→A`) and 3-node (`A→B→C→A`) cycles, not self-loops. The visited set prevents infinite loops even with back-edges; back-edges are recorded but their `next` is not enqueued (already visited).
7. **`asset-tenant-mismatch` vs `unknown-asset`** — the REAL `AssetDirectory.findAsset` is tenant-scoped (returns null for foreign-tenant ids), so a method application against a foreign-tenant asset surfaces as `unknown-asset`. The `asset-tenant-mismatch` code is reserved for the synthetic-port case where a port itself returns a foreign-tenant record (the lineage module double-checks even when the port doesn't filter). Both code paths are machine-tested; both are fail-closed (the foreign-tenant asset is NEVER silently accepted).
8. **Tamper-evident chain — REWRITE detection** — a tamperer can re-stamp an edge's `edgeDigest` by recomputing it over their mutated fields (they have `computeEdgeDigest`), but they CANNOT re-stamp the NEXT edge's `prevDigest` (it was sealed with the original #N digest). The chain breaks at the next edge with `broken-chain-link`. Machine-tested in `graph.test.ts` and `integration.test.ts`.

## 8. Honest residuals

1. The lineage modules are PURE REFERENCE-PATH functions — no persistence, no I/O. Record retrieval, persistence and pipeline wiring (e.g. persisting the `LineageGraph`'s edge log, persisting the `MethodRegistry`, persisting the `MaterialLot` state) belong to the composing application (TL composition at F211+ per the existing precedent).
2. The `AssetLookupPort` + `ObservationLookupPort` are STRUCTURAL seams — the src has zero runtime coupling to the REAL assets/observations surfaces. The test composition sites bind the REAL surfaces; production composition is the TL's wiring. The structural ports are part of the public contract (`@fleetos/assets/lineage` subpath export).
3. The FNV-1a 32-bit digest is the lane's evidence-grade convention (provenance + determinism proofs), NOT crypto. Same family as F270A/F281/F290B; the TL hoisting question stands.
4. `MethodApplication.observationAnchor` is a STRUCTURAL field at apply time — the actual validation (does the observation exist, does it belong to the same tenant) happens separately via `validateObservationAnchor` / `anchorMethodApplication`. A method application CAN be built with a dangling anchor (the apply-time validation does NOT call the observation lookup port); the anchor validation is an explicit, separate gate. This separation is intentional: the method-application surface stays pure (no I/O at apply time), and the anchor validation is the consumer's responsibility at the persistence/composition boundary.
5. `pnpm -r test` (full monorepo) NOT run — TL merge-time gate per packet; the four acceptance baselines + all untouched lane packages were machine re-run instead (§2).
6. `pnpm-lock.yaml` carries the 1-line `@fleetos/observations` workspace devDep link for `@fleetos/assets` — left UNCOMMITTED per packet precedent (the F270A/F271/F281/F290B semantic). TL decides at merge.
7. The worklog entry for Task ID 10-a is appended to the session worklog (`/home/z/my-project/worklog.md`).

## 9. Verification commands for TL re-run

```bash
cd <repo checkout> && git checkout work/f290a
corepack pnpm install --filter @fleetos/assets... --prefer-offline --ignore-scripts
cd packages/assets
corepack pnpm run test        # 9 files / 207 tests (108 net-new)
corepack pnpm run typecheck   # exit 0
corepack pnpm run lint        # 0 warnings, 0 errors
# baselines (unmodified corpora):
cd ../acceptance/field     && corepack pnpm run test   # 61/61
cd ../acceptance/adoption  && corepack pnpm run test   # 90/90
cd ../acceptance/release   && corepack pnpm run test   # 88/88
# untouched lane packages re-verified this session:
cd ../observations         && corepack pnpm run test   # 157/157
cd ../identity              && corepack pnpm run test   # 89/89
cd ../tenancy               && corepack pnpm run test   # 67/67
cd ../health                && corepack pnpm run test   # 89/89
cd ../recovery              && corepack pnpm run test   # 60/60
cd ../maintenance           && corepack pnpm run test   # 69/69
cd ../connectivity           && corepack pnpm run test   # 120/120
cd ../integrations/adcos    && corepack pnpm run test   # 143/143
cd ../sim-worlds            && corepack pnpm run test   # 84/84
cd ../experiences/asset-field && corepack pnpm run test # 69/69
# boundary checks:
rg -o "from \"@fleetos/[a-z-]+[a-z/-]*\"" packages/assets/src/lineage packages/assets/src/index.ts packages/assets/package.json | sort -u
rg -n "Date\.now|Math\.random|new Date\(|setInterval|setTimeout|fetch\(" packages/assets/src/lineage || echo CLEAN
cd <repo> && git status --short   # exactly assets/** + evidence/F290A/** + pnpm-lock.yaml (uncommitted)
```
