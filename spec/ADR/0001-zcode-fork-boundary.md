# ADR-0001 — ZCode Fork Boundary

## Status

ACCEPTED

## Context

FleetOS 2.0 starts from the Z.AI ZCode v3.14.3 repository.

ZCode already provides valuable infrastructure:

- agent runtime;
- workflow runtime;
- tool system;
- MCP;
- plugin host;
- browser/computer use;
- model/provider transport;
- RPC;
- desktop/web/CLI hosts;
- architecture governance;
- packaging/runtime distribution.

The clean restart must combine these strengths without allowing the inherited coding-workspace product model or implementation packages to become FleetOS domain authorities.

## Decision

ZCode becomes the FleetOS Runtime Kernel.
FleetOS domain, control-plane and intelligence contexts are implemented above it.

The boundary is:

FleetOS Experience
  -> FleetOS Control Plane
  -> FleetOS Domain Kernel
  -> FleetOS Intelligence
  -> FleetOS Execution
  -> ZCode Runtime Kernel
  -> Infrastructure

ZCode runtime packages provide mechanisms.
FleetOS packages own semantics.

## ZCode substrate responsibilities

ZCode-originated code may own:
- process/session mechanics;
- agent execution;
- tools;
- workflow execution mechanics;
- model transport;
- provider invocation;
- browser/computer use;
- MCP/plugin loading;
- RPC;
- host lifecycle;
- generic UI primitives.

## FleetOS responsibilities

FleetOS owns:
- tenant/actor identity;
- managed assets;
- Device Twin;
- observations;
- health;
- security;
- Guardian;
- actions and verification;
- evidence;
- work/projects;
- procurement/vendors/software;
- connectivity intent;
- Predictive Twin;
- world models;
- learning/adoption;
- agent organizations;
- mission semantics.

## Forbidden leakage

ZCode substrate must not become the source of truth for FleetOS devices, observations, approvals, policies, procurement, actions, predictions, missions, evidence or tenant/domain records.

FleetOS domain packages must not depend on ZCode product concepts such as coding tasks, IDE projects, coding conversations or coding-specific UI state.

## Compatibility rule

Existing ZCode capabilities are reused through stable public contracts and adapters.
Where an inherited package cannot satisfy the FleetOS boundary without semantic leakage, wrap or refactor it rather than importing implementation details into FleetOS domain packages.

## Upstream synchronization

Upstream ZCode changes are imported selectively.
Every import is evaluated for behavior, license/notice changes, dependency graph changes, security impact, architecture impact and FleetOS runtime compatibility.

## Acceptance

This ADR is satisfied when FleetOS domain packages do not import ZCode implementation details, runtime capabilities remain reusable, architecture checks encode the boundary, the graph is acyclic, and end-to-end FleetOS missions execute through the runtime without giving runtime code domain authority.