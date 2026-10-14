/**
 * @fleetos/acceptance-commerce — idempotent-creation step drivers (F351C,
 * Wave 15 lane C).
 *
 * Interprets typed journey steps against the REAL public entry points of
 * `@fleetos/procurement` flow.ts: `createDocumentIdempotent` +
 * `computeRequestDigest` — the document idempotency discipline.
 * Re-submitting the SAME request id with the SAME request digest returns
 * the ORIGINAL document id with duplicate=true (the document is never
 * created twice — even when the replay names a different documentId in
 * its input); the SAME request id with a DIFFERENT digest is a typed
 * IDEMPOTENCY_KEY_CONFLICT; empty request ids / digests / document ids
 * refuse with the exact required-field reason codes. The request digest
 * is the REAL domain digest (FNV-1a over tenant ␟ kind ␟ semantic
 * content) — deterministic, and distinct for distinct semantic content.
 *
 * The registry threads through a WeakMap seam keyed by JourneyState — a
 * fresh world per run keeps every run pure and deterministic.
 */

import type { FactValue } from "./journey-contracts.js";
import type { IdempotentCreationStep } from "./journey-contracts-f351c.js";
import type { JourneyState } from "./journey-world.js";
import { logPush } from "./journey-world.js";
import type { IdempotentCreationRegistry } from "@fleetos/procurement";
import { createDocumentIdempotent, computeRequestDigest } from "@fleetos/procurement";

export type DriverFacts = Record<string, FactValue>;

interface IdemSeam {
  registry: IdempotentCreationRegistry;
}

const seams = new WeakMap<JourneyState, IdemSeam>();

function seamFor(state: JourneyState): IdemSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    seam = { registry: { tenant: state.tenant, records: [] } };
    seams.set(state, seam);
  }
  return seam;
}

export async function runIdempotentCreationStep(
  step: IdempotentCreationStep,
  state: JourneyState,
): Promise<DriverFacts> {
  switch (step.kind) {
    case "pidem-create": {
      const seam = seamFor(state);
      const requestDigest =
        step.requestId.length === 0 || step.semanticContent.length === 0
          ? ""
          : computeRequestDigest(state.tenant.tenantId, step.documentKind, step.semanticContent);
      const result = createDocumentIdempotent(seam.registry, {
        requestId: step.requestId,
        requestDigest,
        documentKind: step.documentKind,
        documentId: step.documentId,
        createdAt: step.createdAt,
      });
      if (!result.ok) {
        logPush(state, "pidem.log", `${step.requestId || "-"}:refused:${result.reasonCode}`);
        return {
          [`pidem.create.${step.factKey}.ok`]: false,
          [`pidem.create.${step.factKey}.reasonCode`]: result.reasonCode,
          [`pidem.create.${step.factKey}.duplicate`]: null,
          [`pidem.create.${step.factKey}.documentId`]: null,
          [`pidem.create.${step.factKey}.recordCount`]: seam.registry.records.length,
        };
      }
      if (result.registry !== seam.registry) seam.registry = result.registry;
      logPush(state, "pidem.log", `${step.requestId}:${result.duplicate ? "duplicate" : "created"}:${result.documentId}`);
      return {
        [`pidem.create.${step.factKey}.ok`]: true,
        [`pidem.create.${step.factKey}.reasonCode`]: null,
        [`pidem.create.${step.factKey}.duplicate`]: result.duplicate,
        [`pidem.create.${step.factKey}.documentId`]: result.documentId,
        [`pidem.create.${step.factKey}.recordCount`]: seam.registry.records.length,
      };
    }
    case "pidem-digest": {
      const first = computeRequestDigest(state.tenant.tenantId, "order", step.first);
      const second = computeRequestDigest(state.tenant.tenantId, "order", step.second);
      const firstAgain = computeRequestDigest(state.tenant.tenantId, "order", step.first);
      const third = step.third === undefined ? null : computeRequestDigest(state.tenant.tenantId, "order", step.third);
      logPush(state, "pidem.digestLog", `${first}:${second}`);
      return {
        [`pidem.digest.${step.factKey}.deterministic`]: first === firstAgain,
        [`pidem.digest.${step.factKey}.first`]: first,
        [`pidem.digest.${step.factKey}.second`]: second,
        [`pidem.digest.${step.factKey}.distinct`]: first !== second,
        [`pidem.digest.${step.factKey}.thirdDistinct`]: third === null ? null : third !== first && third !== second,
      };
    }
  }
}
