/**
 * infrastructure/fleetos-marketplace/api.ts — the service context, the
 * shared HTTP plumbing and the response convention (F370C, Wave 18 lane C).
 *
 * The response convention (the F370A composed-result law, verbatim):
 *   200 {ok: true, authorization, result}                     — authorized + the kernel result
 *   200 {ok: false, refusedBy: "domain", domainRefusal}      — the kernel's own refusal AS DATA
 *   401 {ok: false, refusedBy: "boundary", refusal}          — the F370B stack refused (UNAUTHENTICATED / SESSION_EXPIRED)
 *   401/403/400 {ok: false, refusedBy: "gate", refusal}      — the F370A gate's frozen reason codes
 *   404 {ok: false, refusedBy: "boundary", refusal: NOT_FOUND} — an id-addressed resource absent from the caller's scope
 *
 * Domain refusals are DATA in 200 responses — the kernels' reason codes
 * propagate verbatim, never re-mapped (the F362 spine convention).
 */

import type { IncomingMessage } from "node:http";
import type { AssetDirectory, ReceiptEnrollmentDirectory } from "@fleetos/assets";
import type { KeyringProvider, MarketplaceAuthorization, SessionRevocationRegistry, SessionSigningKey } from "@fleetos/identity";
import { authorizeMarketplaceAction } from "@fleetos/identity";
import type { MarketplaceEvidenceStorePort } from "@fleetos/evidence";
import type { MarketplaceStore } from "./store.js";
import type { BoundaryAuthResult } from "./auth.js";
import { authenticateAtBoundary } from "./auth.js";
import type { PgRegistryPorts } from "./ports.js";

export type Json = Record<string, unknown>;

/** The minimal request shape the auth helpers need (structurally satisfied
 *  by node's IncomingMessage). */
export interface RequestLike {
  readonly headers: Record<string, string | string[] | undefined>;
}

/** The evidence kind → the consuming verb's action kind (the fixed map:
 *  evidence retention/read is authorized under the verb that consumes it). */
export const EVIDENCE_KIND_ACTION: Readonly<Record<string, string>> = {
  "marketplace.offer-snapshot": "approval",
  "marketplace.provider-ack": "ack",
  "marketplace.fulfilment": "order",
  "marketplace.receipt": "receipt",
};

/** The state family → the action kind that authorizes reading it ("*" =
 *  the audit operator view — ALL EIGHT verb scopes required). */
export const STATE_FAMILY_ACTION: Readonly<Record<string, string>> = {
  requests: "request", offers: "offer", comparisonSheets: "comparison", orders: "order",
  providerAcks: "ack", receipts: "receipt", enrollments: "enrollment", approvals: "approval",
  assets: "enrollment", twins: "enrollment", audit: "*",
};

export interface ServiceContext {
  readonly store: MarketplaceStore;
  readonly ports: PgRegistryPorts;
  readonly directory: ReceiptEnrollmentDirectory;
  readonly assets: AssetDirectory;
  readonly evidenceStore: MarketplaceEvidenceStorePort;
  readonly provider: KeyringProvider;
  readonly registry: SessionRevocationRegistry;
  readonly verifyReport: {
    readonly ok: boolean;
    readonly receiptsReplayed: number;
    readonly revocationsReplayed: number;
    readonly recordsLoaded: number;
  };
  /** Authenticate one request through the F370B stack (auth.ts). */
  authenticate(input: { readonly token: string | null; readonly now: number }): BoundaryAuthResult;
  /** The F370A gate, composed directly (for operations F370A's composed
   *  verbs do not wrap). The REAL public API, never re-implemented. */
  gate(input: { readonly token: string; readonly key: SessionSigningKey; readonly now: number }, action: { readonly kind: string; readonly tenantId: string }): MarketplaceAuthorization;
}

export function makeContext(base: Omit<ServiceContext, "authenticate" | "gate">): ServiceContext {
  return {
    ...base,
    authenticate: (input) => authenticateAtBoundary({ ...input, provider: base.provider, registry: base.registry }),
    gate: (input, action) =>
      authorizeMarketplaceAction({
        token: input.token,
        action: { kind: action.kind as Parameters<typeof authorizeMarketplaceAction>[0]["action"]["kind"], tenantId: action.tenantId },
        key: input.key,
        now: input.now,
      }),
  };
}

// --- plumbing ---------------------------------------------------------------

export function bearerTokenOf(req: RequestLike): string | null {
  const header = req.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  return token.length === 0 ? null : token;
}

export async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    req.on("data", (c: Buffer) => {
      chunks.push(c);
      size += c.length;
      if (size > 2_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve());
    req.on("error", reject);
  });
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as unknown;
    return parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ? {} : (parsed as Json);
  } catch {
    return {};
  }
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A numeric query parameter (always a string on the wire — the GET
 *  handlers' logical clock + ids). */
export function numParam(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ApiOutcome {
  readonly status: number;
  readonly body: unknown;
}

export function boundaryRefusal(refusal: { readonly reason: string; readonly detail: string }): ApiOutcome {
  return { status: 401, body: { ok: false, refusedBy: "boundary", refusal } };
}

export function gateRefusal(refusal: { readonly reason: string }): ApiOutcome {
  const status = refusal.reason === "MALFORMED" ? 400 : 401;
  return { status, body: { ok: false, refusedBy: "gate", refusal } };
}

export function notFound(what: string): ApiOutcome {
  return { status: 404, body: { ok: false, refusedBy: "boundary", refusal: { reason: "NOT_FOUND", detail: `no such ${what} in the caller's tenant scope` } } };
}

export function domainRefusal(domainRefusal: unknown): ApiOutcome {
  return { status: 200, body: { ok: false, refusedBy: "domain", domainRefusal } };
}

export function okResult(authorization: unknown, result: unknown): ApiOutcome {
  return { status: 200, body: { ok: true, authorization, result } };
}

export function badRequest(detail: string): ApiOutcome {
  return { status: 400, body: { ok: false, refusedBy: "boundary", refusal: { reason: "BAD_REQUEST", detail } } };
}

export function forbidden(detail: string): ApiOutcome {
  return { status: 403, body: { ok: false, refusedBy: "boundary", refusal: { reason: "FORBIDDEN", detail } } };
}

/** The inner kernel payload of a composed ok result. The F370A gate
 *  helper's domainOk law guarantees the inner kernel result is its ok
 *  branch whenever the composed result is ok (the approval is exempted —
 *  its decision is data); this helper carries that guarantee to TS. */
export function innerOk<R>(composed: { readonly ok: true; readonly result: R }): R & { readonly ok: true } {
  return composed.result as R & { readonly ok: true };
}

/** The refusal payload of a composed refusal (the gate's RefusedAction or
 *  the kernel's own refusal — reason codes never re-mapped). */
export function refusalOf(composed: { readonly refusedBy: string; readonly refusal?: unknown; readonly domainRefusal?: unknown }): unknown {
  return composed.refusedBy === "gate" ? composed.refusal : composed.domainRefusal;
}

/** The machine-stable refusal code of any refusal payload (audit detail). */
export function refusalCode(value: unknown): string {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["reasonCode"] === "string") return record["reasonCode"];
    if (typeof record["reason"] === "string") return record["reason"];
  }
  return "refused";
}
