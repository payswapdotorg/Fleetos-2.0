/**
 * @fleetos/convergence — the mission-stack assembly (F231, Wave 3 TL lane).
 *
 * THE sanctioned application-composition site (AGENTS.md: "application
 * composition belongs to tl"; spec/worker-ownership.yaml: the TL owns
 * `packages/integrations/convergence/**`). This factory binds the REAL
 * implementations together at the one place the ownership law allows:
 *
 *   - `@fleetos/mission`'s `MissionRuntime` (durable mission runtime, law
 *     A10) over its own `MissionStore` + `InMemoryMissionOutbox` — the
 *     mission-owned in-memory drivers that implement the KERNEL's
 *     `TransactionalSession` and `OutboxPort` TYPEs (structurally pinned
 *     via `implements` in the mission package);
 *   - `@fleetos/control-plane`'s `CommandQueue` bound behind the mission
 *     runtime's `CommandSubmitPort` TYPE seam through the control-plane's
 *     own `queueAsSubmitPort` adapter (the F221 composition point);
 *   - the control-plane `ExecutionLedger` (hash-chained, law A19);
 *   - the KERNEL's `InMemoryKernelDriver` + `InMemoryOutbox` + the
 *     `unitOfWorkFactory` — the kernel UnitOfWork session the application
 *     layer uses for composition-level transactional writes.
 *
 * SEAM HONESTY (documented in docs/evidence/F231): `MissionRuntime`'s
 * constructor takes the CONCRETE mission-owned store/outbox types, not the
 * kernel port interfaces — so the mission stack cannot be bound to the
 * kernel's own drivers without a mission-package change. The kernel TYPE
 * pins (`implements TransactionalSession` / `implements OutboxPort`) make
 * the mission drivers structurally swappable; this composition therefore
 * binds the kernel's own driver + UnitOfWork ALONGSIDE the mission stack
 * (for application-level writes) rather than underneath it.
 *
 * Determinism laws: no Date.now, no Math.random, no timers, no network;
 * `now` is always an explicit input. All imports are from the public entry
 * points of the composed packages — never deep paths.
 */

import {
  InMemoryKernelDriver,
  InMemoryOutbox,
  ok as kernelOk,
  unitOfWorkFactory,
  type TenantId,
  type TenantKeyspace,
  type UnitOfWorkFactory,
} from "@fleetos/kernel";
import {
  CommandQueue,
  ExecutionLedger,
  queueAsSubmitPort,
  type CommandRetryPolicy,
} from "@fleetos/control-plane";
import {
  InMemoryMissionOutbox,
  MissionRuntime,
  MissionStore,
  type CommandSubmitPort,
  type OutboxRetryPolicy,
} from "@fleetos/mission";
import { driveMission, type DriveOutcome, type MissionScenario } from "./mission-drive.js";

// ---------------------------------------------------------------------------
// The kernel half of the composition
// ---------------------------------------------------------------------------

/**
 * The kernel in-memory drivers + UnitOfWork session factory, bound to the
 * SAME tenant keyspaces the sessions write into. `keyspaceFor` registers a
 * tenant's keyspace with the kernel outbox so `unitOfWork.open(ctx)` works
 * for any tenant the composition has seen.
 */
export interface MissionKernelComposition {
  readonly driver: InMemoryKernelDriver;
  readonly outbox: InMemoryOutbox;
  readonly unitOfWork: UnitOfWorkFactory;
  /** Get (creating + registering if absent) the kernel keyspace for a tenant. */
  keyspaceFor(tenantId: TenantId): TenantKeyspace;
}

function assembleKernel(): MissionKernelComposition {
  const driver = new InMemoryKernelDriver();
  const keyspaces = new Map<string, TenantKeyspace>();
  const outbox = new InMemoryOutbox({ keyspaces });
  const unitOfWork = unitOfWorkFactory({
    createSession: (tenant) => {
      // The kernel session factory has no clock — the tenant context's
      // establishedAt is the deterministic logical open time.
      keyspaces.set(String(tenant.tenantId), driver.keyspaceFor(tenant.tenantId));
      return kernelOk(driver.openSession({ tenant, now: tenant.establishedAt }));
    },
    outbox,
  });
  return {
    driver,
    outbox,
    unitOfWork,
    keyspaceFor(tenantId: TenantId): TenantKeyspace {
      const ks = driver.keyspaceFor(tenantId);
      keyspaces.set(String(tenantId), ks);
      return ks;
    },
  };
}

// ---------------------------------------------------------------------------
// The mission stack
// ---------------------------------------------------------------------------

/** The fully-wired durable mission stack produced by `assembleMissionStack`. */
export interface MissionStack {
  /** The durable mission runtime (journal + fold + checkpointed resume). */
  readonly runtime: MissionRuntime;
  /** The mission-owned committed-state store (per-tenant). */
  readonly store: MissionStore;
  /** The mission-owned outbox adapter (implements the kernel OutboxPort TYPE). */
  readonly outbox: InMemoryMissionOutbox;
  /** The control-plane command queue (tenant-scoped, idempotent, retrying). */
  readonly queue: CommandQueue;
  /** The control-plane hash-chained execution ledger. */
  readonly ledger: ExecutionLedger;
  /** The queue bound behind the mission CommandSubmitPort TYPE seam. */
  readonly commandSubmit: CommandSubmitPort;
  /** The kernel driver/outbox/UnitOfWork composition (application writes). */
  readonly kernel: MissionKernelComposition;
}

export interface MissionStackOptions {
  /** The command queue's retry policy (dead-lettering ladder). */
  readonly commandRetryPolicy?: CommandRetryPolicy;
  /** The mission outbox drain retry policy. */
  readonly outboxRetryPolicy?: OutboxRetryPolicy;
}

/**
 * Assemble the durable mission stack: MissionRuntime + CommandQueue (via
 * `queueAsSubmitPort`, the F221 TYPE-seam composition point) + ExecutionLedger
 * + the kernel in-memory drivers + UnitOfWork session factory. One factory,
 * pure deterministic wiring, no I/O.
 */
export function assembleMissionStack(options?: MissionStackOptions): MissionStack {
  const store = new MissionStore();
  const outbox = new InMemoryMissionOutbox({
    stores: store.stores,
    ...(options?.outboxRetryPolicy ? { policy: options.outboxRetryPolicy } : {}),
  });
  const queue = new CommandQueue(
    options?.commandRetryPolicy ? { policy: options.commandRetryPolicy } : undefined,
  );
  const commandSubmit = queueAsSubmitPort(queue);
  const runtime = new MissionRuntime({ store, outbox, commandSubmit });
  const ledger = new ExecutionLedger();
  return {
    runtime,
    store,
    outbox,
    queue,
    ledger,
    commandSubmit,
    kernel: assembleKernel(),
  };
}

// The deterministic drive helper lives in ./mission-drive.ts (lint-law
// split); it is re-exported here so `./mission-assembly` carries the full
// assembly surface the packet specifies.
export { driveMission, type DriveOutcome, type MissionScenario };
