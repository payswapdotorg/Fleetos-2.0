# FleetOS 2.0 Bootstrap Checklist

This is a verification checklist, not a second architecture source.

## Repository authority

- [x] FleetOS source-of-truth document exists.
- [x] Architecture Lock exists.
- [x] Bounded-context ownership exists.
- [x] Dependency graph exists.
- [x] Worker ownership exists.
- [x] Work-item catalog exists.
- [x] Concurrency protocol exists.
- [x] Autonomous TL handoff exists.
- [x] Continuation pointer exists.
- [x] ZCode fork-boundary ADR exists.
- [x] Upstream baseline is recorded.

## Product identity

- [x] root package name changed to fleetos-2.0.
- [x] FleetOS architecture version declared as 2.0.0.
- [x] FleetOS source-of-truth path declared in package.json.
- [x] root README identifies FleetOS as the product.

## Execution model

- [x] exactly three implementation workers are defined.
- [x] each worker has explicit owned paths.
- [x] TL owns shared contracts/integration.
- [x] parallelization rules are documented.
- [x] merge verification rules are documented.
- [x] no-chat continuation rule is documented.

## Remaining implementation

The checklist intentionally does not mark Wave 0 implementation complete.
The TL must execute the work catalog beginning at F200A/F200B/F200C/F201 and record actual acceptance evidence.

## First implementation-session verification

Run:

pnpm fleetos:source-of-truth
pnpm architecture:check
pnpm lint
pnpm typecheck
pnpm build

Any failure is recorded honestly in repository state and becomes part of the baseline until resolved.