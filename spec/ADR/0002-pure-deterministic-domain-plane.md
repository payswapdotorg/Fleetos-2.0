# ADR-0002 — The Pure Deterministic Domain Plane

## Status

ACCEPTED (implemented across Waves 0–9; verified per work-item gate)

## Context

FleetOS domain packages (identity, tenancy, assets, observations, health, recovery,
maintenance, connectivity, work, projects, workloads, procurement, vendors, software,
agent-organizations, model-gateway, policy, actions, execution, evidence, predictive,
world-model, world-context, learning, simulation, arena, safety-intel, adcos, aurum,
apify, external-vendors, health-integration, and the acceptance plane) carry the
business truth of the system.

Early exploration (Wave 0) found the inherited ZCode substrate mixed runtime concerns
into domain layers. To keep FleetOS business truth independent of the substrate and
machine-verifiable, the implementation had to choose a domain-code discipline.

## Decision

Every domain package is a PURE deterministic TypeScript module:

- All state is caller-threaded values — no package owns a store, daemon, socket,
  timer, or background task.
- Wall-clock time, randomness, network and filesystem I/O are FORBIDDEN in domain
  code; every temporal or stochastic concept is expressed over caller-supplied
  logical inputs (`now` as a value, seeded windows, deterministic digests).
- Re-running any function on the same inputs is byte-identical (machine-tested with
  determinism proofs at every layer, up to the acceptance corpora).
- Every file obeys the 400-code-line law (skipBlankLines/skipComments); lint and
  typecheck gates run per package per work item.

Persistence, transport, scheduling and UI binding are composition work that lives
above the domain plane (the composing application / control plane), never inside it.

## Consequences

- Domain behavior is provable by ordinary test suites; no mocks of time/network are
  ever needed.
- Every acceptance number can trace to a deterministic real output.
- The cost: the system's runtime wiring (stores, queues, live transports) is deferred
  to composition and is not part of the domain test surface — recorded as a standing
  residual (see the residual-risks register).
- Determinism laws made the JEPA family (F290B) expressible as a deterministic
  structural analogue with provable non-expansion, without ML infrastructure.
