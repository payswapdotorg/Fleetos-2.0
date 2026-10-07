/**
 * @fleetos/mission — runtime contracts (law A10).
 *
 * The TYPE seams and vocabulary the durable mission runtime composes
 * against: the `CommandSubmitPort` (the control-plane command queue
 * CONTRACT as a type seam — structurally satisfied by the control-plane
 * `CommandQueue.submit`; mission never imports control-plane at
 * runtime, the TL binds the concrete queue here), the `GuardEvaluator`,
 * the machine-stable rejection strings, and the shared operation
 * result.
 *
 * TYPE imports only from `@fleetos/kernel`. No runtime imports from any
 * @fleetos/* package.
 */

import type { TenantContext } from "@fleetos/kernel";
import type { Result } from "./result.js";
import type { GuardRef } from "./definition.js";
import type { MissionView } from "./journal.js";

// ---------------------------------------------------------------------------
// The type seams (composition by the TL).
// ---------------------------------------------------------------------------

export interface CommandSubmitAck {
  readonly commandId: string;
  /** True when the receiving queue deduped the idempotency key (no re-execution). */
  readonly duplicate: boolean;
}

/**
 * The control-plane command queue CONTRACT as a type seam — structurally
 * satisfied by the control-plane `CommandQueue.submit` (compile-pinned in
 * the control-plane test suite). Mission never imports control-plane at
 * runtime; the TL binds the concrete queue here.
 */
export interface CommandSubmitPort {
  submit(input: {
    readonly ctx: TenantContext;
    readonly command: {
      readonly kind: string;
      readonly payload: unknown;
      readonly idempotencyKey: string;
      readonly issuedAt: number;
    };
  }): Result<CommandSubmitAck, string>;
}

export interface GuardEvaluator {
  evaluate(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly stageId: string;
    readonly guard: GuardRef;
  }): boolean;
}

export const ALLOW_ALL_GUARDS: GuardEvaluator = {
  evaluate: () => true,
};

// ---------------------------------------------------------------------------
// Rejections + results
// ---------------------------------------------------------------------------

export type MissionRuntimeRejection =
  | "invalid-input"
  | "invalid-definition"
  | "mission-not-found" // includes cross-tenant access (fail closed)
  | "mission-exists"
  | "illegal-transition"
  | "not-suspended"
  | "unknown-stage"
  | "stage-not-running"
  | "guard-rejected"
  | "command-submit-rejected"
  | "outbox-rejected"
  | "commit-failed";

export interface MissionOpResult {
  readonly view: MissionView;
  readonly duplicate: boolean;
}
