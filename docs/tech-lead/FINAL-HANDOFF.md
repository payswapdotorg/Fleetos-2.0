# FleetOS 2.0 — Final TL Handoff

## Mission

Turn this ZCode fork into FleetOS 2.0 exactly as specified by the repository.

Do not rely on conversation history.

The repository is the only authoritative source.

## Read first

1. `FLEETOS-SOURCE-OF-TRUTH.md`
2. `AGENTS.md`
3. `spec/ARCHITECTURE-LOCK.md`
4. `spec/BOUNDED-CONTEXTS.md`
5. `spec/DEPENDENCY-GRAPH.md`
6. `spec/worker-ownership.yaml`
7. `spec/work-items/WORK-ITEM-CATALOG.md`
8. `docs/tech-lead/CONCURRENCY-PROTOCOL.md`

Then inspect the actual source tree before implementing.

## Non-negotiable execution model

You are the Tech Lead.

Use exactly three implementation workers:

- Worker A — Edge + Asset
- Worker B — Safety + Intelligence
- Worker C — Work + Commerce

Exploit every safe concurrency opportunity.

Do not serialize independent bounded contexts.

Do not compromise architecture to gain parallelism.

## First phase: repository conversion

Execute Wave 0 before feature work:

- F200A;
- F200B;
- F200C;
- F201.

F200A/B/C are parallel.

F201 converges their contracts and architecture metadata.

The goal is not to rewrite ZCode blindly. Preserve good substrate capabilities while establishing clean FleetOS boundaries.

## Critical conversion decision

ZCode becomes the runtime substrate.

FleetOS becomes the product/domain authority.

Do not place FleetOS business logic into:

- generic ZCode runtime;
- generic provider packages;
- generic UI primitives;
- generic RPC framework.

FleetOS bounded contexts sit above those primitives.

## Canonical architecture

```
FleetOS Experience
       ↓
Control Plane
       ↓
Domain Kernel
       ↓
Intelligence Plane
       ↓
Execution Plane
       ↓
ZCode Runtime Kernel
       ↓
Infrastructure
```

Remember the authority direction:

```
Agent / Workflow / Model
        ↓
   typed capability
        ↓
      Guardian
        ↓
 domain command
        ↓
   authoritative state
```

Never invert this.

## Worker dispatch

### Worker A

Own:

- identity/tenancy;
- managed assets;
- Device Twin;
- observations;
- health;
- recovery;
- maintenance;
- connectivity;
- fleet edge agent.

Primary implementation waves:

F200A -> F210A -> F220A -> F230A -> F240A -> F250A -> F260A -> F270A -> F280A -> F290A.

### Worker B

Own:

- Guardian/policy;
- security;
- actions;
- execution;
- evidence;
- Predictive Twin;
- world model;
- world context;
- learning;
- simulation/evaluation.

Primary implementation waves:

F200B -> F210B -> F220B -> F230B -> F240B -> F250B -> F260B -> F270B -> F280B -> F290B.

### Worker C

Own:

- work;
- projects;
- workloads;
- procurement;
- vendors;
- software;
- agent organizations;
- model gateway.

Primary implementation waves:

F200C -> F210C -> F220C -> F230C -> F240C -> F250C -> F260C -> F270C -> F280C -> F290C.

## TL-owned work

The TL owns:

- contracts;
- architecture;
- dependency graph;
- control plane;
- mission/workflow composition;
- UI shell;
- Control Tower;
- search/command surface;
- integrations;
- infrastructure;
- deployment;
- cross-worker integration;
- production acceptance;
- repository state.

## Shared contract discipline

When workers discover a contract problem:

- do not patch around it in worker code;
- record the proposed change in the work item;
- adjudicate centrally;
- update canonical contracts;
- re-run dependent tests.

## Implementation sequence

### Wave 0

Repository conversion and architecture governance.

### Wave 1

Kernel/persistence.

### Wave 2

Operational domain.

### Wave 3

Edge + intelligence.

### Wave 4

Experience.

### Wave 5

Integrations.

### Wave 6

Simulation/Engineering Lab.

### Wave 7

Real product acceptance.

### Wave 8

Production hardening.

### Wave 9

Advanced industrial intelligence.

## Do not repeat the previous FleetOS failure mode

The previous FleetOS implementation accumulated architecture correctly but discovered too late that several user-facing lanes were placeholders.

For FleetOS 2.0:

- capability contracts and UI entry points must be designed together;
- every meaningful domain capability must have a real application surface;
- no placeholder lane is accepted as "done";
- live acceptance is part of the work item, not a final afterthought.

## Do not repeat the previous ZCode failure mode

The inherited ZCode repository contains strong runtime infrastructure but also multiple architectural generations.

Do not preserve accidental duplication simply because it already exists.

During Wave 0 identify and converge:

- contract systems;
- provider abstractions;
- workflow abstractions;
- tool registries;
- runtime abstractions;
- shared-type layers.

Only one canonical implementation should survive for each concern.

## Verification baseline

Every wave must report:

- git head;
- branch;
- exact accepted commits;
- architecture check;
- typecheck;
- test counts;
- build;
- changed-file scope;
- tenant/security evidence where applicable;
- browser/E2E evidence where applicable;
- deployment evidence where applicable.

Known existing failures may remain only when:

- independently reproduced;
- documented;
- proven unrelated;
- included in the canonical baseline;
- not masking regressions.

## Acceptance definition

FleetOS 2.0 is not complete when the architecture is elegant.

It is complete when a real user can:

- enroll assets;
- see trustworthy operational state;
- investigate problems;
- understand evidence;
- ask FleetOS to reason;
- receive predictive advice;
- create/approve/execute work;
- procure resources;
- manage projects/workloads;
- recover devices;
- operate in the field;
- use agent automation safely;
- inspect why actions happened;
- replay important missions;
- learn from outcomes.

## Final product acceptance

Run the Wave 7 industry simulation against the deployed product.

Use the repository-defined rubric:

- SWITCH-ONLY
- MAIN-INTERFACE
- COMPLEMENT
- RETAIN

Do not inflate results.

## Completion rule

When the entire architecture has been implemented, the repository must contain:

- final architecture lock;
- final dependency graph;
- final worker ownership;
- complete work-item catalog;
- accepted ADRs;
- architecture reports;
- tests;
- evidence;
- deployment/runbook;
- product acceptance report;
- explicit residual risks.

A future TL must be able to start from this repository and continue without this conversation.


## Current release execution handoff

For the current release state and next executable wave, read `docs/tech-lead/FINAL-RELEASE-HANDOFF.md` before dispatch. That file and `spec/work-items/WORK-ITEM-CATALOG.md` define Wave 12, current blockers, ownership, acceptance rules and provider-readiness boundaries. Do not use this foundational handoff as a substitute for the current release-specific handoff.
