# F350 — Wave-15 freeze: deployment + durable-persistence qualification (TL preflight)

- **Work item:** F350 (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 15).
- **Owner:** TL. **Date:** 2026-10-13 (resident-watch session; authoring tree
  main `863800b` = the F343 packet; the F343 fix lane is in flight — when it
  merges, every F351 lane base is the post-F343 tree and the base-check law
  records the exact SHA).
- **Mission:** freeze the Wave-15 qualification law BEFORE any lane dispatch —
  the same preflight discipline as F320/F330. Wave 15 attacks the FIRST of
  the two remaining actionable release blockers named by every verdict since
  F302 §10: **production deployment composition + durable operational
  persistence are not demonstrated.** (The second actionable blocker —
  masked-industry coverage — is dispositioned in §4; providers stay
  CONTRACT_ONLY per F323, upstream-gated, not actionable in-sandbox.)

## 1. Machine-measured facts (this freeze's ground truth)

### 1.1 The product shell today (the F301/F312 composition, unchanged since)

`packages/web/src/fleetos/` — 8 files, 1,463 lines (machine count):
`commandPath.ts` 153, `crypto-shim.ts` 181, `styles.ts` 49, `work-items.ts`
24, `world.ts` 374, `main.tsx` 141, `pages-commands.tsx` 144, `pages.tsx` 397.

- The shell composes the REAL FleetOS domain packages in-browser:
  `TowerCommandBus` binds the REAL `CommandQueue` through `queueAsSubmitPort`
  (`commandPath.ts:3-4`); queue records read back via
  `bus.queueOf().listByTenant(ctx)` (`commandPath.ts:52-53`); the audit log
  records the control-plane submit contract fields (`commandPath.ts:98-107`).
- The demo world is **fixture-composed at page load** (`world.ts:165`
  `buildTenantWorld`, `world.ts:295` `buildWorld`) — the acceptance-suite
  convention. A page reload recomposes everything from fixtures.
- Standalone build: `vite.fleetos.config.ts` — `fleetos.html` only, ~236
  modules, `node:crypto` aliased to the verified pure-TS sha256 shim, commit
  identity injected at build (`__FLEETOS_COMMIT__`, rendered in the footer).
- Deployment of record (F301 §Browser evidence): `dist-fleetos/` static
  hosting on `:3105`, supervisor-kept `fleetos-server`, browser-verified at
  `a5e18f5`/`cf513f5`/`65e9250`. **Current sandbox state: the `:3105`
  service is DEAD and `dist-fleetos/` is ABSENT** (the sandbox recycled
  2026-10-13 15:33Z — recycle #13; the build config survives in-tree).
  Wave 15 rebuilds it durable.

### 1.2 The honest gap (F302 §10, restated as the wave's target)

> "Operational state is fixture-composed in-browser … it is NOT a publicly
> accessible production system and does NOT have durable operational
> persistence."

The F301 lane-recorded residual: "production deployment composition (real
persistence wiring)" — i.e. the command queue records, the submission audit
log, and the asset-enrollment registry that the UI drives are REAL domain
objects but live only in browser memory. **Durability has never been
demonstrated: no process restart has ever been survived by operational
state.**

### 1.3 The release gate's current posture (machine facts at `863800b`)

The machine gate (`packages/acceptance/release/src/release-gate.ts`) is a
boolean: `blockers.length === 0` is the ONLY path to READY. Its ACTIVE
blocker at this tree is `ACCEPTANCE_FAILED / acceptance.adoption /
allJourneysPassed=false` (the ka6 defect, F342 §5) — **F343 (in flight)
clears it**. Deployment/persistence is NOT a machine blocker; it is a TL
standing qualification (FINAL-RELEASE-HANDOFF §3: "Keep these as separate
release qualifications even if B-3 closes"). Wave 15 converts that
qualification from "not demonstrated" to "demonstrated + honestly scoped".

## 2. The qualification law (binding for F351A — the D8-analog of this wave)

- **Q1 — service-owned operational state.** A dedicated service process owns
  the shell's operational writes — command submissions (the REAL
  `CommandQueue` records), the submission audit log, and asset enrollments —
  on disk, append-only, written before the client is acknowledged. The
  in-browser composition binds to it through an adapter that implements the
  SAME port contracts the in-process composition uses today.
- **Q2 — restart-recovery, machine-proven.** Kill the service (SIGKILL —
  not a graceful shutdown), restart it, and every operational record
  survives: the machine proof is a digest comparison of the full record set
  before vs after (byte-exact), plus a UI-level verification that the
  previously enrolled/enqueued state renders after restart. A recovery that
  loses or mutates any record FAILS the qualification.
- **Q3 — browser E2E at the exact candidate.** The F301 evidence bar,
  re-run against the DURABLE composition at the lane's exact SHA: all six
  routes render; the E2E command journey (enroll → submit → enqueue ack →
  idempotent duplicate refusal) drives the DURABLE service through the UI;
  the honest-refusal path (out-of-vocabulary reason) renders verbatim;
  tenant/role switching re-composes views against the durable state; the
  footer carries the exact `__FLEETOS_COMMIT__`.
- **Q4 — honest scoping, never overclaim.** The evidence report states
  exactly what is demonstrated: a deployment composition with durable
  operational persistence, supervisor-kept, browser-verified at the exact
  SHA. It does NOT claim public-internet exposure (the sandbox exposes one
  external port, occupied by the resident console), does NOT claim provider
  readiness (Aurum/ADCOS/Arena stay CONTRACT_ONLY), and keeps the fixture
  world as the domain-input convention (observations/sim-worlds remain
  fixture-composed per the acceptance-suite law — the DURABLE surface is the
  operational plane: commands, audit, enrollments).
- **Q5 — zero corpus/count motion.** This lane adds NO counted journeys and
  touches NO acceptance package: the six suites stay green with their pins
  UNTOUCHED (the post-F343 pins are F343's to set, not this lane's). Any
  adoption/release/field/security/commerce/convergence pin change in this
  lane's diff = boundary violation. Counts 3027/1179/1017/831/931 must not
  move (F342's ledger).

## 3. Lane contract — F351A (dispatched to w15a under this freeze)

- **Owner:** Worker A executes; **deployment and application composition are
  TL-owned responsibilities** (`spec/worker-ownership.yaml`) — this packet is
  the explicit D11-analog grant for exactly this work item, exactly these
  paths, with the TL gating every line at merge (the F342 precedent:
  adoption/** granted to w14c under the packet).
- **Owned paths (strict):** `packages/web/src/fleetos/**` (the durable-mode
  composition + adapter), `infrastructure/fleetos-durable/**` (the new
  service + its data dir, gitignored), `docs/evidence/F351A/**`, the
  catalog one-liner. **NO domain packages, NO acceptance packages, no new
  top-level deps** (the service uses `node:` builtins only).
- **Service law:** one Node process, one fixed port (`:3106`), serving BOTH
  the static shell (`dist-fleetos/`) and the durable API; append-only JSONL
  segments under `infrastructure/fleetos-durable/data/` (commands / audit /
  assets), replayed on start; write-before-ack; idempotency and
  tenant-scoping preserved EXACTLY as the in-process contracts enforce them
  (a duplicate logical intent returns `duplicate=true`; a tenant-scope
  mismatch refuses fail-closed).
- **Acceptance:** Q1–Q5 above, machine-run; typecheck + lint clean on
  touched paths; file law ≤400 lines per new file; the supervisor-keep
  script included (restart-survival is a property of the deployment, not a
  one-off demo); evidence at `docs/evidence/F351A/report.md` with exact
  SHAs, commands, digests, screenshots, and honest limitations.

## 4. Masked-industry coverage — dispositioned as the next capability plan (F351B, NOT dispatched this wave)

The F342 §2 table is the honest ledger (mask-structural, byte-identical to
base): small shortfall 69 across 8 industries (construction −3,
transportation-logistics −7, agriculture −18, healthcare-facilities −15,
facilities-management −14, telecommunications −5, mining −2, water-waste
−5); medium 25; large 3. The honesty law (`adoption/src/industries.ts:10`):
a mask is an explicit exclusion with a recorded rationale — **it may only
narrow with explicit evidence**; the rationales are firm-persona facts
(e.g. agriculture's OEM-embedded machinery autonomy), so closure runs
through NEW industry-applicable journeys (capability-backed mining), not
mask edits. The scale (≈47 journeys for the three masked industries' small
firms alone) is a multi-wave program; tonight's wave does not start it
(capacity reality recorded honestly). F351B's plan: tranche 1 = the
single-mask industries (mining 2, construction 3 — the smallest honest
increments), dispatched when a lane window opens.

## 5. F352 — TL convergence contract

After F351A merges: re-run the full battery at the converged tree (all six
suites + typecheck/lint on the touched packages), re-verify the deployment
+ restart-recovery at the exact converged SHA (Q2/Q3 re-run by the TL),
confirm the counts ledger unchanged (3027/1179/1017/831/931), and state the
wave verdict: which qualifications converted from "not demonstrated" to
"demonstrated + scoped", and the release disposition per
FINAL-RELEASE-HANDOFF §11 (the TL's alone to state). Documentation updates:
catalog rows, `AI_CONTINUATION.md`, the issue-#3 disposition comment, and
`docs/tech-lead/RESIDUAL-RISKS.md`.

---

*Authoring note: this freeze was first authored 2026-10-13 15:30Z and lost
to sandbox recycle #13 (15:33Z) mid-write; rewritten verbatim from the TL
context during the recovery. The machine facts were re-measured at the
re-cloned tree `863800b` and are unchanged.*
