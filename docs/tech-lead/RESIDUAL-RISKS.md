# FleetOS 2.0 — Residual Risks Register (explicit)

**Status at closeout:** living document; every entry is a known, accepted limitation —
none is hidden. Sources: per-item honest-residual sections in `docs/evidence/` and the
TL's operational record.

## A. By-design architecture residuals

| # | Residual | Why accepted | Where documented |
|---|---|---|---|
| A1 | Domain packages are pure caller-threaded values — NO persistence, transport, scheduling or UI wiring inside any domain package | The determinism/honesty laws (ADR-0002) require it; composition belongs above the plane | Every lane report §"residuals" |
| A2 | Adapter transport is out of scope (law A7): ADCOS/Aurum/Apify/vendor sync "fetching" is a state, not a network call | Real transports are deployment composition; the adapter CONTRACTS are fully machine-tested via deterministic reference paths | F250C/F270C evidence |
| A3 | FNV-1a 32-bit digests are evidence-grade, not cryptographic | Dependency-free determinism at evidence grade; sha-256 exists at evidence-bundle grade (`@fleetos/evidence`) | ADR-0003; F281 §8.3 |
| A4 | JEPA world models are deterministic structural analogues (hash-derived projections), NOT learned weights | Law A12 (reference-first) forbids the learned path until a validated model exists; predictive ACCURACY is never claimed | F290B §7 |
| A5 | Optimizers (role allocation, routing, rebalancing) are deterministic heuristics, not solvers | Operational-truth requirement (auditable traces) over optimality | F260C evidence |
| A6 | The audit ledger's tail-truncation blind spot (unanchored ledger verifies after truncation); anchoring is caller composition | Recorded limitation with the seal/verify-anchor API available | F280B/F281 evidence |
| A7 | Monitor view checkpoint recomputation is O(n²) in events at default `checkpointEvery: 10` | Lab-scale acceptable; state never recomputed from scratch | F261 evidence |
| A8 | Predictive/forecast outputs are advisory-only by structural law; no learned-adapter benchmark results exist yet | A12 reference-first | F260B evidence |
| A9 | Trust-ladder / mission-replay mirrors are LOCAL structural mirrors, not live cross-package adjudication | Convergence decisions recorded as seams; mirror equivalence asserted by tests only | F250A/F270A seams |

## B. Process residuals

| # | Residual | Why accepted |
|---|---|---|
| B1 | Root gates (`pnpm -r test` full monorepo, architecture snapshot) run at wave close, not per packet | Per-packet cost; per-package gates + baseline re-runs ran per merge (post-merge re-runs are mandatory and caught a real integration error once) |
| B2 | Acceptance corpora assert the lanes under test at public entry points only — no cross-lane behavior testing inside a lane's corpus | Boundary law; cross-lane composition is the acceptance plane's job |
| B3 | `verify*` functions recompute digests from presented fields, not full re-derivation from genesis | Established convention; full re-derivation exists where required |

## C. Operational/platform residuals (the delivery channel)

| # | Residual | Mitigation |
|---|---|---|
| C1 | The replay channel (chat.z.ai CDP dispatch) is fragile: platform ESA edges can block datacenter IPs (405 HTML), sandbox-concurrency limits stall turn spawns, capacity windows queue generations | Doctrine in RUNBOOK: check VPN/proxy first, release stale sandboxes, re-dispatch fresh sessions on wedge; every dispatch verified server-side in the record |
| C2 | Worker sessions died silently during channel outages (empty assistant turns) | The watcher + record verification + re-dispatch ladder; all Wave-9 re-dispatches verified end-to-end |
| C3 | Sandbox resets wipe all local state outside the project directory | Everything durable is pushed to the remote (branches, main, docs, packets, evidence); the local clone is disposable |
| C4 | FNV-1a summation order is part of the contract (float non-associativity) | Sorted-key accumulation pinned by byte-identical determinism proofs |

## D. Verification posture

- Every merge carries TL machine re-runs at the exact delivery commit (test/typecheck/
  lint + every affected baseline) — no acceptance on a worker's word.
- Post-merge re-runs are mandatory.
- The final closeout runs the full monorepo suite once (see the product acceptance
  report for the final count).

## E. Wave 10 residuals (2026-10-09)

| ID | Risk | Mitigation / record |
| C5 | Substrate root typecheck (`tsc -b` full project) OOMs on the 4GB sandbox with the resident stack — the F201-era constraint persists; 47/47 FleetOS packages typecheck clean per-package | F302 B-1: run the root gate on a ≥8GB builder |
| C6 | Substrate full build fails on 4 packages in the sandbox (web OOM; desktop/server ENOENT tooling under --ignore-scripts; zcode-cli sea) | F302 B-2: same builder + full toolchain; the FleetOS product surface builds standalone and deploys |
| C7 | All external integrations are CONTRACT_ONLY — no live endpoint/credential exists; a live binding is a new, separately-verified capability | F300C §4 matrix (machine-audited); LIVE_VERIFIED requires real endpoints + credential handling outside this repo |
| C8 | The 100-counted-journeys-per-firm adoption target is structurally unreachable at the current corpus (58/100 fully-applicable) | F302 B-3 + F300C §6: shortfall preserved with structural reasons; extending requires genuinely new journey families — TL/user decision |
| C9 | The deployed shell's demo world is fixture-input composed (the acceptance-suite convention) — production composition (real persistence wiring) is not yet a deployment | F301 report honest-limitations section; the views themselves are REAL package outputs |
| C10 | The browser crypto shim (pure-TS sha256) is verified test-vector-identical to node:crypto, but a browser-native sync-hash story would remove the seam | packages/web/src/fleetos/crypto-shim.ts; verified byte-identical |

| C11 | B-1 resolved — but the root gate's honesty depends on the PIPESTATUS exit-capture (fixed at 7065542 after F310A found the tee bug); any future workflow edit must preserve it | release-gates.yml step contract; F310A §5 |
| C12 | The FleetOS shell is now type-checked by its DEDICATED project (tsconfig.fleetos.json) with the domain context — the substrate web project excludes src/fleetos; a future substrate change that re-includes it would resurface the false-context errors | F311 P2(a) record; packages/web/tsconfig.json |
| C13 | B-3 remains: cap 68/100 (shortfall 32); the 100 target is retained. Wave-12 assignments and F320 counting-law preflight are now recorded in FINAL-RELEASE-HANDOFF.md and the work-item catalog; no journey counts until machine-run. | F310C evidence; Wave-12 work items |
| C14 | The adoption count-honesty laws (reruns never counted; masks only narrow) live in adoption-run.ts — any future corpus extension must hold them; the convergence-delta module pins the current-tree expectation | adoption suite tests enforce; TL re-pins release counts at convergence |
| C15 | The deployed product runs on the sandbox's supervisor-kept static server (:3105) — a sandbox reset (proven 2026-10-09) takes it down until re-deployed; dist-fleetos rebuild is fast (vite, ~1s) but manual | RUNBOOK redeploy procedure; the durable browser profile + ops vault survive resets |


## F. Wave-12 provider-readiness clarification (2026-10-10)

| ID | Risk | Mitigation / record |
|---|---|---|
| C16 | User-confirmed: Aurum, ADCOS and Arena providers/integrations are not ready. The current adapters/contracts are not live or sandbox bindings. A local contract test must not be interpreted as a remote provider success or used to mark the provider ready. | Keep each status CONTRACT_ONLY / provider not ready; defer F323 until upstream readiness, versioned APIs and a runnable endpoint/sandbox are evidenced. Wave-12 adoption work must use real local domain behavior and must not depend on these providers. |
| C17 | The Wave-11 verdict's “B-3 sole substantive blocker” is bounded to the remaining counted-journey acceptance target, not a claim of complete production readiness. Public deployment, durable operational persistence and required live-provider integration are still not evidenced. | Preserve the NOT READY production disposition; track provider integration under F323 and deployment/persistence evidence separately. |
