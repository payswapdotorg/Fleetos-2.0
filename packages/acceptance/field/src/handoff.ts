/**
 * @fleetos/acceptance-field — the cross-role handoff carrier.
 *
 * The value one journey (persona A) hands to the NEXT journey (persona B):
 * a digest-covered summary of the state A produced through REAL domain APIs,
 * which B's `handoff.consume` operation verifies against its own view of
 * the SAME caller-threaded context. The carrier is inert data — it never
 * executes; it carries the chain-of-custody digest B must verify.
 *
 * Pure deterministic TS; logical `now` only.
 */

import { digestOf } from "./determinism.js";

export type HandoffRole = "field-technician" | "fleet-operator";

export interface HandoffSummary {
  readonly findings: number;
  readonly openCaseIds: readonly string[];
  readonly deviceIds: readonly string[];
  readonly intentIdempotencyKey: string;
  readonly intentDigest: string;
  readonly fieldViewDigest: string;
}

export interface HandoffCarrier {
  readonly handoffId: string;
  readonly fromRole: HandoffRole;
  readonly toRole: HandoffRole;
  readonly tenantId: string;
  readonly producedAt: number;
  readonly summary: HandoffSummary;
  readonly digest: string;
}

function handoffDigestOf(carrier: Omit<HandoffCarrier, "digest">): string {
  return digestOf("handoff-carrier", carrier as unknown as object);
}

/** Build the carrier (the publishing journey's final REAL step output). */
export function makeHandoffCarrier(input: Omit<HandoffCarrier, "digest">): HandoffCarrier {
  return { ...input, digest: handoffDigestOf(input) };
}

/** Tamper-evident verification of a carrier's own digest. */
export function verifyHandoffCarrier(carrier: HandoffCarrier): boolean {
  const { digest, ...rest } = carrier;
  return handoffDigestOf(rest) === digest;
}
