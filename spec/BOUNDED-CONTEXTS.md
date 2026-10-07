# FleetOS 2.0 Bounded Contexts

This document defines the canonical ownership map.

## Identity & Tenancy

Owns:

- tenants;
- users/actors;
- roles;
- memberships;
- sessions;
- tenant context.

Never owns domain resource truth.

## Assets

Owns:

- managed assets;
- devices;
- device twins;
- lifecycle;
- capabilities;
- asset lineage references.

Observations are immutable inputs; Assets owns the canonical durable twin projection.

## Observations & Evidence

Owns:

- immutable observations/events;
- evidence metadata;
- evidence bundles;
- content-addressed artifacts;
- verification records.

## Health

Owns:

- health signals;
- diagnosis hypotheses;
- diagnosis records;
- treatment recommendations.

## Security

Owns:

- security findings;
- security posture;
- remediation proposals.

## Guardian / Policy

Owns:

- policies;
- policy evaluation;
- Guardian decisions;
- authorization reason codes;
- capability adoption authorization.

## Actions / Execution

Owns:

- action intents;
- execution state;
- idempotency;
- command dispatch;
- execution results.

It does not decide whether an action is authorized.

## Work / Projects

Owns:

- work items;
- assignments;
- projects;
- milestones;
- workloads;
- deadlines.

## Maintenance & Recovery

Maintenance owns:

- service plans;
- maintenance orders;
- schedules;
- warranty/service relationships.

Recovery owns:

- lost-device cases;
- recovery transitions;
- replacement proposals;
- evidence references.

## Commerce

Procurement owns:

- needs;
- demands;
- matching;
- quote lifecycle;
- orders;
- fulfillment state.

Vendors owns:

- vendor identity;
- capabilities;
- commercial scorecards;
- service relationships.

Software owns:

- software subscriptions;
- entitlements;
- allocations.

## Connectivity

Owns FleetOS connectivity intent and policy.

ADCOS remains the network-native execution provider.

## Learning / Arena

Owns:

- evaluation cases;
- outcome observations;
- capability evaluation;
- adoption proposals;
- certification references.

It does not become operational truth.

## Predictive

Owns:

- feature projections;
- predictive interpretations;
- uncertainty;
- provenance;
- model/capability version;
- predictive reference outputs.

It never writes authoritative device state.

## World Model

Owns:

- learned/deterministic representations;
- predictions;
- counterfactuals;
- model adapter seams.

It cannot authorize or execute actions.

## Simulation

Owns:

- simulation worlds;
- scenarios;
- agent organizations;
- experimental runs;
- comparison/evaluation inputs.

Simulation outputs remain experimental evidence.

## Mission / Control Plane

Owns:

- durable missions;
- workflow orchestration;
- schedules;
- coordination;
- handoffs;
- operator-facing progress.

It invokes domain commands; it does not bypass domain ownership.

## Runtime Kernel

Owns:

- sessions;
- agent execution;
- tools;
- workflow engine mechanics;
- MCP;
- plugins;
- browser/computer use;
- model/provider transport.

It does not own FleetOS business entities.

## Integrations

Integrations are adapters only.

Initial named adapters:

- ADCOS;
- Arena;
- Aurum;
- Apify;
- provider/model adapters;
- external fleet/vendor systems.

No integration becomes a domain authority.
