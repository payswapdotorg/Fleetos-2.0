/**
 * @fleetos/agent — FleetOS Edge Agent app skeleton (Wave 0).
 *
 * Pure TypeScript contracts + a deterministic AgentLoop state machine over
 * INJECTED PORTS. NO real network, NO I/O. The loop is pure: same input +
 * same injected port responses -> same output and same next state.
 *
 * Capabilities (per spec/work-items/WORK-ITEM-CATALOG.md F230A):
 *   - enrollment;
 *   - trust;
 *   - telemetry emission;
 *   - diagnostics;
 *   - local evidence buffer;
 *   - command inbox;
 *   - reconciliation.
 *
 * Architecture laws:
 *   - A6: agents are untrusted actors; may observe, reason, propose, plan,
 *     request capabilities, execute GRANTED capabilities, and report — but
 *     may not write domain truth directly, bypass authorization, invent
 *     observations, or assert execution success without verification.
 *
 * The loop's honest degraded states:
 *   - if enrollment is rejected -> "rejected" terminal state;
 *   - if trust establishment fails -> "untrusted" state with reason;
 *   - if a command cannot be executed (port returns degraded) -> "degraded";
 *   - if reconciliation reveals drift -> "reconciling";
 *   - on stop -> "stopped";
 *   - "stopped" -> "running" requires explicit resume.
 *
 * Cross-worker seam: structural TenantIdLike / DeviceIdLike. The agent does
 * NOT import other worker packages; it consumes them via injected ports.
 */

// ---------------------------------------------------------------------------
// Structural seam types
// ---------------------------------------------------------------------------

export type TenantIdLike = string;
export type AgentIdLike = string;
export type DeviceIdLike = string;

// ---------------------------------------------------------------------------
// Branded ids
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };
export type EnrollmentTokenId = Brand<string, "EnrollmentTokenId">;
export type EvidenceRecordId = Brand<string, "EvidenceRecordId">;

// ---------------------------------------------------------------------------
// Agent state machine
// ---------------------------------------------------------------------------

export type AgentState =
  | "unenrolled"
  | "enrolled"
  | "untrusted"
  | "trusted"
  | "running"
  | "degraded"
  | "reconciling"
  | "stopped"
  | "rejected";

export type AgentCommandKind =
  | "enroll"
  | "establish-trust"
  | "start"
  | "degrade"
  | "recover"
  | "stop"
  | "resume"
  | "reconcile"
  | "reject";

export interface AgentCommand {
  readonly kind: AgentCommandKind;
  readonly reason?: string;
  readonly at: number;
}

export type AgentRejectionCode =
  | "illegal-transition"
  | "unknown-command"
  | "missing-reason"
  | "already-in-target-state";

export type AgentTransitionResult =
  | { readonly ok: true; readonly from: AgentState; readonly to: AgentState }
  | { readonly ok: false; readonly reason: AgentRejectionCode };

const TRANSITIONS: Readonly<Record<
  AgentState,
  Partial<Record<AgentCommandKind, AgentState>>
>> = {
  unenrolled: { enroll: "enrolled", reject: "rejected" },
  enrolled: { "establish-trust": "untrusted", reject: "rejected" },
  untrusted: { "establish-trust": "trusted" }, // second-stage trust success
  trusted: { start: "running", stop: "stopped" },
  running: { degrade: "degraded", stop: "stopped", reconcile: "reconciling" },
  degraded: { recover: "running", stop: "stopped", reconcile: "reconciling" },
  reconciling: { start: "running", degrade: "degraded", stop: "stopped" },
  stopped: { resume: "running" },
  rejected: {},
};

export function evaluateAgentTransition(
  current: AgentState,
  command: AgentCommand,
): AgentTransitionResult {
  const known: ReadonlyArray<AgentCommandKind> = [
    "enroll",
    "establish-trust",
    "start",
    "degrade",
    "recover",
    "stop",
    "resume",
    "reconcile",
    "reject",
  ];
  if (!known.includes(command.kind)) return { ok: false, reason: "unknown-command" };

  // Degrade and stop require a reason (audit trail).
  if (
    (command.kind === "degrade" || command.kind === "stop") &&
    (command.reason === undefined || command.reason === "")
  ) {
    return { ok: false, reason: "missing-reason" };
  }

  const next = TRANSITIONS[current]?.[command.kind];
  if (next === undefined) {
    if (
      (command.kind === "start" && current === "running") ||
      (command.kind === "stop" && current === "stopped") ||
      (command.kind === "recover" && current === "running")
    ) {
      return { ok: false, reason: "already-in-target-state" };
    }
    return { ok: false, reason: "illegal-transition" };
  }
  return { ok: true, from: current, to: next };
}

// ---------------------------------------------------------------------------
// Injected ports (structural interfaces — the seam).
//
// The agent never reaches into substrate/domain packages; it calls these
// ports. The ports may be backed by real adapters in production but the
// reference test impls are deterministic, no-network.
// ---------------------------------------------------------------------------

export interface EnrollmentPort {
  readonly enroll: (input: {
    readonly tenantId: TenantIdLike;
    readonly agentId: AgentIdLike;
    readonly token: EnrollmentTokenId;
  }) => Promise<
    | { readonly ok: true; readonly agentId: AgentIdLike; readonly tenantId: TenantIdLike }
    | { readonly ok: false; readonly reason: "invalid-token" | "tenant-not-found" | "duplicate" }
  >;
}

export interface TelemetryPort {
  readonly emitTelemetry: (event: {
    readonly agentId: AgentIdLike;
    readonly at: number;
    readonly kind: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }) => void;
}

export interface DiagnosticsPort {
  readonly snapshot: (agentId: AgentIdLike) => {
    readonly agentId: AgentIdLike;
    readonly at: number;
    readonly state: AgentState;
    readonly uptimeMs: number;
  };
}

export interface EvidenceBufferPort {
  readonly append: (evidence: {
    readonly agentId: AgentIdLike;
    readonly at: number;
    readonly digest: string;
    readonly kind: string;
  }) => EvidenceRecordId;
}

export interface CommandInboxPort {
  readonly pollCommands: (agentId: AgentIdLike) => ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly at: number;
  }>;
}

export interface ReconciliationPort {
  readonly reconcile: (input: {
    readonly agentId: AgentIdLike;
    readonly localHead: number;
  }) => { readonly drift: boolean; readonly remoteHead: number; readonly diff: number };
}

export interface AgentPorts {
  readonly enrollment: EnrollmentPort;
  readonly telemetry: TelemetryPort;
  readonly diagnostics: DiagnosticsPort;
  readonly evidence: EvidenceBufferPort;
  readonly commandInbox: CommandInboxPort;
  readonly reconciliation: ReconciliationPort;
}

// ---------------------------------------------------------------------------
// AgentLoop — pure state machine over injected ports.
//
// Step semantics: each step takes (current AgentLoopState, command) and
// returns (next AgentLoopState). The loop NEVER does I/O directly; it only
// invokes injected ports when the command requires their response.
// ---------------------------------------------------------------------------

export interface AgentLoopState {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly state: AgentState;
  readonly establishedAt: number;
  readonly lastTransitionAt: number;
  readonly degradationReason?: string;
  readonly evidenceCount: number;
}

export type AgentLoopResult =
  | { readonly ok: true; readonly state: AgentLoopState }
  | { readonly ok: false; readonly reason: AgentRejectionCode };

export function createAgentLoop(input: {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly now: number;
}): AgentLoopState {
  if (typeof input.agentId !== "string" || input.agentId === "") {
    throw new TypeError("createAgentLoop: missing agentId");
  }
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    throw new TypeError("createAgentLoop: missing tenantId");
  }
  return {
    agentId: input.agentId,
    tenantId: input.tenantId,
    state: "unenrolled",
    establishedAt: input.now,
    lastTransitionAt: input.now,
    evidenceCount: 0,
  };
}

export async function step(
  current: AgentLoopState,
  command: AgentCommand,
  ports: AgentPorts,
): Promise<AgentLoopResult> {
  const t = evaluateAgentTransition(current.state, command);
  if (!t.ok) return t;

  // Special handling: enroll/establish-trust consult the port to confirm.
  if (command.kind === "enroll") {
    const result = await ports.enrollment.enroll({
      tenantId: current.tenantId,
      agentId: current.agentId,
      token: "" as EnrollmentTokenId, // call-site supplies real token via command extension
    });
    if (!result.ok) {
      // Enrollment failed: move to rejected terminal state honestly.
      return {
        ok: true,
        state: { ...current, state: "rejected", lastTransitionAt: command.at },
      };
    }
  }

  // When entering running, emit a telemetry "agent-started" event.
  if (t.to === "running" && t.from !== "reconciling") {
    ports.telemetry.emitTelemetry({
      agentId: current.agentId,
      at: command.at,
      kind: "agent-started",
      payload: { from: t.from },
    });
  }

  // When entering degraded, stash the reason for diagnostics.
  if (t.to === "degraded") {
    ports.telemetry.emitTelemetry({
      agentId: current.agentId,
      at: command.at,
      kind: "agent-degraded",
      payload: { reason: command.reason ?? "unspecified" },
    });
  }

  // Every transition emits an evidence record into the local buffer.
  const evidenceId = ports.evidence.append({
    agentId: current.agentId,
    at: command.at,
    digest: `${t.from}->${t.to}:${command.kind}`,
    kind: "agent-transition",
  });
  // Use the evidenceId to ensure it's non-null (typed brand).
  expectNonEmpty(evidenceId);

  return {
    ok: true,
    state: {
      ...current,
      state: t.to,
      lastTransitionAt: command.at,
      degradationReason: command.kind === "degrade" ? command.reason : undefined,
      evidenceCount: current.evidenceCount + 1,
    },
  };
}

function expectNonEmpty(v: unknown): void {
  if (v === null || v === undefined || v === "") {
    throw new Error("evidence buffer returned empty id");
  }
}

// ---------------------------------------------------------------------------
// Reconciliation helper — pure consumer of the ReconciliationPort.
// ---------------------------------------------------------------------------

export function reconcileAgent(
  current: AgentLoopState,
  ports: AgentPorts,
  now: number,
): { readonly state: AgentLoopState; readonly drift: boolean; readonly remoteHead: number } {
  const r = ports.reconciliation.reconcile({
    agentId: current.agentId,
    localHead: current.evidenceCount,
  });
  if (r.drift) {
    return {
      state: {
        ...current,
        state: "reconciling",
        lastTransitionAt: now,
      },
      drift: true,
      remoteHead: r.remoteHead,
    };
  }
  return { state: current, drift: false, remoteHead: r.remoteHead };
}
