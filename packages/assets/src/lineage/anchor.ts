/**
 * @fleetos/assets — Wave 9 lineage observation anchoring (F290A).
 *
 * A method application may reference a REAL observation record ingested
 * through the observations package's public ingestion surface. This module
 * is the FAIL-CLOSED validation gate: given a method application that
 * carries an observation anchor and a caller-supplied observation lookup
 * port, it verifies the observation exists AND belongs to the same tenant
 * as the application. Dangling references are refused with REAL reason
 * codes; nothing is silently accepted.
 *
 * The structural port `ObservationLookupPort` mirrors the REAL public
 * observations surface (`@fleetos/observations`'s `Observation` shape): the
 * caller binds a REAL lookup at the composition site (a test or the
 * composing application); the lineage module never imports the
 * observations package at runtime (the assets package has zero cross-
 * context runtime imports — the F290B invariant for this lane).
 *
 * Pure TypeScript, no I/O, no Date.now, no Math.random, no timers, no network.
 */

import type { TenantIdLike } from "../assets.js";
import type { MethodApplication } from "./method.js";

// ---------------------------------------------------------------------------
// Structural port — the observations surface, accessed by composition.
// ---------------------------------------------------------------------------

/**
 * A small, structural summary of a REAL observation. The REAL
 * `@fleetos/observations` `Observation` matches this shape; tests bind the
 * REAL `admitObservation` / `admitToLog` outputs and pass them through this
 * port. The lineage module never imports `@fleetos/observations` at runtime.
 */
export interface ObservationSummary {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly deviceId: string;
  readonly seq: number;
  readonly observedAt: number;
  readonly payloadDigest: string;
}

/**
 * Lookup port: returns the observation summary for `(tenantId, observationId)`,
 * or `null` if no such observation exists in the caller's tenant scope.
 * Implementations MUST enforce tenant scoping (the REAL observations
 * surface does so via `listObservationsForDevice(log, tenantId, deviceId)`).
 */
export interface ObservationLookupPort {
  readonly lookup: (
    tenantId: TenantIdLike,
    observationId: string,
  ) => ObservationSummary | null;
}

// ---------------------------------------------------------------------------
// Anchor validation — fail-closed.
// ---------------------------------------------------------------------------

export type ObservationAnchorRejectionCode =
  | "missing-anchor-field"
  | "malformed-observation-id"
  | "dangling-observation"
  | "observation-tenant-mismatch";

export interface ObservationAnchorInput {
  readonly tenantId: TenantIdLike;
  readonly observationAnchor?: { readonly observationId: string };
}

export type ObservationAnchorResult =
  | {
      readonly ok: true;
      readonly anchor: { readonly observationId: string };
      readonly observation: ObservationSummary;
    }
  | { readonly ok: false; readonly reason: ObservationAnchorRejectionCode };

const OBSERVATION_ID_RE = /^obs_[A-Za-z0-9_-]{8,256}$/;

export function validateObservationAnchor(
  lookup: ObservationLookupPort,
  input: ObservationAnchorInput,
): ObservationAnchorResult {
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    // The caller's tenant scope is part of the contract; an empty tenant
    // is treated as a missing anchor (fail-closed — never a free pass).
    return { ok: false, reason: "missing-anchor-field" };
  }
  if (!input.observationAnchor || typeof input.observationAnchor !== "object") {
    return { ok: false, reason: "missing-anchor-field" };
  }
  const observationId = input.observationAnchor.observationId;
  if (typeof observationId !== "string" || observationId === "") {
    return { ok: false, reason: "missing-anchor-field" };
  }
  if (!OBSERVATION_ID_RE.test(observationId)) {
    return { ok: false, reason: "malformed-observation-id" };
  }
  const observation = lookup.lookup(input.tenantId, observationId);
  if (!observation) {
    return { ok: false, reason: "dangling-observation" };
  }
  if (observation.tenantId !== input.tenantId) {
    return { ok: false, reason: "observation-tenant-mismatch" };
  }
  return {
    ok: true,
    anchor: { observationId },
    observation,
  };
}

/**
 * Convenience: validate the anchor carried by a method application record.
 * The application must already have been built (via `applyMethodToAsset`),
 * so this only verifies the anchor field. Fail-closed: an application
 * without an anchor field refuses with `missing-anchor-field` (anchoring
 * is the point of this call; an unanchored application is not "anchored").
 */
export function anchorMethodApplication(
  lookup: ObservationLookupPort,
  application: MethodApplication,
): ObservationAnchorResult {
  return validateObservationAnchor(lookup, {
    tenantId: application.tenantId,
    observationAnchor: application.observationAnchor,
  });
}
