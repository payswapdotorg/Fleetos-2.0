# FleetOS 2.0

FleetOS 2.0 is an AI-native Operations OS for physical and digital assets.

This repository is forked from Z.AI ZCode v3.14.3 and uses its agent/workflow/tooling substrate as the FleetOS execution kernel.

**The repository is the source of truth.** Start with [FLEETOS-SOURCE-OF-TRUTH.md](FLEETOS-SOURCE-OF-TRUTH.md).

## Architecture

```
Experience
  -> Control Plane
  -> Fleet Domain Kernel
  -> Intelligence Plane
  -> Execution Plane
  -> ZCode Runtime Kernel
  -> Infrastructure
```

Core invariants include authoritative Device Twins, immutable observations, advisory predictive models, Guardian-controlled consequential actions, tenant isolation, durable missions, provider-neutral adapters, and PostgreSQL as business truth.

## Canonical implementation documents

- [FLEETOS-SOURCE-OF-TRUTH.md](FLEETOS-SOURCE-OF-TRUTH.md)
- [spec/ARCHITECTURE-LOCK.md](spec/ARCHITECTURE-LOCK.md)
- [spec/BOUNDED-CONTEXTS.md](spec/BOUNDED-CONTEXTS.md)
- [spec/DEPENDENCY-GRAPH.md](spec/DEPENDENCY-GRAPH.md)
- [spec/worker-ownership.yaml](spec/worker-ownership.yaml)
- [spec/work-items/WORK-ITEM-CATALOG.md](spec/work-items/WORK-ITEM-CATALOG.md)
- [docs/tech-lead/FINAL-HANDOFF.md](docs/tech-lead/FINAL-HANDOFF.md)
- [docs/tech-lead/CONCURRENCY-PROTOCOL.md](docs/tech-lead/CONCURRENCY-PROTOCOL.md)

## Fork boundary

ZCode remains a reusable runtime substrate for:

- agent execution;
- workflows;
- tools;
- MCP/plugins;
- provider/model transport;
- browser/computer use;
- RPC;
- desktop/web/CLI hosting.

FleetOS owns the domain and control-plane semantics above it.

See [ADR-0001](spec/ADR/0001-zcode-fork-boundary.md).

## Development

The inherited ZCode toolchain remains available during the conversion phase.

Run:

```bash
pnpm fleetos:source-of-truth
pnpm fleetos:architecture
```

The implementation backlog starts with Wave 0 in [WORK-ITEM-CATALOG.md](spec/work-items/WORK-ITEM-CATALOG.md).

The first implementation dispatch is F200A + F200B + F200C concurrently, followed by TL convergence F201.

## Important

Inherited ZCode features are not automatically FleetOS product features.

A capability becomes part of FleetOS only when it is explicitly adopted by a FleetOS work item and satisfies its acceptance contract.
