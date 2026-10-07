/**
 * @fleetos/recovery — Wave 0 contracts.
 *
 * Pure TypeScript domain contracts ONLY. No I/O, no servers, no databases.
 *
 * Owns (per spec/BOUNDED-CONTEXTS.md "Maintenance & Recovery"):
 *   - lost-device cases;
 *   - recovery transitions;
 *   - replacement proposals;
 *   - evidence references.
 *
 * State machine: open -> investigating -> proposal -> resolved|closed.
 * Illegal moves are REFUSED with machine-stable reason codes.
 *
 * Cross-worker seam: defines `EvidenceRefLike` locally (structurally
 * compatible with @fleetos/evidence's eventual shape — converged at F201).
 */

// ---------------------------------------------------------------------------
// Structural seam types
// ---------------------------------------------------------------------------

export type TenantIdLike = string;
export type DeviceIdLike = string;

export interface EvidenceRefLike {
  readonly digest: string;
  readonly kind?: string;
  readonly observedAt?: number;
}

// ---------------------------------------------------------------------------
// Branded ids
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };
export type RecoveryCaseId = Brand<string, "RecoveryCaseId">;

const RECOVERY_ID_RE = /^rc_[A-Za-z0-9_-]{6,128}$/;
export const isRecoveryCaseId = (v: string): v is RecoveryCaseId =>
  typeof v === "string" && RECOVERY_ID_RE.test(v);

// ---------------------------------------------------------------------------
// RecoveryCase
// ---------------------------------------------------------------------------

export type RecoveryState =
  | "open"
  | "investigating"
  | "proposal"
  | "resolved"
  | "closed";

export type RecoveryCommandKind =
  | "investigate"
  | "propose"
  | "resolve"
  | "close"
  | "reopen";

export interface RecoveryCommand {
  readonly kind: RecoveryCommandKind;
  readonly reason?: string;
  readonly evidence?: ReadonlyArray<EvidenceRefLike>;
  readonly initiatedAt: number;
}

export type RecoveryRejectionCode =
  | "illegal-transition"
  | "missing-evidence"
  | "missing-reason"
  | "already-resolved"
  | "already-closed"
  | "unknown-command";

export type RecoveryTransitionResult =
  | { readonly ok: true; readonly from: RecoveryState; readonly to: RecoveryState }
  | { readonly ok: false; readonly reason: RecoveryRejectionCode };

// Pure transition table.
const TRANSITIONS: Readonly<Record<
  RecoveryState,
  Partial<Record<RecoveryCommandKind, RecoveryState>>
>> = {
  open: { investigate: "investigating" },
  investigating: { propose: "proposal", close: "closed" },
  proposal: { resolve: "resolved", close: "closed", investigate: "investigating" },
  resolved: { close: "closed", reopen: "open" },
  closed: { reopen: "open" },
};

export function evaluateRecoveryTransition(
  current: RecoveryState,
  command: RecoveryCommand,
): RecoveryTransitionResult {
  const known: ReadonlyArray<RecoveryCommandKind> = [
    "investigate",
    "propose",
    "resolve",
    "close",
    "reopen",
  ];
  if (!known.includes(command.kind)) {
    return { ok: false, reason: "unknown-command" };
  }

  // Resolve requires evidence (A13 evidence completeness for consequential action).
  if (command.kind === "resolve") {
    if (!command.evidence || command.evidence.length === 0) {
      return { ok: false, reason: "missing-evidence" };
    }
  }

  // Reopen requires a reason (audit trail).
  if (command.kind === "reopen" && (command.reason === undefined || command.reason === "")) {
    return { ok: false, reason: "missing-reason" };
  }

  const next = TRANSITIONS[current]?.[command.kind];
  if (next === undefined) {
    if (current === "resolved" && command.kind === "resolve") {
      return { ok: false, reason: "already-resolved" };
    }
    if (current === "closed" && command.kind === "close") {
      return { ok: false, reason: "already-closed" };
    }
    return { ok: false, reason: "illegal-transition" };
  }
  return { ok: true, from: current, to: next };
}

// ---------------------------------------------------------------------------
// RecoveryCase aggregate — pure value object holding case state + evidence.
// ---------------------------------------------------------------------------

export interface RecoveryCase {
  readonly id: RecoveryCaseId;
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly state: RecoveryState;
  readonly openedAt: number;
  readonly evidence: ReadonlyArray<EvidenceRefLike>;
  readonly history: ReadonlyArray<RecoveryHistoryEntry>;
  readonly resolution?: { readonly rootCause: string; readonly resolvedAt: number };
}

export interface RecoveryHistoryEntry {
  readonly from: RecoveryState;
  readonly to: RecoveryState;
  readonly command: RecoveryCommandKind;
  readonly at: number;
  readonly reason?: string;
}

export function openRecoveryCase(input: {
  readonly id: RecoveryCaseId;
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly openedAt: number;
}): RecoveryCase {
  if (typeof input.id !== "string" || !isRecoveryCaseId(input.id)) {
    throw new TypeError("openRecoveryCase: malformed RecoveryCaseId");
  }
  if (input.tenantId === "") throw new TypeError("openRecoveryCase: missing tenantId");
  if (input.deviceId === "") throw new TypeError("openRecoveryCase: missing deviceId");
  return {
    id: input.id,
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    state: "open",
    openedAt: input.openedAt,
    evidence: [],
    history: [],
  };
}

export function applyRecoveryCommand(
  rc: RecoveryCase,
  command: RecoveryCommand,
): { readonly ok: true; readonly case: RecoveryCase } | { readonly ok: false; readonly reason: RecoveryRejectionCode } {
  const result = evaluateRecoveryTransition(rc.state, command);
  if (!result.ok) return result;
  const entry: RecoveryHistoryEntry = {
    from: result.from,
    to: result.to,
    command: command.kind,
    at: command.initiatedAt,
    reason: command.reason,
  };
  const next: RecoveryCase = {
    ...rc,
    state: result.to,
    evidence:
      command.evidence && command.evidence.length > 0
        ? [...rc.evidence, ...command.evidence]
        : rc.evidence,
    history: [...rc.history, entry],
    resolution:
      command.kind === "resolve"
        ? { rootCause: command.reason ?? "unspecified", resolvedAt: command.initiatedAt }
        : rc.resolution,
  };
  return { ok: true, case: next };
}
