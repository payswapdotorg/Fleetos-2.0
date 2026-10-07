# FleetOS 2.0 Agent Instructions

## Authority

This repository is the sole source of truth.

Before changing behavior, read:

1. `FLEETOS-SOURCE-OF-TRUTH.md`
2. `spec/ARCHITECTURE-LOCK.md`
3. `spec/BOUNDED-CONTEXTS.md`
4. `spec/DEPENDENCY-GRAPH.md`
5. `spec/worker-ownership.yaml`
6. `spec/work-items/WORK-ITEM-CATALOG.md`
7. the applicable work item and ADRs.

Never require conversation history to understand or implement a task.

## Operating rules

- Update the relevant spec/work item before implementing a new behavior.
- Distinguish confirmed facts from assumptions.
- Use repository source, tests, logs and runtime evidence as truth.
- Preserve unrelated local changes.
- Never claim tests, builds, deployment or browser acceptance that was not actually executed.
- Never turn a worker report into acceptance without independent TL verification.

## Architecture laws

- Domain truth belongs to the owning bounded context.
- UI state is not business truth.
- Agents and workflows cannot bypass Guardian.
- Predictive output is advisory and never authoritative.
- Provider SDKs stay behind adapters.
- Redis/queues/caches/search/vector stores are not business truth.
- Cross-context implementation imports are forbidden.
- Public contracts are the only cross-context API.
- Every consequential action has authorization, idempotency, audit and verification.
- Tenant context must exist at every persistence/action boundary.
- Durable missions/workflows cannot depend on a browser tab or request lifetime.
- Transactional outbox semantics protect business-state/event consistency.
- No cycles or deep imports.

## Worker model

Exactly three implementation workers:

- Worker A: Edge + Asset
- Worker B: Safety + Intelligence
- Worker C: Work + Commerce

The TL owns shared contracts, cross-worker integration, experience shell, infrastructure and acceptance.

Workers must stay inside their paths in `spec/worker-ownership.yaml`.

Workers never edit canonical shared contracts directly.

## Concurrency

Parallelize whenever dependencies permit.

Do not serialize independent bounded contexts.

A worker may prepare its next independent work item while another item is being integrated, but may not modify another worker's paths or depend on mutable unaccepted interfaces.

See `docs/tech-lead/CONCURRENCY-PROTOCOL.md`.

## Verification

Required baseline commands are determined by the actual repository scripts, but the canonical checks are:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm architecture:check
pnpm test
```

When a script is absent, use the closest repository-defined equivalent and record the exact command.

Interactive changes require browser/E2E verification.

Deployment work requires production/staging verification when the work item says so.

## Runtime / ZCode substrate

Inherited ZCode runtime code is substrate only.

Do not place FleetOS domain semantics into generic:

- agent runtime;
- workflow engine;
- provider transport;
- RPC;
- MCP;
- plugin host;
- browser/computer-use infrastructure;
- UI primitive libraries.

FleetOS concepts consume these through typed boundaries.

## UI rules

- Role lenses change presentation and available actions; they do not create separate copies of domain truth.
- Mobile is a first-class field surface, not merely a shrunken desktop.
- Search/command palette is search + navigation + intent entry + capability discovery.
- Every consequential action visibly communicates authorization and verification state.
- Empty, loading, degraded, unauthorized and unavailable states are honest and explicit.

## Data / persistence

PostgreSQL is authoritative business persistence.

Object storage holds artifacts/evidence.

Redis/queue holds ephemeral coordination only.

Search/vector indexes are disposable projections.

No feature may create a second authoritative state store.

## Security

Never log credentials, tokens, secrets or real customer data.

Never expose provider credentials to browser bundles.

Never bypass tenant checks with UI-only filtering.

Destructive actions require the explicit authorization/evidence path.

## Decisions

If the repository does not answer an implementation question:

1. inspect adjacent architecture/contracts/tests;
2. make the smallest compliant decision;
3. record it in an ADR or work-item decision section;
4. implement and test.

Only Architecture Lock/security/authority/persistence/licensing/irreversible migration changes require an explicit operator gate.
