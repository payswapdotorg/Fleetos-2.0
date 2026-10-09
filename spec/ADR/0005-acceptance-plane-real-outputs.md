# ADR-0005 — The Acceptance Plane: Machine-Run Journeys over Real Outputs

## Status

ACCEPTED (Waves 6–9; packages/acceptance/{field,security,commerce,adoption,release,
convergence})

## Context

Each wave's acceptance needed to prove that the lanes' machinery actually composes
at the public-contract level — not that unit tests pass, but that a realistic journey
through REAL package outputs works end-to-end and reports honestly. Prior art in the
forked substrate had "demo journeys" that faked or recomputed numbers.

## Decision

The acceptance plane is a set of packages that:

- drive ONLY the REAL public entry points of the lane packages under test (boundary
  greps enforce this per gate);
- make every number in every view equal a REAL output of a REAL package call (or a
  recorded refusal/shortfall with reason) — never recomputed, never invented;
- express verdicts as BOOLEAN gates with named blockers (READY/NOT-READY,
  CONVERGED/NOT-CONVERGED) — no weighted scores, no partial readiness;
- run as ordinary vitest suites (machine-run by the TL at the exact gate commit),
  with digest-verified corpora (journeys/steps/assertions counted honestly);
- include per-industry simulation (adoption: 30 workspaces across 10 industries ×
  3 firm sizes with a deterministic verdict rubric) and cross-role handoffs.

## Consequences

- Wave acceptance became reproducible by any future operator: `cd packages/acceptance/
  <x> && corepack pnpm run test`.
- The release gate (F281) and convergence gate (F291) inherit honest inputs by
  construction.
- The acceptance corpora are O(minutes) to run (the F271 simulation costs ~3–6 s) —
  feasible in CI.
- Residual: acceptance journeys are in-memory and caller-threaded; binding them to
  persisted stores and a live UI is composition work below the plane.
