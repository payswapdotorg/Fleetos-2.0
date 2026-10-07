# FleetOS 2.0 Upstream Baseline

## Fork source

- Upstream: https://github.com/zai-org/ZCode
- Upstream release observed: ZCode v3.14.3
- Fork: payswapdotorg/Fleetos-2.0

## Purpose

This file records the inherited baseline. It is not a product roadmap.
The inherited source provides the runtime substrate. FleetOS implementation begins at Wave 0.

## Preserve initially

- pnpm workspace/tooling;
- runtime build machinery;
- Agent CLI/runtime;
- workflow runtime;
- MCP/plugin support;
- provider/model transport;
- browser/computer-use tooling;
- RPC;
- desktop/web host mechanics;
- architecture-check infrastructure;
- third-party/license notices.

## Converge deliberately

- package naming;
- product identity;
- contract systems;
- provider abstractions;
- workflow abstractions;
- tool registries;
- shared type systems;
- environment variables;
- user/session concepts that are ZCode-specific;
- UI language and navigation.

## Upstream update rule

Never update the fork by blindly replacing FleetOS code with upstream.
Every upstream import must be isolated, reviewed, architecture-checked, tested and accepted through the repository decision protocol.