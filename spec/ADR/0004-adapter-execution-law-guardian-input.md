# ADR-0004 — Adapter Execution Law and Guardian Authorization-as-Input

## Status

ACCEPTED (implemented Waves 0–9; enforced by boundary greps + purity sweeps + tests)

## Context

FleetOS integrates external systems (AD/COS command planes, connectivity intent
planes, Aurum payments, Apify actor jobs, vendor catalogs, world models). These
integrations can execute real-world effects. The architecture lock requires that
agents/workflows can never bypass the Guardian. The failure mode to prevent: an
adapter package minting authorization and executing side effects on its own.

## Decision

- Adapter packages NEVER execute: every external-system behavior is expressed as
  pure journals, registries, lifecycles and PROPOSALS. Transport is the composing
  application's work (law A7).
- Guardian authorization is an INPUT, never minted: adapter lifecycles (actor jobs,
  adoption, action plans) hold `authorization = null` until a Guardian decision is
  passed in; ceilings are explicitly documented as "ceiling ≠ authorization".
- Denied or absent authorization is always a named refusal; refusals are honest and
  carry reason codes; quarantines preserve the original payload verbatim.
- The world-model plane additionally cannot authorize or execute actions at all
  (structural: no ActionIntent/GuardianDecision producers in the adapter surface).

## Consequences

- The entire integration plane is testable without any live external system, and
  every refusal/quarantine is auditable with its original evidence.
- Real transports remain composition work — recorded as a standing residual.
- The pattern repeated cleanly across Waves (adcos/connectivity in W5, aurum/apify/
  vendors in W5C, JEPA in W9B) with the same vocabulary, enabling the F281 release
  gate and F291 convergence gate to consume adapter outputs as pure evidence.
