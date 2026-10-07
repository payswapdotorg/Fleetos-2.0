# FleetOS 2.0 — Infrastructure drivers

## Position

Drivers bind the kernel ports (`@fleetos/kernel`) to runtime infrastructure.
PostgreSQL is the authoritative business persistence target per
`spec/ARCHITECTURE-LOCK.md` (law A1) and `spec/DEPENDENCY-GRAPH.md`
(the storage-authority table). The deterministic in-memory reference
driver lives INSIDE the kernel package for test determinism — it is the
source of truth for every test in the repo until the SQL driver lands.

## What lives here

- `postgres/` — the Postgres driver SKELETON:
  - `sql-driver-port.ts` — the structural `SqlDriverPort` interface
    (connection/transaction primitives shaped for `node-postgres`/`pg`-
    style drivers).
  - `schema.ts` — the schema contract: DDL shapes for the outbox table
    + optimistic-concurrency columns, as TypeScript string constants +
    a migration contract type.
  - `index.ts` — honest `unimplemented` state marker.

## What does NOT live here (yet)

This directory is intentionally skeleton-only. The live Postgres binding
is a later deployment work item and is gated on:

- production-grade migration tooling (Prisma/Alembic-class);
- secrets management (no credentials in the repo);
- a deployment work item that requires staging/production verification
  per `AGENTS.md` (rule: "Deployment work requires production/staging
  verification when the work item says so").

Until then, every FleetOS test runs against the deterministic in-memory
reference driver in `@fleetos/kernel`. The live binding will replace
the in-memory driver at the composition layer — no kernel contract
changes are required because both implement the same ports.

## Architecture-law compliance

| Law | How drivers comply |
| --- | --- |
| A1 — one source of business truth | Postgres is authoritative. The in-memory driver is a test reference only. |
| A8 — tenant isolation | The schema contract enforces per-tenant keyspaces (every table has `tenant_id` as a partition key; cross-tenant queries fail closed). |
| A14 — transactional outbox | The outbox table is in the SAME transaction as the state change (DDL constants enforce this structurally). |
| A19 — audit | The audit table is append-only, tenant-scoped, hash-verifiable. |

## Dependency direction

`infrastructure/postgres` depends on `@fleetos/kernel` (the ports). It
does NOT depend on any `@fleetos/*` domain context. Domain contexts
consume the kernel's public entry; the composition layer (TL's
`apps/web`, `apps/control-plane`) binds a driver to the kernel's ports.
