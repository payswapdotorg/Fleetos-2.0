# F370 — the Wave-18 TL convergence (production pilot hardening)

- **Work item:** F370 (the Wave-18 convergence). **Date:** 2026-10-15.
  **Owner:** TL. **Lanes converged:** F370A `73b9fd5` (authentication +
  server-side tenant authorization) + F370B `4509b3a` (secret management) +
  F370C `a4f412c` (authoritative pglite persistence + verified :3107
  deployment — the recorded Wave-17 blocker CLOSED).
- **Converged candidate:** main `18633d0` — the F370 re-pin commit; the
  tree is identical to `work/f370-re-pin-backup` @ `1d60f62` (the
  recycle-proof backup branch; restore from it, never re-derive).
- **This report's law:** every value below was machine-measured or
  machine-run at the exact converged tree; nothing copied from lane reports
  without an independent gate.

## 1. The re-pin (TL-owned; the F361A/B/C/F362 precedent)

Adoption/release pins were honestly stale at the three lane merges (the
standing convention — lanes never re-pin). The convergence re-pins from the
measured converged tree:

| pin | lane-merge baseline | F370 converged | delta |
|---|---|---|---|
| journeyExecutions | 3591 | **3921** | +330 (= 11 universal journeys/firm: 5 F370A + 3 F370B + 3 F370C, × 30 firms) |
| fieldExecutions | 1383 | **1383** | unchanged (no field journeys in Wave 18) |
| commerceExecutions | 1317 | **1407** | +90 (= 3 F370C commerce journeys × 30) |
| securityExecutions | 891 | **1131** | +240 (= 8 security journeys: 5 F370A + 3 F370B, × 30) |
| fieldEpochReRuns (raw, never counted) | 406 | **406** | unchanged |
| commerceEpochReRuns (raw, never counted) | 1197 | **1287** | +90 |
| uniqueApplicableJourneys | 1119 | **1229** | +110 (11 new universal capabilities) |
| corpus cap (field+commerce+security) | 42+46+31 = 119 | **42+49+39 = 130** | +3 commerce (F370C) +8 security (F370A +5, F370B +3) |
| ACTIVE_PER_FIRM | 30 rows | every row **+11** | the universal journeys |
| max counted per firm | 135 | **146** | |
| construction+mining scoped | 372+375 | **405+408** | +33/+33 |
| water-waste epochs | [114,122,130] | **[125,133,141]** | +11 each |

Infrastructure pins: `LANE_EXTENSIONS` +F370A/B/C; the per-industry
SERIALIZATION law (one simulation at a time — the run-4 contention lesson);
12 explicit 900s test timeouts; `vitest.config.ts` ×2 (fileParallelism OFF,
adoption + release); release tamper-tripwires rebased to the REAL corpus
lengths (security **39**, commerce **49**).

## 2. The gates (machine-run on the rebuilt box)

- **Adoption 120/120 GREEN** — run 8, the clean single-run, 4523.74s:
  f332 25/25 (every pin exact + the D10/D13 determinism laws),
  adoption-run 10/10 (the serialized per-industry simulation),
  simulation 10/10, verdicts 26/26, industries 13/13, firms 12/12,
  convergence 5/5, incumbent 9/9, report 10/10.
- **Release 88/88 GREEN** — the re-run at the tripwire-fixed tree:
  integration 10/10, observability 22/22, cost 21/21, release-gate 35/35.
- **Typecheck exit 0 + statics 65/65** (the post-recycle validation; the
  single-process `tsc -b` OOMs on the 4GB sandbox — sequential per-project).

## 3. The gate-process incidents (recorded for the doctrine)

1. **Run 6** caught one re-application miss after the 2026-10-15 11:16Z
   full-image rollback: the f332 ACTIVE_PER_FIRM table + aggregate block
   (`130 vs 119`, `3921 vs 3591` — exactly diagnostic). Fixed; swept;
   backup branch updated.
2. **Run 7** proved every pin matches but the determinism re-runs diverged
   under contention: a `pkill -f "node (vitest)"` had silently MISSED the
   run-6 process (the pattern's parens are regex metachars). Doctrine:
   **kill process trees by PID, never by name pattern; verify the box is
   simulation-empty BEFORE any gate launch.**
3. **Run 8** is the definitive clean pass (single dfork'd gate; the chain
   auto-ran release).
4. **The release tripwire miss:** the run-8 release battery returned 86/88
   — the two "short corpus" tamper probes still pinned the F362-era
   lengths (`expected 31` security / `expected 46` commerce) while the
   REAL lengths are 39/49. Corrected; re-gated green; the backup branch
   carries the fix (`1d60f62`).

## 4. Verdict — WAVE 18 CLOSED

- B-3 stands (30/30 firms ≥ 100 at the F362 close; the F370 lanes add
  universal coverage, every firm +11).
- The Wave-17 blocker (production deployment + persistence undemonstrated)
  stays CLOSED: the :3107 service, REAL PostgreSQL WAL via pglite, SIGKILL
  crash-restart digests byte-identical — machine-asserted at the F370C
  lane gate.
- The release disposition remains **READY with named standing
  qualifications** (per `docs/tech-lead/FINAL-RELEASE-HANDOFF.md` §11),
  now including the Wave-18 scope: pglite = the WASM in-process build
  (networked-PG at the host boundary the recorded follow-up); the keyring
  file/env providers are configuration-class (real KMS the recorded
  follow-up); the live-pilot gate BLOCKED on F369/F371; fixture-labelled,
  never live; providers CONTRACT_ONLY; sandbox localhost only.

## 5. Next (the honest tail)

F371 (real customer + supplier pilot acceptance) stays PLANNED and gated
on F369 — operator-dependent acquisition, no invented partners. The
dispatchable engineering follow-ups on record: networked-PG at the host
boundary; real KMS for the keyring.
