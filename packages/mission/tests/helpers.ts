/**
 * @fleetos/mission — test helpers.
 *
 * The deterministic test stack: a MissionStore + InMemoryMissionOutbox
 * (over the same committed stores) + a RecordingCommandSubmitPort that
 * models the control-plane queue contract (idempotency-key dedupe with
 * duplicate flags, optional scripted rejections for the rollback tests).
 */

import type { ActorId, SessionId, TenantContext, TenantId } from "@fleetos/kernel";
import {
  InMemoryMissionOutbox,
  MissionStore,
  type OutboxRetryPolicy,
} from "../src/outbox.js";
import type { CommandSubmitPort, GuardEvaluator } from "../src/runtime.js";
import { fail, ok, type Result } from "../src/result.js";
import type { MissionDefinition } from "../src/definition.js";

export const NOW = 1_727_000_000_000;
export const TENANT_A = "tnt_acme-corp-001";
export const TENANT_B = "tnt_globex-002";

export function ctxFor(tenant: string): TenantContext {
  return {
    tenantId: tenant as TenantId,
    actorId: "act_alice-001" as ActorId,
    sessionId: "sess_abcdef0123456789" as SessionId,
    establishedAt: NOW,
    scope: "tenant",
  };
}

export interface SubmitCall {
  readonly kind: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly duplicate: boolean;
  readonly commandId: string;
}

export class RecordingCommandSubmitPort implements CommandSubmitPort {
  readonly calls: SubmitCall[] = [];
  readonly issued = new Map<string, string>();
  private counter = 0;
  private readonly failKeys: ReadonlySet<string>;

  constructor(options?: { readonly failKeys?: ReadonlySet<string> }) {
    this.failKeys = options?.failKeys ?? new Set<string>();
  }

  submit(input: {
    readonly ctx: TenantContext;
    readonly command: {
      readonly kind: string;
      readonly payload: unknown;
      readonly idempotencyKey: string;
      readonly issuedAt: number;
    };
  }): Result<{ readonly commandId: string; readonly duplicate: boolean }, string> {
    if (this.failKeys.has(input.command.idempotencyKey)) {
      return fail("queue-unavailable");
    }
    const existing = this.issued.get(input.command.idempotencyKey);
    const duplicate = existing !== undefined;
    const commandId =
      existing ??
      (this.counter += 1, `cmd_fake_${String(this.counter).padStart(6, "0")}`);
    if (!duplicate) this.issued.set(input.command.idempotencyKey, commandId);
    this.calls.push({
      kind: input.command.kind,
      payload: input.command.payload,
      idempotencyKey: input.command.idempotencyKey,
      issuedAt: input.command.issuedAt,
      duplicate,
      commandId,
    });
    return ok({ commandId, duplicate });
  }

  distinctSubmits(): number {
    return this.issued.size;
  }

  submitsFor(key: string): number {
    return this.calls.filter((c) => c.idempotencyKey === key).length;
  }
}

export function makeStack(options?: {
  readonly failKeys?: ReadonlySet<string>;
  readonly guards?: GuardEvaluator;
  readonly outboxPolicy?: OutboxRetryPolicy;
}): {
  readonly store: MissionStore;
  readonly outbox: InMemoryMissionOutbox;
  readonly port: RecordingCommandSubmitPort;
} {
  const store = new MissionStore();
  const outbox = new InMemoryMissionOutbox({
    stores: store.stores,
    policy: options?.outboxPolicy,
  });
  const port = new RecordingCommandSubmitPort({ failKeys: options?.failKeys });
  return { store, outbox, port };
}

export const SEQUENTIAL_DEF: MissionDefinition = {
  id: "def-sequential",
  stages: [
    { id: "ingest" },
    { id: "analyze", dependsOn: ["ingest"] },
    { id: "report", dependsOn: ["analyze"] },
  ],
};

export const PARALLEL_DEF: MissionDefinition = {
  id: "def-parallel",
  stages: [
    { id: "fetch-a", parallelGroup: "fetch" },
    { id: "fetch-b", parallelGroup: "fetch" },
    { id: "fetch-c", parallelGroup: "fetch" },
    { id: "merge", dependsOn: ["fetch-a", "fetch-b", "fetch-c"] },
  ],
};

export const GUARDED_DEF: MissionDefinition = {
  id: "def-guarded",
  stages: [
    {
      id: "ingest",
      guards: [{ kind: "capability", ref: "ingest:run" }],
    },
    {
      id: "analyze",
      guards: [
        { kind: "capability", ref: "analyze:run" },
        { kind: "predicate", ref: "data-ready" },
      ],
      dependsOn: ["ingest"],
    },
  ],
};
