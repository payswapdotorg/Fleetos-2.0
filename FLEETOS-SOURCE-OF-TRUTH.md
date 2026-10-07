# FleetOS 2.0 — Repository Source of Truth

## Status

This repository is the **sole authoritative source of truth** for FleetOS 2.0.

Canonical repository: https://github.com/payswapdotorg/Fleetos-2.0

The conversational history that produced this architecture is not authoritative and must not be required to implement, review, test, deploy, or continue FleetOS.

## Authority order

When sources conflict, use this order:

1. `spec/ARCHITECTURE-LOCK.md`
2. `spec/BOUNDED-CONTEXTS.md`
3. `spec/DEPENDENCY-GRAPH.md`
4. `spec/worker-ownership.yaml`
5. `spec/work-items/WORK-ITEM-CATALOG.md`
6. applicable ADRs under `spec/ADR/`
7. current source code and tests
8. operational/runbook documents under `docs/`
9. Git history and accepted PRs
10. issue/PR comments that record implementation evidence

Issue/PR discussion can record evidence and decisions, but a decision is not canonical until reflected in the appropriate repository document.

## Repository rule

Every implementation task must be executable from the repository without access to the originating chat.

A TL or worker must never write:

- "as discussed in chat";
- "per the model";
- "per the user conversation";
- "see previous assistant response";

Instead, the canonical decision must be recorded in this repository first.

## Decision protocol

If an implementation question is not answered by the repository:

1. inspect the architecture lock and relevant bounded-context specs;
2. inspect adjacent contracts and tests;
3. choose the smallest solution consistent with the lock;
4. record the decision in an ADR or work-item decision section;
5. implement;
6. add regression/architecture tests where appropriate.

Only the following require an explicit operator gate:

- changing the Architecture Lock;
- changing tenant/security invariants;
- changing the authority boundary of Guardian;
- introducing a new authoritative persistence system;
- irreversible data migration;
- licensing/commercial-plan changes;
- releasing a materially different public product contract.

Routine implementation ambiguity is resolved by the TL and recorded in-repo.

## Fork lineage

FleetOS 2.0 is forked from Z.AI ZCode v3.14.3.

ZCode is treated as an execution-kernel substrate, not as FleetOS domain authority.

The fork retains valuable ZCode capabilities such as agent runtime, tools, workflow runtime, MCP, plugin infrastructure, model/provider seams, browser/computer use, RPC, desktop/web/CLI hosts, and architecture governance.

ZCode product semantics must not constrain FleetOS domain design.

## Upstream policy

Do not blindly merge upstream ZCode.

Every upstream synchronization must:

- identify the imported commit/range;
- run the FleetOS architecture suite;
- run typecheck/lint/tests/builds;
- inspect dependency graph changes;
- verify no FleetOS authority boundary moved;
- record acceptance in an ADR or upstream-import record.

Security fixes may be fast-tracked, but still require compatibility verification.

## Canonical implementation rule

A feature is not complete because code exists.

It is complete only when the applicable repository-defined acceptance contract is satisfied, including:

- architecture boundaries;
- contracts;
- tests;
- integration;
- UI journey where applicable;
- tenant/security proof;
- observability/evidence;
- deployment verification when the work item requires live acceptance.

## Completion evidence

Each completed work item must leave a durable record containing:

- work-item id;
- accepted commit(s);
- scope verification;
- architecture checks;
- typecheck;
- tests;
- build;
- browser/E2E evidence when applicable;
- live deployment evidence when applicable;
- residual limitations;
- follow-up work, if any.

## Never trust reported numbers

Worker-reported completion claims are evidence candidates, not truth.

The TL must verify Git state, changed paths, tests and acceptance evidence on the delivered tree.

Workers may not self-certify cross-worker integration.

## Current entrypoint

Read in this order:

1. `AGENTS.md`
2. `spec/ARCHITECTURE-LOCK.md`
3. `spec/BOUNDED-CONTEXTS.md`
4. `spec/DEPENDENCY-GRAPH.md`
5. `spec/worker-ownership.yaml`
6. `spec/work-items/WORK-ITEM-CATALOG.md`
7. `docs/tech-lead/FINAL-HANDOFF.md`
8. `docs/tech-lead/CONCURRENCY-PROTOCOL.md`

Then inspect the work item being executed.

## Repository-first continuation

A new engineer/agent/TL must be able to delete its conversation history and continue from this repository alone.
