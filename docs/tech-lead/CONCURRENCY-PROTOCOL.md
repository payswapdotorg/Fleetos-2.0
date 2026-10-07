# FleetOS 2.0 TL / 3-Worker Concurrency Protocol

## Objective

Exploit maximum safe concurrency without sacrificing architecture, integration quality or deterministic acceptance.

## Roles

### TL

The TL is the integrator and architecture owner.

The TL:

- reads repository truth;
- dispatches exactly three workers;
- freezes shared contracts before parallel implementation;
- maintains dependency graph;
- merges one worker contribution only after exact-tree verification;
- owns cross-worker composition;
- owns deployment and product acceptance;
- updates repository state documents.

The TL does not become a fourth implementation lane for worker-owned code.

### Worker A

Edge + asset lane.

### Worker B

Safety + intelligence lane.

### Worker C

Work + commerce + agent-organization lane.

## Maximum concurrency

At any time:

- 3 worker implementation lanes maximum;
- TL may perform documentation, integration, validation and shared-contract work concurrently;
- workers may run independent tests/validation concurrently;
- no two workers modify the same owned path;
- no worker depends on another worker's unaccepted mutable API.

## Dependency protocol

For each item, the TL records:

- prerequisites;
- frozen input contracts;
- owned paths;
- expected outputs;
- test obligations;
- integration owner.

A worker may start only when all prerequisite contracts are frozen.

## Parallelization patterns

### Pattern A — fully parallel

Use when three lanes have independent bounded-context surfaces.

Example:

F220A + F220B + F220C.

### Pattern B — foundation then fan-out

Use when one shared surface must freeze first.

Example:

F200B -> F210B/F230B/F240B.

### Pattern C — two workers parallel, third preparatory

When only two implementation lanes are unblocked:

- dispatch two;
- third worker prepares fixtures/tests/docs/adapter harnesses inside its own scope;
- no speculative cross-scope implementation.

### Pattern D — TL composition while workers build

While workers implement:

- TL maintains application composition;
- deployment harnesses are prepared;
- E2E scaffolds are created;
- architecture checks are updated;
- integration fixtures are prepared;
- test environment is kept reproducible.

This avoids serializing the wave around TL work.

## Handoff packet

Every worker receives a repository-local packet:

- work item path/section;
- exact scope;
- dependencies;
- frozen contracts;
- acceptance criteria;
- commands;
- forbidden paths;
- expected evidence files.

Workers do not need the chat.

## Merge protocol

For every worker contribution:

1. fetch commit from origin;
2. verify changed paths against ownership;
3. inspect contract changes;
4. re-run architecture checks;
5. run typecheck;
6. run relevant tests;
7. run full suite where required;
8. run build when applicable;
9. review dependency graph;
10. run integration tests against real neighboring implementations;
11. merge;
12. re-run post-merge gates;
13. record exact accepted commit and evidence.

Never merge based only on worker prose.

## Shared contract protocol

Workers never directly edit canonical contracts.

Instead:

1. worker records requested contract delta in work-item notes;
2. TL adjudicates;
3. TL changes canonical contract;
4. worker rebases/re-integrates;
5. worker tests against the frozen contract.

## No early-return rule

A wave is incomplete if:

- code landed but integration is missing;
- tests pass but UI is unreachable;
- UI renders but domain state is fake;
- local verification passes but production acceptance required by the work item has not happened;
- deployment is blocked and no honest record exists.

## Evidence rule

Every accepted lane records evidence under:

`docs/evidence/<work-item>/`

The evidence record must identify the exact commit tested.

## Saturation rule

The TL should continuously ask:

- Is A blocked? Can A prepare the next independent item?
- Is B blocked? Can B prepare benchmarks/tests?
- Is C blocked? Can C prepare fixtures/contracts?
- Is TL integrating? Can workers safely continue another ready lane?
- Is a dependency truly semantic, or merely an implementation sequencing habit?

Do not serialize work simply because the work item numbers are sequential.

## Quality rule

Concurrency must never require:

- shared mutable ownership;
- undocumented contract assumptions;
- copying business truth into UI state;
- disabling architecture checks;
- skipping post-merge verification;
- reducing evidence requirements.
