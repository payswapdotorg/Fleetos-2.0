# FleetOS 2.0 Architecture Lock

**Version:** 2.0.0
**Status:** FROZEN FOR IMPLEMENTATION
**Canonical source:** repository

## 1. Product identity

FleetOS is an AI-native Operations OS for physical and digital assets.

It combines:

- fleet/device management;
- health and diagnostics;
- security;
- maintenance and recovery;
- workloads/projects;
- procurement and vendors;
- connectivity;
- durable missions/workflows;
- predictive twins/world models;
- agent organizations;
- learning/evaluation.

ZCode is the execution and interaction substrate underneath FleetOS.

FleetOS business truth remains independent of ZCode implementation details.

## 2. Canonical architecture

```
Experience
  -> Control Plane
  -> Application Services
  -> Fleet Domain Kernel
  -> Intelligence Plane
  -> Execution Plane
  -> ZCode Runtime Kernel
  -> Infrastructure
```

### Experience

Web, mobile web, desktop, CLI/TUI, command palette, role lenses, reports, evidence views.

### Control Plane

Missions, work orders, approvals, automation, scheduling, assignments, handoffs, notifications, SLA/deadline coordination.

### Fleet Domain Kernel

Identity, tenancy, assets, observations, twins, health, security, Guardian, actions, verification, evidence, work, projects, procurement, vendors, software, maintenance, connectivity, learning.

### Intelligence Plane

System 1 detection, System 2 planning, Predictive Twin, world models, counterfactuals, recommendation, simulation, evaluation, model gateway, agent organizations.

### Execution Plane

Fleet agents, device commands, browser/computer use, MCP, plugins, provider adapters, ADCOS, Arena, Aurum, external systems.

### ZCode Runtime Kernel

Agent runtime, tool runtime, workflow runtime, session runtime, context, provider/model seams, RPC, host processes, browser/computer use.

### Infrastructure

PostgreSQL, object storage, queue/cache, search/indexes, secrets, observability, deployment.

## 3. Authority laws

### A1 — One source of business truth

PostgreSQL/domain persistence is authoritative business truth.

Redis, queues, browser state, caches, vector stores, model context, agent memory and object storage are not business truth.

### A2 — Device Twin authority

The canonical Device Twin is authoritative for managed-device durable operational state.

Predictive Twin is advisory.

### A3 — Immutable observations

Raw observations/events are immutable.

Derived diagnosis, prediction, recommendation, evaluation and adoption records are versioned.

### A4 — Consequential action protocol

Every consequential action follows:

`propose -> authorize -> confirm -> dispatch -> execute -> verify -> record -> learn`

The exact subset may collapse for low-risk non-side-effecting operations, but no consequential capability may bypass its required authority boundary.

### A5 — Guardian authority

Contract Guardian is the sole policy authority for consequential actions and capability adoption.

Agents, workflows and predictive models cannot authorize themselves.

### A6 — Agent trust boundary

Agents are untrusted actors.

They may observe, reason, propose, plan, request capabilities, execute granted capabilities and report results.

They may not:

- write domain truth directly;
- bypass authorization;
- invent observations;
- assert execution success without verification.

### A7 — Provider neutrality

Provider-specific APIs/types do not enter FleetOS domain contracts.

All providers are behind adapters or model/transport seams.

### A8 — Tenant isolation

Tenant context is established at the server/application boundary and carried through every persistence, event, queue, object, search, predictive and execution operation.

Cross-tenant reads/writes fail closed.

### A9 — No UI-owned truth

React/local UI state is presentation/session state only.

UI code never becomes a business-state owner.

### A10 — Durable missions

Missions and long-running workflows survive browser/process/request lifetime.

They must support resumability, retry, cancellation, replay and inspection.

### A11 — Predictive semantics

`OBSERVED`, `PREDICTED`, and `HYPOTHETICAL` are semantically distinct types.

A counterfactual is never an observation.

### A12 — Deterministic reference path

Every intelligence capability must have a deterministic reference implementation that works without a GPU/model provider unless the work item explicitly defines a provider requirement.

### A13 — Evidence completeness

Every consequential operation must be traceable through evidence to:

- actor;
- intent;
- authorization;
- execution;
- verification;
- capability/model version.

### A14 — Transactional event publication

Business state and durable event publication use a transactional outbox or equivalent atomic boundary.

Workers must not create dual-write correctness gaps.

### A15 — Capability vocabulary

Human UI, agents, workflows, MCP, plugins, CLI, device agents and APIs share one typed Capability vocabulary.

### A16 — Exchange semantics

Procurement is an exchange/matching problem.

Needs, demands, quotes, orders and fulfillment retain independent contract identity.

### A17 — Asset lineage

FleetOS supports typed relationships across assets, components, projects, materials, vendors, methods and failures.

Do not prematurely require a dedicated graph database; a relational model with explicit lineage is the initial authority.

### A18 — System 1 / System 2

System 1 is fast detection/triage/near-term prediction.

System 2 is deliberate diagnosis/planning/simulation/coordination.

Neither system bypasses Guardian.

### A19 — Audit

Consequential audit records are append-only, tenant-scoped, hash-verifiable and machine-readable.

### A20 — Architecture enforcement

Cycles, deep imports, ownership violations, forbidden dependency direction and cross-boundary implementation imports are mechanically rejected.

## 4. ZCode fork boundary

The fork may preserve ZCode runtime implementations while refactoring names and packaging.

The following remain substrate concerns:

- agent runtime;
- workflow runtime;
- tool runtime;
- MCP;
- plugins;
- browser/computer use;
- provider/model transport;
- RPC;
- host processes;
- desktop/web/CLI shells.

These must not own FleetOS business truth.

## 5. Required universal entities

At minimum the architecture must support:

- Tenant;
- Actor;
- Role;
- ManagedAsset;
- Device;
- DeviceTwin;
- Observation;
- Evidence;
- Finding;
- Diagnosis;
- Capability;
- Policy;
- GuardianDecision;
- Mission;
- WorkflowRun;
- ActionIntent;
- Execution;
- Verification;
- WorkItem;
- Project;
- Workload;
- ProcurementDemand;
- Vendor;
- Quote;
- Order;
- Prediction;
- WorldModelRepresentation;
- Counterfactual;
- EvaluationCase;
- CapabilityAdoption;
- AgentOrganization.

## 6. Non-goals

Do not:

- turn FleetOS into an IDE clone;
- make conversation the business database;
- make a particular LLM mandatory;
- make JEPA mandatory;
- make a specific cloud provider mandatory;
- make Kubernetes mandatory;
- make a graph database mandatory;
- make Redis authoritative;
- make a background model worker mandatory for core correctness.

## 7. Change control

Any architecture-lock change requires:

1. ADR;
2. dependency/ownership impact analysis;
3. affected work-item update;
4. regression tests;
5. explicit operator approval.

Implementation choices inside the lock remain TL authority and must be recorded when non-obvious.
