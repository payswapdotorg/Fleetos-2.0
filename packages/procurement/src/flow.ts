/**
 * @fleetos/procurement — The procure-to-receive FLOW: Need → Demand →
 * Quote → Order → Fulfillment with approval gates at Demand→Quote
 * (solicitation) and Quote→Order (award), plus idempotent document
 * creation (client-supplied request ids).
 *
 * Wave 2 lane C (F220C) operational-truth grade.
 *
 * Laws: A4 (approval gates at consequential boundaries), A5 (procurement
 * NEVER self-authorizes — every gate requires an external
 * GuardianDecisionRefLike), A13 (evidence refs at every gate), A16
 * (exchange semantics — independent contract identities), A8, A19, A20.
 *
 * Pure and deterministic. Time is an explicit `number` input.
 */

import type {
  DemandId,
  NeedId,
  Quote,
  Order,
  OrderId,
  TenantScope,
  GuardianDecisionRefLike,
  EvidenceRefLike,
} from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// Demand flow state machine with the solicitation (Demand→Quote) gate.
// ---------------------------------------------------------------------------

export type DemandFlowStatus = "draft" | "solicited" | "awarded" | "closed" | "cancelled";

export interface DemandFlowRecord {
  readonly id: DemandId;
  readonly tenant: TenantScope;
  readonly needId: NeedId;
  readonly quantity: number;
  readonly requiredBy: number;
  readonly capabilityTags: readonly string[];
  readonly status: DemandFlowStatus;
  readonly solicitationAuthorization: GuardianDecisionRefLike | null;
  readonly solicitationEvidence: EvidenceRefLike | null;
  readonly awardAuthorization: GuardianDecisionRefLike | null;
  readonly awardEvidence: EvidenceRefLike | null;
}

export type DemandFlowCommand =
  | { type: "solicit"; authorization: GuardianDecisionRefLike; evidence: EvidenceRefLike }
  | { type: "award"; authorization: GuardianDecisionRefLike; evidence: EvidenceRefLike }
  | { type: "close" }
  | { type: "cancel"; reason: string };

export type DemandFlowResult =
  | { readonly ok: true; readonly next: DemandFlowRecord }
  | { readonly ok: false; readonly reasonCode: DemandFlowReasonCode };

export type DemandFlowReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "EVIDENCE_REQUIRED"
  | "EVIDENCE_TENANT_MISMATCH"
  | "CANCEL_REASON_REQUIRED"
  | "NEGATIVE_QUANTITY";

const DEMAND_FLOW_ALLOWED: Readonly<
  Record<DemandFlowStatus, readonly DemandFlowCommand["type"][]>
> = {
  draft: ["solicit", "cancel"],
  solicited: ["award", "cancel"],
  awarded: ["close", "cancel"],
  closed: [],
  cancelled: [],
};

/**
 * Gate validation shared by solicitation and award: an external
 * authorization with authorized=true AND an evidence ref from the SAME
 * tenant are required. Procurement never self-authorizes (law A5).
 */
function checkGate(
  record: DemandFlowRecord,
  authorization: GuardianDecisionRefLike | null | undefined,
  evidence: EvidenceRefLike | null | undefined,
): DemandFlowReasonCode | null {
  if (authorization === null || authorization === undefined) {
    return "AUTHORIZATION_REQUIRED";
  }
  if (!authorization.authorized) {
    return "AUTHORIZATION_DENIED";
  }
  if (evidence === null || evidence === undefined || evidence.evidenceId.length === 0) {
    return "EVIDENCE_REQUIRED";
  }
  if (evidence.tenantId !== record.tenant.tenantId) {
    return "EVIDENCE_TENANT_MISMATCH";
  }
  return null;
}

/**
 * transitionDemandFlow — the Need → Demand → Quote → Order spine. The
 * Demand→Quote boundary (solicit) and the Quote→Order boundary (award)
 * are APPROVAL GATES: both require an external authorization and
 * evidence. Every illegal transition is refused with a stable code.
 */
export function transitionDemandFlow(
  current: DemandFlowRecord,
  command: DemandFlowCommand,
): DemandFlowResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!Number.isInteger(current.quantity) || current.quantity <= 0) {
    return { ok: false, reasonCode: "NEGATIVE_QUANTITY" };
  }
  const allowed = DEMAND_FLOW_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  switch (command.type) {
    case "solicit": {
      const gate = checkGate(current, command.authorization, command.evidence);
      if (gate !== null) return { ok: false, reasonCode: gate };
      return {
        ok: true,
        next: {
          ...current,
          status: "solicited",
          solicitationAuthorization: command.authorization,
          solicitationEvidence: command.evidence,
        },
      };
    }
    case "award": {
      const gate = checkGate(current, command.authorization, command.evidence);
      if (gate !== null) return { ok: false, reasonCode: gate };
      return {
        ok: true,
        next: {
          ...current,
          status: "awarded",
          awardAuthorization: command.authorization,
          awardEvidence: command.evidence,
        },
      };
    }
    case "close":
      return { ok: true, next: { ...current, status: "closed" } };
    case "cancel":
      if (!command.reason || command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "CANCEL_REASON_REQUIRED" };
      }
      return { ok: true, next: { ...current, status: "cancelled" } };
  }
}

// ---------------------------------------------------------------------------
// Quote→Order (award) gate.
// ---------------------------------------------------------------------------

export type AwardQuoteResult =
  | { readonly ok: true; readonly order: Order }
  | { readonly ok: false; readonly reasonCode: AwardQuoteReasonCode };

export type AwardQuoteReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "EVIDENCE_REQUIRED"
  | "EVIDENCE_TENANT_MISMATCH"
  | "QUOTE_SUPERSEDED";

/**
 * awardQuoteToOrder — the Quote→Order boundary. Only a SUBMITTED (live)
 * quote can be awarded; superseded/withdrawn/rejected/expired quotes are
 * refused. The gate requires an external authorization (authorized=true)
 * plus evidence from the same tenant. The resulting order is created in
 * `draft` status carrying the authorization (law A5).
 */
export function awardQuoteToOrder(
  quote: Quote,
  orderId: OrderId,
  authorization: GuardianDecisionRefLike | null | undefined,
  evidence: EvidenceRefLike | null | undefined,
): AwardQuoteResult {
  const tenantCheck = validateTenantScope(quote.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (quote.superseded) {
    return { ok: false, reasonCode: "QUOTE_SUPERSEDED" };
  }
  if (quote.status !== "submitted") {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  if (authorization === null || authorization === undefined) {
    return { ok: false, reasonCode: "AUTHORIZATION_REQUIRED" };
  }
  if (!authorization.authorized) {
    return { ok: false, reasonCode: "AUTHORIZATION_DENIED" };
  }
  if (evidence === null || evidence === undefined || evidence.evidenceId.length === 0) {
    return { ok: false, reasonCode: "EVIDENCE_REQUIRED" };
  }
  if (evidence.tenantId !== quote.tenant.tenantId) {
    return { ok: false, reasonCode: "EVIDENCE_TENANT_MISMATCH" };
  }
  return {
    ok: true,
    order: {
      id: orderId,
      tenant: quote.tenant,
      quoteId: quote.id,
      status: "draft",
      authorization,
      fulfillmentVerified: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Idempotent document creation (client-supplied request ids).
// ---------------------------------------------------------------------------

export interface IdempotentCreationRecord {
  readonly requestId: string;
  readonly documentKind: "need" | "procurement-demand" | "quote" | "order" | "fulfillment";
  readonly documentId: string;
  readonly requestDigest: string;
  readonly createdAt: number;
}

export interface IdempotentCreationRegistry {
  readonly tenant: TenantScope;
  readonly records: readonly IdempotentCreationRecord[];
}

export type IdempotentCreationResult =
  | {
      readonly ok: true;
      readonly registry: IdempotentCreationRegistry;
      readonly documentId: string;
      readonly duplicate: boolean;
    }
  | { readonly ok: false; readonly reasonCode: IdempotentCreationReasonCode };

export type IdempotentCreationReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "REQUEST_ID_REQUIRED"
  | "REQUEST_DIGEST_REQUIRED"
  | "DOCUMENT_ID_REQUIRED"
  | "IDEMPOTENCY_KEY_CONFLICT";

/**
 * createDocumentIdempotent — re-submitting the SAME request id with the
 * SAME digest returns the ORIGINAL document id with `duplicate: true`
 * (the document is never created twice). Same request id with a
 * DIFFERENT digest is a typed conflict.
 */
export function createDocumentIdempotent(
  registry: IdempotentCreationRegistry,
  input: {
    readonly requestId: string;
    readonly requestDigest: string;
    readonly documentKind: IdempotentCreationRecord["documentKind"];
    readonly documentId: string;
    readonly createdAt: number;
  },
): IdempotentCreationResult {
  const tenantCheck = validateTenantScope(registry.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!input.requestId || input.requestId.length === 0) {
    return { ok: false, reasonCode: "REQUEST_ID_REQUIRED" };
  }
  if (!input.requestDigest || input.requestDigest.length === 0) {
    return { ok: false, reasonCode: "REQUEST_DIGEST_REQUIRED" };
  }
  if (!input.documentId || input.documentId.length === 0) {
    return { ok: false, reasonCode: "DOCUMENT_ID_REQUIRED" };
  }
  const existing = registry.records.find((r) => r.requestId === input.requestId);
  if (existing) {
    if (
      existing.requestDigest === input.requestDigest &&
      existing.documentKind === input.documentKind
    ) {
      return { ok: true, registry, documentId: existing.documentId, duplicate: true };
    }
    return { ok: false, reasonCode: "IDEMPOTENCY_KEY_CONFLICT" };
  }
  const record: IdempotentCreationRecord = {
    requestId: input.requestId,
    documentKind: input.documentKind,
    documentId: input.documentId,
    requestDigest: input.requestDigest,
    createdAt: input.createdAt,
  };
  return {
    ok: true,
    registry: { ...registry, records: [...registry.records, record] },
    documentId: input.documentId,
    duplicate: false,
  };
}

/**
 * computeRequestDigest — deterministic digest over a creation request's
 * semantic content (used for idempotency conflict detection).
 */
export function computeRequestDigest(
  tenantId: string,
  documentKind: string,
  semanticContent: string,
): string {
  const joined = [tenantId, documentKind, semanticContent].join("\u241f");
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `req_${hash.toString(16).padStart(8, "0")}`;
}
