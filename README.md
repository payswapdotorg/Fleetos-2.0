# FleetOS 2.0

FleetOS 2.0 is an AI-native Operations OS for physical and digital assets.

This repository is forked from Z.AI ZCode v3.14.3 and turns its agent/workflow/tooling substrate into the execution kernel for FleetOS.

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

Key principles:

- Fleet Device Twin remains authoritative.
- Observations/events are immutable.
- Predictions are advisory and versioned.
- Contract Guardian is the sole consequential-action authority.
- Agents and workflows use typed capabilities.
- PostgreSQL is business truth.
- Redis/queues/caches/search/vector stores are not business truth.
- Provider-specific implementations stay behind adapters.
- Every important mission is durable, replayable and evidence-linked.

## Repository navigation

| File | Purpose |
|---|---|
| [FLEETOS-SOURCE-OF-TRUTH.md](FLEETOS-SOURCE-OF-TRUTH.md) | repository authority and decision protocol |
| [spec/ARCHITECTURE-LOCK.md](spec/ARCHITECTURE-LOCK.md) | frozen architecture invariants |
| [spec/BOUNDED-CONTEXTS.md](spec/BOUNDED-CONTEXTS.md) | canonical state ownership |
| [spec/DEPENDENCY-GRAPH.md](spec/DEPENDENCY-GRAPH.md) | dependency direction |
| [spec/worker-ownership.yaml](spec/worker-ownership.yaml) | TL + three-worker ownership |
| [spec/work-items/WORK-ITEM-CATALOG.md](spec/work-items/WORK-ITEM-CATALOG.md) | implementation backlog |
| [docs/tech-lead/FINAL-HANDOFF.md](docs/tech-lead/FINAL-HANDOFF.md) | autonomous TL handoff |
| [docs/tech-lead/CONCURRENCY-PROTOCOL.md](docs/tech-lead/CONCURRENCY-PROTOCOL.md) | concurrency/merge protocol |

## Fork strategy

ZCode is retained as a runtime substrate for:

- agents;
- workflows;
- tools;
- MCP/plugins;
- provider/model transport;
- browser/computer use;
- RPC;
- desktop/web/CLI hosting.

FleetOS domain concepts must remain outside those generic substrate packages.

Do not blindly merge upstream ZCode. See the upstream/fork boundary ADR and source-of-truth document.

## Development

Toolchain versions remain inherited from `mise.toml` until the FleetOS conversion work item explicitly changes them.

Inspect available root scripts with:

```bash
pnpm
```

The conversion phase will replace ZCode product commands and environment names with FleetOS names while preserving useful runtime build machinery.

## Implementation status

The repository begins from the ZCode v3.14.3 fork baseline.

FleetOS implementation begins at Wave 0 in [WORK-ITEM-CATALOG.md](spec/work-items/WORK-ITEM-CATALOG.md).

Do not treat inherited ZCode functionality as FleetOS product functionality unless a FleetOS work item explicitly adopts it.
