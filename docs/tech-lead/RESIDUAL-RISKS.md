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
| C9 | The shell's DOMAIN-INPUT world remains fixture-composed (the acceptance-suite convention, Q4) — but the OPERATIONAL plane (commands/audit/assets) is now DURABLE via the F351A service (:3106, fsync-before-ack JSONL segments, replay-on-start byte-exact, SIGKILL-restart-proven). What is durable vs what is not is recorded per-segment | F351A evidence; F352 §2/§3 TL re-verification at `88b8506` |
| C10 | The browser crypto shim (pure-TS sha256) is verified test-vector-identical to node:crypto, but a browser-native sync-hash story would remove the seam | packages/web/src/fleetos/crypto-shim.ts; verified byte-identical |

| C11 | B-1 resolved — but the root gate's honesty depends on the PIPESTATUS exit-capture (fixed at 7065542 after F310A found the tee bug); any future workflow edit must preserve it | release-gates.yml step contract; F310A §5 |
| C12 | The FleetOS shell is now type-checked by its DEDICATED project (tsconfig.fleetos.json) with the domain context — the substrate web project excludes src/fleetos; a future substrate change that re-includes it would resurface the false-context errors | F311 P2(a) record; packages/web/tsconfig.json |
| C13 | B-3 remains at the Wave-12 converged cap of **91/100** (shortfall 9 per fully-applicable firm; counted executions 2,523; corpora field 30 / commerce 34 / security 27). All three lanes delivered and converged under F322 (`docs/evidence/F322/report.md`; frozen candidate `5c3d18f`). F320 froze Wave 12 as non-parameterized; the remaining gap needs the F310C §3.5 capability rows (row 36 time-parameterization is highest-leverage). | F322 evidence report; gates runs 38146799222/38160560665/38164045093/38165177822/38165903409 |
| C14 | The adoption count-honesty laws (reruns never counted; masks only narrow) live in adoption-run.ts — any future corpus extension must hold them; the convergence-delta module pins the current-tree expectation | adoption suite tests enforce; TL re-pins release counts at convergence |
| C15 | The deployment of record is now the F351A durable service (:3106, supervisor-kept, SIGKILL restart-recovery machine-proven at `88b8506`) — a sandbox reset still takes it down until re-deployed (the composition is fully in-repo: build + `node supervisor.mjs`); the old :3105 static-only server is superseded | RUNBOOK redeploy procedure; F351A README; F352 Q2/Q3 re-runs |


## F. Wave-12 provider-readiness clarification (2026-10-10)

| ID | Risk | Mitigation / record |
|---|---|---|
| C16 | User-confirmed: Aurum, ADCOS and Arena providers/integrations are not ready. The current adapters/contracts are not live or sandbox bindings. A local contract test must not be interpreted as a remote provider success or used to mark the provider ready. | Keep each status CONTRACT_ONLY / provider not ready; defer F323 until upstream readiness, versioned APIs and a runnable endpoint/sandbox are evidenced. Wave-12 adoption work must use real local domain behavior and must not depend on these providers. |
| C17 | RESOLVED at Wave-15 close (`88b8506`): B-3 closed for fully-applicable firms (F342/F343); deployment composition + durable operational persistence DEMONSTRATED + scoped (F351A, TL re-verified F352). The disposition is READY with standing qualifications: sandbox-hosted single-port, fsync process-crash durability, fixture domain-input world, providers CONTRACT_ONLY (F323 deferred), masked industries structural (F351B the next honest lane). No required external integration is described as ready without evidence. | `docs/evidence/F352/report.md` §5; the machine-pinned release verdict (F343 pins, green at this tree) |


## G. Wave-12 delivery status (2026-10-11)

| ID | Risk | Mitigation / record |
|---|---|---|
| C18 | F321B has delivered ten journeys, but its branch-tree adoption/release tests have count-pin transition failures (11 adoption, 3 release). F321A and F321C reports are not present in inspected main, so Wave-12 integration and count totals are not converged. | Keep F321B marked delivered but not globally converged; execute A and C concurrently; TL-owned F322 recounts all 30 workspaces, re-pins only from machine evidence and runs the full gate at one frozen SHA. |
| C19 | The time-parameterization ceiling from F310C is theoretical; F320 ruled Wave 12 non-parameterized because genuine distinct per-epoch runner behavior and expectations do not exist. | Freeze D1–D6 for this wave. Do not count epoch variants, reruns, timestamp-only changes, duplicate steps or synthetic telemetry; any future runner capability needs a separate TL-owned work item. |


## G. Wave-15 close clarification (2026-10-13, F352)

| ID | Risk | Mitigation / record |
|---|---|---|
| C18 | The durable service (:3106) is the qualification composition, not wired to the resident console gateway (:3100) — productizing that wiring is a future TL decision, not a Wave-15 obligation | F352 report §7 |
| C19 | The release disposition READY is bounded to the honestly-scoped qualifications (F352 §5): any future lane (F351B, F323, gateway wiring) must re-run the full battery at its own converged tree before verdict-carrying claims | FINAL-RELEASE-HANDOFF §1 law: old green ticks do not carry forward |

## H. Wave-16 takeover review and product-mission residuals (2026-10-14)

| ID | Risk / current fact | Required handling |
|---|---|---|
| C20 | F351B and F351C implementation/evidence were found on remote worker branches but were not on main at the review base `cb572b8`. Their lane-local reports include stale adoption/release pins by design; neither lane is globally converged merely because its own corpus suite passes. | F353/F354 packets define branch/ref reconciliation, ownership diff review, 30-workspace recount, TL-owned re-pinning and exact-candidate full gates. Do not accept worker prose alone. Preserve both Wave-16 catalog rows while reconciling branches. |
| C21 | The inspected F351C report has `Date: 2026-10-15`, one day after the repo review dated 2026-10-14. | At F354 compare Git commit timestamps with execution evidence and correct or explain the report date in-repo before accepting it. Do not backdate. |
| C22 | Wave-16 acceptance-corpus growth is not proof of marketplace readiness. FleetOS has not demonstrated a real customer request, live/verified supplier offers, actual order/service commitment, fulfilment, receipt, supplier network, or customer commercial outcomes as an end-to-end product. | Use `docs/product/UBER-FOR-COMPANY-IT-EQUIPMENT.md` and catalog F360–F371. F360 must freeze a feasible, evidence-grounded pilot; F362 proves the transaction spine; F370 hardens production; F371 uses a real customer/supplier. Keep it BLOCKED if real partner access cannot be evidenced. |
| C23 | F351A's :3106 JSONL service is scoped to durable commands, audit and device enrollments and is sandbox-qualified. It is not authenticated and the domain-input WORLD is fixture-composed. | Do not adopt it as the marketplace's authoritative production transaction database by inference. Honor the PostgreSQL/business-truth law and explicit operator gate for a new authoritative persistence decision. Production auth/server-side tenant authorization and durable order/offer truth must have independent acceptance evidence. |

## N. Wave-16 tranche-1 convergence update (2026-10-14, F353 @ `5d74b5c`)

| ID | Risk | Mitigation / record |
|---|---|---|
| C20 | Masked-industry coverage NARROWED but not eliminated by F351B/F353: remaining below-100 firms are agriculture small −14 / medium −6, healthcare-facilities small −10 / medium −3, facilities-management small −9 / medium −2, transportation-logistics small −3 (aggregate 47). Mining + construction B-3 closed (98→103, 97→102); telecom + water-waste small landed AT 100 as the measured field-journey bonus. | Grow-only future tranches over census-certified unexercised surface (the F350 §4 pattern); never broaden/remove masks without evidence; F354 recounts with both Wave-16 lanes present. `docs/evidence/F353/report.md` §3/§6 |
| C21 | The convergence anti-inflation tripwire changed form at F353 (the F342 "negative shortfall = inflation" check became "the cap may never regress below the 100 target + cap == corpus sum"). This is the F350 §4 sanctioned post-closure growth path, not a weakening — but any future corpus shrink below 100 now trips the regression check loudly. | The evolved check + the D14 census admission law (every corpus member machine-verified by the suites) are the guard; recorded transparently in `docs/evidence/F353/report.md` §4/§7 and the convergence-delta source comments. |

## O. Wave-16 close update (2026-10-14, F354 @ `1033be5`)

| ID | Risk | Mitigation / record |
|---|---|---|
| C22 | Wave-16 close residuals: 4 firms below 100 (agriculture small 91 −9 / medium 99 −1, healthcare-facilities small 95 −5, facilities-management small 96 −4; aggregate 19). The parallel-lane procurement id collision exposed a protocol gap: path-disjointness does not imply census-disjointness across corpora. | Future tranches follow the F350 §4 pattern with the F354 lesson: census proof re-ran at INTEGRATION against the merged tree before acceptance (the collision was caught and adjudicated there). `docs/evidence/F354/report.md` §4 |

## P. Wave-17 freeze record (2026-10-14, F360)

| ID | Risk | Mitigation / record |
|---|---|---|
| C23 | The marketplace live-pilot gate is BLOCKED: no real business-customer or independently verifiable supplier access is evidenced. Fixtures/contract tests must never be labelled live. | F369 acquisition track (catalog); the F361/F362 lanes are contract-backed and honestly fixture-labelled; mission §8 is the gate. `docs/product/MARKETPLACE-MVP-FREEZE.md` §1/§6 |

## Q. Wave-17 close record (2026-10-14, F362 E2E + re-pin)

| ID | Risk | Mitigation / record |
|---|---|---|
| C24 | The E2E transaction-spine journey is fixture-labelled, contract-backed composition — it must never be cited as live-pilot evidence. The manual catalogue import + provider-ack seams remain operator-mediated. | `docs/evidence/F362/report.md` (fixture-labelled throughout); the live-pilot gate stays BLOCKED on F369/F371; the seams plainly labelled in the F361C/F362 surfaces. B-3 now 30/30 firms with the masked-journey ledger intact — the applicable-target closure is a corpus-count fact, never a coverage-quality claim. |

## R. Wave-18 close record (2026-10-15, F370 convergence)

| ID | Risk | Mitigation / record |
|---|---|---|
| C25 | The production-persistence qualification is scoped honestly but narrowly: pglite (REAL PostgreSQL WASM, in-process) — no networked-PG-at-the-host-boundary claim; the keyring is file/env configuration-class — no real-KMS claim; the :3107 deployment service demonstrated at lane-gate on sandbox localhost only. The 2026-10-15 full-image rollback also exposed the gate-process fragility: two contention-diverged runs before the clean pass (the parens-regex pkill trap). | The MarketplaceStore port + swappable adapter seams + the recorded follow-up lanes (networked-PG, real KMS); SIGKILL crash-restart digests byte-identical machine-asserted; the kill-by-PID-tree + box-empty-before-gate-launch doctrine recorded in the F370 catalog close; `docs/evidence/F370C/report.md`; the recycle-proof backup branch pattern (`work/f370-re-pin-backup`). |
