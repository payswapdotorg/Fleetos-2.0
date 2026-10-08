/**
 * @fleetos/apify — evidence-gated job result ingestion (Wave 5).
 *
 * Results enter as QUARANTINED projections and only become USABLE when an
 * evidence bundle ref is attached:
 *
 *   - ingest: every result is quarantined. Structurally valid payloads are
 *     quarantined with `EVIDENCE_NOT_ATTACHED` and classified
 *     deterministically ("structured" | "empty"); a malformed payload (not a
 *     plain object) is quarantined with `PAYLOAD_MALFORMED` — recorded with
 *     the original input verbatim, never silently dropped.
 *   - evidence gate: `attachEvidenceBundle` requires an evidence ref whose
 *     digest is sha-256-SHAPED. This is a STRUCTURAL check only —
 *     `isSha256Shaped` verifies the 64-lowercase-hex form and NEVER claims
 *     the digest matches remote content (content verification belongs to
 *     the evidence context, worker B's lane).
 *   - nothing is laundered: a result quarantined for a malformed payload
 *     stays quarantined; attaching evidence to it is refused.
 *
 * Pure, deterministic, tenant fail-closed; logical time is caller-supplied.
 */
import { validateTenantScope, type TenantScope } from "./seam.js";
import { canonicalJson, fnv1a32Hex } from "./digest.js";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface EvidenceBundleRef {
  readonly bundleId: string;
  readonly tenantId: string;
  /** sha-256-SHAPED digest (structural validation only — see module header). */
  readonly digest: string;
}

export type IngestedResultState = "quarantined" | "usable";

export type ResultQuarantineReasonCode = "EVIDENCE_NOT_ATTACHED" | "PAYLOAD_MALFORMED";

export type PayloadClassification = "structured" | "empty" | "malformed";

export interface IngestedJobResult {
  readonly resultId: string;
  readonly tenant: TenantScope;
  readonly jobId: string;
  /** Null only for PAYLOAD_MALFORMED quarantine (original kept verbatim below). */
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly rawPayload: unknown;
  readonly payloadClassification: PayloadClassification;
  readonly state: IngestedResultState;
  readonly quarantineReasonCode: ResultQuarantineReasonCode | null;
  readonly evidence: EvidenceBundleRef | null;
  readonly resultDigest: string;
  readonly ingestedAt: number;
  readonly evidenceAttachedAt: number | null;
}

export type IngestRefusalCode =
  | "TENANT_SCOPE_MISSING"
  | "RESULT_ID_EMPTY"
  | "JOB_ID_EMPTY"
  | "LOGICAL_TIME_INVALID"
  | "EVIDENCE_BUNDLE_ID_EMPTY"
  | "EVIDENCE_DIGEST_MALFORMED"
  | "EVIDENCE_TENANT_MISMATCH"
  | "EVIDENCE_ALREADY_ATTACHED"
  | "RESULT_NOT_QUARANTINED";

export type IngestResult =
  | { readonly ok: true; readonly result: IngestedJobResult }
  | { readonly ok: false; readonly reasonCode: IngestRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------
// sha-256 shape validation (structural only).
// ---------------------------------------------------------------------------

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function isSha256Shaped(digest: string): boolean {
  return SHA256_PATTERN.test(digest);
}

// ---------------------------------------------------------------------------
// Digests.
// ---------------------------------------------------------------------------

export function computeResultDigest(result: IngestedJobResult): string {
  const evidencePart = result.evidence === null ? "\u2205" : `${result.evidence.bundleId}\u241f${result.evidence.digest}`;
  const payloadPart = result.payload === null ? "\u2205" : canonicalJson(result.payload);
  return fnv1a32Hex(
    "result",
    [result.tenant.tenantId, result.resultId, result.jobId, payloadPart, evidencePart].join("\u241f"),
  );
}

export function verifyResultDigest(result: IngestedJobResult): boolean {
  return computeResultDigest(result) === result.resultDigest;
}

// ---------------------------------------------------------------------------
// Ingestion — results enter quarantine.
// ---------------------------------------------------------------------------

export interface IngestResultInput {
  readonly tenant: TenantScope;
  readonly resultId: string;
  readonly jobId: string;
  /** Caller-supplied raw payload; malformed shapes are quarantined, not dropped. */
  readonly payload: unknown;
  readonly now: number;
}

export function ingestJobResult(input: IngestResultInput): IngestResult {
  const scope = validateTenantScope(input.tenant);
  if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  if (typeof input.resultId !== "string" || input.resultId.trim().length === 0) {
    return { ok: false, reasonCode: "RESULT_ID_EMPTY", detail: "resultId is empty" };
  }
  if (typeof input.jobId !== "string" || input.jobId.trim().length === 0) {
    return { ok: false, reasonCode: "JOB_ID_EMPTY", detail: "jobId is empty" };
  }
  if (!Number.isInteger(input.now) || input.now < 0) {
    return { ok: false, reasonCode: "LOGICAL_TIME_INVALID", detail: "now is not a non-negative integer" };
  }
  const malformed = input.payload === null || typeof input.payload !== "object" || Array.isArray(input.payload);
  const classification: PayloadClassification = malformed
    ? "malformed"
    : Object.keys(input.payload as Record<string, unknown>).length > 0
      ? "structured"
      : "empty";
  const quarantined: IngestedJobResult = {
    resultId: input.resultId,
    tenant: scope.scope,
    jobId: input.jobId,
    payload: malformed ? null : (input.payload as Record<string, unknown>),
    rawPayload: input.payload,
    payloadClassification: classification,
    state: "quarantined",
    quarantineReasonCode: malformed ? "PAYLOAD_MALFORMED" : "EVIDENCE_NOT_ATTACHED",
    evidence: null,
    resultDigest: "",
    ingestedAt: input.now,
    evidenceAttachedAt: null,
  };
  return { ok: true, result: { ...quarantined, resultDigest: computeResultDigest(quarantined) } };
}

// ---------------------------------------------------------------------------
// Evidence gate — the only path from quarantined to usable.
// ---------------------------------------------------------------------------

export function attachEvidenceBundle(
  result: IngestedJobResult,
  bundle: EvidenceBundleRef,
  now: number,
): IngestResult {
  const resultTenant = validateTenantScope(result.tenant);
  if (!resultTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "result tenant invalid" };
  if (result.state !== "quarantined") {
    return { ok: false, reasonCode: "EVIDENCE_ALREADY_ATTACHED", detail: "result is already usable" };
  }
  if (result.quarantineReasonCode === "PAYLOAD_MALFORMED") {
    return { ok: false, reasonCode: "RESULT_NOT_QUARANTINED", detail: "evidence cannot launder a malformed payload" };
  }
  if (bundle === null || typeof bundle !== "object") {
    return { ok: false, reasonCode: "EVIDENCE_BUNDLE_ID_EMPTY", detail: "evidence bundle is missing" };
  }
  if (typeof bundle.bundleId !== "string" || bundle.bundleId.trim().length === 0) {
    return { ok: false, reasonCode: "EVIDENCE_BUNDLE_ID_EMPTY", detail: "bundleId is empty" };
  }
  if (typeof bundle.digest !== "string" || !isSha256Shaped(bundle.digest)) {
    return { ok: false, reasonCode: "EVIDENCE_DIGEST_MALFORMED", detail: "digest is not sha-256-shaped (64 lowercase hex)" };
  }
  if (bundle.tenantId !== resultTenant.scope.tenantId) {
    return { ok: false, reasonCode: "EVIDENCE_TENANT_MISMATCH", detail: "evidence bundle belongs to another tenant" };
  }
  if (!Number.isInteger(now) || now < result.ingestedAt) {
    return { ok: false, reasonCode: "LOGICAL_TIME_INVALID", detail: "now must be an integer ≥ ingestedAt" };
  }
  const usable: IngestedJobResult = {
    ...result,
    state: "usable",
    quarantineReasonCode: null,
    evidence: bundle,
    evidenceAttachedAt: now,
  };
  return { ok: true, result: { ...usable, resultDigest: computeResultDigest(usable) } };
}

// ---------------------------------------------------------------------------
// Tenant fail-closed reads (no existence leaks).
// ---------------------------------------------------------------------------

export function readResultForTenant(
  results: readonly IngestedJobResult[],
  tenant: TenantScope,
  resultId: string,
): IngestedJobResult | null {
  const scope = validateTenantScope(tenant);
  if (!scope.ok) return null;
  for (const result of results) {
    if (result.resultId !== resultId) continue;
    if (result.tenant.tenantId !== scope.scope.tenantId) return null; // fail-closed, no leak
    return result;
  }
  return null;
}

export function partitionByState(
  results: readonly IngestedJobResult[],
): { readonly usable: readonly IngestedJobResult[]; readonly quarantined: readonly IngestedJobResult[] } {
  const usable: IngestedJobResult[] = [];
  const quarantined: IngestedJobResult[] = [];
  for (const result of results) {
    if (result.state === "usable") usable.push(result);
    else quarantined.push(result);
  }
  return { usable, quarantined };
}
