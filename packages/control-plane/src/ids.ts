/**
 * @fleetos/control-plane — branded command ids.
 *
 * `CommandId` is a branded string so a raw string is not assignable where a
 * queue-issued command id is required. The canonical format is
 * `cmd_<10+ chars of [A-Za-z0-9_-]>` — the queue generates
 * `cmd_0000000001`-style monotonic ids; callers may supply their own
 * well-formed ids.
 */

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type CommandId = Brand<string, "CommandId">;

const COMMAND_ID_PATTERN = /^cmd_[A-Za-z0-9_-]{4,128}$/;

export function isCommandId(value: string): value is CommandId {
  return typeof value === "string" && COMMAND_ID_PATTERN.test(value);
}

/** Brands a validated string as a CommandId. Assumes the caller validated. */
export function asCommandId(value: string): CommandId {
  return value as CommandId;
}
