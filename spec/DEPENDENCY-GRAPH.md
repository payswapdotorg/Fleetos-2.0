# FleetOS 2.0 Dependency Graph

## Canonical direction

```
Apps / Experience
      |
      v
Control Plane / Application
      |
      v
Domain Contexts
      |
      v
Contracts
      ^
      |
Adapters / Infrastructure
```

Intelligence is a read/propose layer:

```
Domain Facts ----> Intelligence
                     |
                     v
                 Proposal
                     |
                     v
                 Guardian
                     |
                     v
             Domain Command
```

Runtime is a substrate:

```
Experience
  -> Control Plane
  -> Runtime Kernel
  -> Tools / Agents / Workflows
  -> Domain Commands
```

Runtime must not reverse-import domain implementations.

## Hard dependency rules

1. Contracts depend on no FleetOS business context.
2. Domain contexts may depend on contracts and approved shared primitives only.
3. A domain context may not deep-import another context implementation.
4. Cross-context interaction happens through public contracts/application interfaces.
5. Adapters may depend on contracts/domain-facing ports but never redefine domain truth.
6. UI consumes application/domain read models; UI never imports repositories.
7. Runtime implementations may execute typed capabilities but may not mutate domain stores directly.
8. Intelligence may consume domain read models and propose commands, but cannot authorize or execute without Guardian.
9. Infrastructure details never leak into domain contracts.
10. No cycle is permitted.
11. No direct browser-to-provider credential flow.
12. No queue/cache/object-store write may bypass the authoritative application boundary.
13. Search/index projections are disposable and rebuildable.
14. Replay/recovery data must point back to authoritative records.

## Core flow

```
Observation
  -> Asset Twin
  -> Health/Security/Predictive
  -> Work/Mission
  -> Policy/Guardian
  -> Action Intent
  -> Execution
  -> Evidence/Verification
  -> Outcome
  -> Learning
```

## Predictive flow

```
Immutable observations
  -> privacy/purpose filtering
  -> predictive feature set
  -> representation
  -> prediction
  -> counterfactual
  -> advisory proposal
  -> Guardian
```

## Commerce flow

```
Work/Need
  -> Procurement Demand
  -> Vendor Matching
  -> Quote
  -> Authorization
  -> Order
  -> Fulfillment
  -> Verification
  -> Evidence
```

## Mission flow

```
Mission
  -> Workflow
  -> Task/Capability Request
  -> Guardian if required
  -> Execution
  -> Verification
  -> Mission progress
```

## Storage authority

```
PostgreSQL = business truth
Redis/Queue = coordination only
R2/Object Store = artifacts/evidence
Search = projection
Vector store = retrieval projection
Model memory = advisory context
Browser state = presentation state
```

## ZCode substrate mapping

```
ZCode RPC               -> FleetOS RPC
ZCode shared            -> FleetOS contracts/shared primitives
ZCode provider          -> FleetOS model gateway/provider adapters
ZCode services          -> FleetOS application/runtime services
ZCode client            -> FleetOS edge/agent SDK
ZCode web/ui            -> FleetOS experience plane
ZCode desktop           -> FleetOS desktop host
ZCode CLI/core          -> FleetOS agent/runtime kernel
Dynamic workflow       -> FleetOS workflow engine
MCP/plugins             -> FleetOS capability extension system
Browser/computer use    -> FleetOS execution tools
```
