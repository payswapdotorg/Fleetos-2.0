# F352 — TL convergence, deployment re-verification + final disposition (Wave 15 close)

- **Work item:** F352 (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 15; contract
  `docs/evidence/F350/report.md` §5 — the binding law; FINAL-RELEASE-HANDOFF
  §2/§11 the disposition law).
- **Owner:** TL (convergence + disposition are TL-owned; no worker lane).
- **Date:** 2026-10-13. **Converged tree:** `88b8506` (main, pushed).
- **Lane under convergence:** F351A (worker A / w15a) — code `ab3a85d`,
  evidence+catalog `be46b01`, merge `88b8506`.

## 1. The convergence battery at the exact converged tree

The merge `88b8506` introduces ZERO tree changes beyond the gated lane tip
(`be46b01` — identical tree hash `74d7e9c898c67a8dcebcb612a09737621f62808e`),
so the TL gate battery at `be46b01` IS the converged-tree battery. Every number
below was machine-run by the TL in the TL sandbox at that tree (fresh measures,
no log-text inference):

| Gate | Result |
|---|---|
| field acceptance | **102/102** (7 files) — green |
| security acceptance | **179/179** (8 files) — green |
| commerce acceptance | **115/115** (6 files) — green |
| convergence acceptance | **82/82** (4 files) — green |
| maintenance acceptance | **99/99** (5 files) — green |
| adoption acceptance | **120/120** (9 files) — green |
| release gate | **88/88** (4 files) — green, verdict pins intact |
| counts ledger | **3027 / 1179 / 1017 / 831 / 931** — machine-locked by assertions in `adoption/tests/f332.test.ts`, `adoption/tests/simulation.test.ts`, `release/tests/integration.test.ts` (all green) |
| typecheck | exit 0 on ALL 13 root projects (machine-run sequentially under the 4GB sandbox ceiling — the single-process `tsc -b` OOMs; C5 records the builder requirement) + service `tsc -p` exit 0 |
| lint | oxlint **0 warnings / 0 errors** on the 19 lane files |
| boundary | `git diff --name-only 761161b...be46b01` = 32 paths, ALL packet-owned (evidence 16, service 11, shell 4+3 modified, catalog 1); zero acceptance paths |
| file law | max 381 lines (service.ts) ≤ 400 |

## 2. Q2 re-run by the TL at the exact converged SHA

`proof-restart.mjs` machine-run at checkout `88b8506` (the service log carries
`commit 88b850652810c62f1fb050dbda2ec6c277838766`):

- seed: 2 enrollments across 2 tenants + 3 commands (clean, duplicate, refused)
- SIGKILL delivered (signal=SIGKILL), service restarted, replay 1c/3a/2s
- **all four digests MATCH byte-exactly** (commands/audit/assets/total), raw
  segment sha256s unchanged, tenant-scoped reads identical
- **exit 0**

## 3. Q3 re-run by the TL at the exact converged SHA

Shell rebuilt at `88b8506` (footer `__FLEETOS_COMMIT__` = the merge SHA,
verified in the built asset), single isolated supervisor + fresh data dir
(`/tmp/f352-q3`), one service generation, browser driven through the sandbox
Chrome:

- durable mode active (`?mode=durable`), all six routes render
- E2E through the UI: submit → `ENQUEUED cmd_0000000001`; resubmit →
  `duplicate=true` returning the ORIGINAL ack (single queue record, dual audit
  entries); pre-kill in-page audit digest `58e85f85…a4a06`
- **SIGKILL the service pid → supervisor generation 2 → replayed 1c/2a →
  browser reload → footer `88b8506…` unchanged, `cmd_0000000001` still queued,
  audit digest `58e85f85…a4a06` byte-identical**
- in-process mode regression intact (default mode unchanged; zero
  acceptance-path changes — Q5)

## 4. The wave verdict — which qualifications converted

| Qualification (pre-Wave-15) | State after F351A+F352 |
|---|---|
| production deployment composition NOT demonstrated | **DEMONSTRATED + scoped** — a supervisor-kept `node:http` service on fixed :3106 serving the static shell + the durable operational plane; footer-proven at the exact candidate |
| durable operational persistence NOT demonstrated | **DEMONSTRATED + scoped** — append-only fsync-before-ack JSONL segments; replay-on-start through the REAL CommandQueue/EnrollmentDirectory with canonical-JSON byte-exact verification; SIGKILL restart-recovery machine-proven twice (worker at `ab3a85d`, TL at `88b8506`) and browser-verified twice (worker 15 screenshots, TL isolated redo) |
| masked industries below cap | **structural, unchanged** — per-journey rationales recorded (F342); the F351B capability-backed plan is the honest path, NOT dispatched this wave |
| providers (Aurum/ADCOS/Arena) | **CONTRACT_ONLY, unchanged** — no provider described as ready; F323 stays deferred pending upstream evidence |

## 5. Release disposition (FINAL-RELEASE-HANDOFF §11 — the TL's alone to state)

**READY — with the named standing qualifications, none a blocker:**

1. All mandatory gates evidenced at the converged tree `88b8506` (§1) — six
   suites + release green, typecheck/lint clean, boundary clean, file law held.
2. The 100-journey criterion met honestly for fully-applicable firms: B-3
   CLOSED at F342 (manufacturing + energy-utilities small firms AT exactly 100
   = 94+6; 17/30 firms ≥ 100); every remaining shortfall is mask-structural
   with per-journey rationales — never fabricated. The machine-pinned release
   verdict (F343 re-pins, green at this tree) is READY with zero blockers.
3. Product/deployment acceptance evidenced (F351A Q1–Q5, TL re-verified at the
   converged SHA — §2/§3).
4. No required external integration is described as ready without end-to-end
   evidence: providers stay CONTRACT_ONLY with the deferral recorded.

**Standing qualifications (honest scope, permanently recorded):**
sandbox-hosted (single external port — no public-internet claim); process-crash
durability via fsync (not power-loss); the fixture WORLD remains the
domain-input convention — the OPERATIONAL plane (commands/audit/assets) is what
is durable; actor identity is shape/scope-validated, not authenticated;
providers CONTRACT_ONLY; masked industries structural.

## 6. Documentation updates in this convergence

- `spec/work-items/WORK-ITEM-CATALOG.md` — F352 row marked DONE with this
  record.
- `AI_CONTINUATION.md` — Wave-15 final-state section appended.
- `docs/tech-lead/RESIDUAL-RISKS.md` — C9/C15/C17 updated to the demonstrated +
  scoped state; wave-15 clarification rows added.
- Issue #3 disposition comment posted (GitHub, the operator-visible record).

## 7. Residuals

- C5 (root single-process `tsc -b` needs the ≥8GB builder) unchanged.
- The durable service is not wired to the resident console's gateway (:3100) —
  it is the qualification composition on :3106; productizing the wiring is a
  future TL decision, not a Wave-15 obligation.
- F351B (masked-industry capability-backed narrowing) remains the next honest
  lane if the roadmap reopens.
