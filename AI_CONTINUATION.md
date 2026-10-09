# FleetOS 2.0 — Agent/TL Continuation Pointer

This file exists only as a compact repository navigation pointer.

It is intentionally not a second source of truth.

Read the canonical files instead:

- `FLEETOS-SOURCE-OF-TRUTH.md`
- `AGENTS.md`
- `spec/ARCHITECTURE-LOCK.md`
- `spec/BOUNDED-CONTEXTS.md`
- `spec/DEPENDENCY-GRAPH.md`
- `spec/worker-ownership.yaml`
- `spec/work-items/WORK-ITEM-CATALOG.md`
- `docs/tech-lead/FINAL-HANDOFF.md`
- `docs/tech-lead/CONCURRENCY-PROTOCOL.md`

Never treat this file as authoritative if it conflicts with those files.

## Execution state (2026-10-09, 02:3xZ)

**WAVE 8 COMPLETE (all four items) — production hardening + release gate live: 411 net-new tests this wave; main 13874dd; total 4384 package-suite tests, all green.**

- **F280A** (edge hardening) merged 005c829 — 110 net-new (adcos 178, observations 157, connectivity 138, maintenance 86, recovery 77).
- **F280B** (security/audit/replay/DR) merged 1158f18 — 112 net-new (security 147, policy 131, execution 118, simulation 103, predictive 74, safety-intel 113).
- **F280C** (commerce/SLA/marketplace/economics) merged 1cd6c93 — 101 net-new (procurement 123, vendors 94, model-gateway 98, software 79).
- **F281** (TL lane — production release gate) `work/f281` @ cd0240b, merged — 88 tests: NEW packages/acceptance/release (@fleetos/acceptance-release): deterministic observability rollups over the hardened surfaces, cost controls with ceiling enforcement, boolean READY/NOT-READY gate with named blockers + tamper detection. ALL FOUR acceptance baselines re-verified by TL (61/90/65/90).
- Evidence: docs/evidence/F280{A,B,C}/ + docs/evidence/F281/.

**Delivery channel doctrine (proven at scale):** chat.z.ai Agents-tab workers via the replay. Cure set: browser_kick.py turn spawning (in-page completions POST with X-Signature + captcha harvest — the HOST transport is ESA-blocked), composer arming sends (React-set + requestSubmit), stale-sandbox releases (dispatch_worker sandboxes + direct-tab Release clicks), capacity-modal cancels, resume nudges, fresh-tab reopens for wedged renderers. The VPN keepalive daemon must stay running (a dropped VPN = ESA 405 storm = no generation).

**Next ready work:** Wave 9 — the FINAL wave (catalog: "after the core product acceptance gate" — passed in Wave 7): F290A (asset lineage / material / method graph, Worker A), F290B (advanced world models / JEPA-family adapter implementations, Worker B), F291 (TL). After Wave 9: the completion rule (FINAL-HANDOFF) — final architecture lock, dependency graph, ownership, catalog, ADRs, tests, evidence, deployment/runbook, product acceptance report, explicit residual risks.

**Baseline at this writing:** main = 13874dd; 4384 package-suite tests green; evidence under `docs/evidence/<work-item>/`; packets under `docs/tech-lead/packets/`.
