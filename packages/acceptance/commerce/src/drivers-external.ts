/**
 * @fleetos/acceptance-commerce — external-adapter step drivers.
 *
 * Interprets typed journey steps against the REAL public entry points of
 * @fleetos/external-vendors (catalog sync + verification + scorecards)
 * and @fleetos/apify (actor job lifecycle + evidence-gated ingestion).
 * Facts are verbatim REAL outputs; refusals carry the domain codes.
 */

import type { FactValue, CommerceStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, logPush } from "./journey-world.js";
import {
  importCatalogBatch,
  verifyCapability as verifyExternalCapability,
  ingestVendorMetrics,
  rollupVendorScorecards,
  revokeVerification,
  applyRevocationToMetrics,
  verifyCatalogDigest,
} from "@fleetos/external-vendors";
import {
  createActorJob,
  authorizeActorJob,
  scheduleActorJob,
  startActorJob,
  completeActorJob,
  failActorJob,
  expireActorJob,
  accountRateBudget,
  ingestJobResult,
  attachEvidenceBundle,
  verifyJobManifest,
  partitionByState,
} from "@fleetos/apify";

export type DriverFacts = Record<string, FactValue>;

const SHA_256 = "a".repeat(64);

export async function runExternalStep(step: CommerceStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "catalog-import": {
      const result = importCatalogBatch(
        state.external.catalog,
        step.entries.map((e) => ({
          externalId: e.externalId,
          vendorExternalId: e.vendorExternalId,
          displayName: e.displayName,
          capabilities: [...e.capabilities],
          logicalTime: e.logicalTime,
        })),
        CLOCK.t2,
      );
      if (!result.ok) {
        return { "catalog.ok": false, "catalog.reasonCode": result.reasonCode, "catalog.detail": result.detail };
      }
      state.external.catalog = result.catalog;
      logPush(
        state,
        "catalog.importLog",
        `${result.imported.length}:${[...result.imported].join(",") || "-"}:${[...result.duplicatesSkipped].join(",") || "-"}:${[...result.staleSkipped].join(",") || "-"}`,
      );
      return {
        "catalog.ok": true,
        "catalog.imported": result.imported.length,
        "catalog.importedIds": [...result.imported],
        "catalog.duplicates": [...result.duplicatesSkipped],
        "catalog.stale": [...result.staleSkipped],
        "catalog.digestVerified": verifyCatalogDigest(result.catalog).ok,
        "catalog.entryCount": result.catalog.entries.size,
      };
    }
    case "catalog-verify": {
      const result = verifyExternalCapability(state.external.catalog, state.external.registry, {
        tenant: state.tenant,
        externalId: step.externalId,
        capability: step.capability,
        evidence: step.evidenceId === null ? null : { evidenceId: step.evidenceId, tenantId: state.tenant.tenantId },
        verifiedAt: CLOCK.t2,
        expiresAt: CLOCK.t3,
      });
      if (!result.ok) {
        logPush(state, "xverify.log", `false:${result.reasonCode}`);
        return { "xverify.ok": false, "xverify.reasonCode": result.reasonCode, "xverify.detail": result.detail };
      }
      state.external.catalog = result.catalog;
      state.external.registry = result.registry;
      const claim = result.catalog.entries.get(step.externalId)?.capabilityClaims.find((c) => c.capability === step.capability);
      logPush(state, "xverify.log", `true:${result.record.state}`);
      return {
        "xverify.ok": true,
        "xverify.claimState": claim?.state ?? null,
        "xverify.recordState": result.record.state,
        "xverify.digestVerified": verifyCatalogDigest(result.catalog).ok,
      };
    }
    case "catalog-metrics": {
      const result = ingestVendorMetrics(state.external.metrics, state.external.catalog, state.external.registry, step.drafts.map((d) => ({
        tenant: state.tenant,
        metricId: d.metricId,
        vendorExternalId: d.vendorExternalId,
        metric: d.metric,
        window: d.window,
        valueBps: d.valueBps,
        weightBps: d.weightBps,
        dependsOnCapability: d.dependsOnCapability,
        ingestedAt: CLOCK.t2,
      })));
      if (!result.ok) {
        return { "metrics.ok": false, "metrics.reasonCode": result.reasonCode, "metrics.detail": result.detail };
      }
      state.external.metrics = [...result.metrics];
      return {
        "metrics.ok": true,
        "metrics.admitted": result.admitted.length,
        "metrics.admittedIds": [...result.admitted],
        "metrics.quarantined": [...result.quarantined],
      };
    }
    case "catalog-scorecards": {
      const result = rollupVendorScorecards(state.external.metrics, {
        tenant: state.tenant,
        currentWindow: step.currentWindow,
        previousWindow: step.previousWindow,
      });
      if (!result.ok) {
        return { "scorecards.ok": false, "scorecards.reasonCode": result.reasonCode, "scorecards.detail": result.detail };
      }
      logPush(state, "scorecards.bpsLog", result.rollups.map((r) => String(r.aggregatedBps)).join(","));
      return {
        "scorecards.ok": true,
        "scorecards.rollupCount": result.rollups.length,
        "scorecards.vendors": result.rollups.map((r) => r.vendorExternalId),
        "scorecards.aggregatedBps": result.rollups.map((r) => String(r.aggregatedBps)),
        "scorecards.exclusionLines": result.rollups.map((r) => r.exclusions.map((e) => `${e.metricId}:${e.reasonCode}`).join(",")),
        "scorecards.trends": result.rollups.map((r) => r.trend ?? "no-history"),
        "scorecards.includedCounts": result.rollups.map((r) => String(r.includedCount)),
      };
    }
    case "catalog-revoke": {
      const result = revokeVerification(state.external.catalog, state.external.registry, {
        tenant: state.tenant,
        externalId: step.externalId,
        capability: step.capability,
        reason: step.reason,
      }, CLOCK.t4);
      if (!result.ok) {
        return { "xrevoke.ok": false, "xrevoke.reasonCode": result.reasonCode, "xrevoke.detail": result.detail };
      }
      state.external.catalog = result.catalog;
      state.external.registry = result.registry;
      const propagation = applyRevocationToMetrics(state.external.metrics, result.notice);
      if (!propagation.ok) {
        return { "xrevoke.ok": false, "xrevoke.reasonCode": propagation.reasonCode, "xrevoke.detail": propagation.detail };
      }
      state.external.metrics = [...propagation.metrics];
      return {
        "xrevoke.ok": true,
        "xrevoke.affectedCount": propagation.affected.length,
        "xrevoke.affectedIds": [...propagation.affected],
        "xrevoke.recordState": result.registry.records.get(`${step.externalId}::${step.capability}`)?.state ?? null,
      };
    }
    case "apify-job-create": {
      const result = createActorJob({
        tenant: state.tenant,
        jobId: step.jobId,
        actorId: step.actorId,
        input: { query: "vendor price pages", maxPages: 3 },
        idempotencyKey: `idem-${step.jobId}`,
        window: step.window,
        now: CLOCK.t0,
        expiresAt: CLOCK.t5,
      });
      if (!result.ok) return { "apify.ok": false, "apify.reasonCode": result.reasonCode };
      state.apify.job = result.job;
      logPush(state, "apify.statusLog", `${step.jobId}:proposed`);
      return {
        "apify.ok": true,
        "apify.status": result.job.status,
        "apify.manifestVerified": verifyJobManifest(result.job.manifest),
        "apify.jobId": result.job.jobId,
      };
    }
    case "apify-job-authorize": {
      const job = state.apify.job;
      if (job === null) return { "apify.ok": false, "apify.reasonCode": "JOB_NOT_CREATED" };
      const result = authorizeActorJob(
        job,
        { decisionId: step.decisionId, authorized: step.authorized, reasonCode: step.reasonCode },
        CLOCK.t1,
      );
      if (result.ok) state.apify.job = result.job;
      logPush(
        state,
        "apify.statusLog",
        `${job.jobId}:${result.ok ? result.job.status : result.reasonCode}`,
      );
      return {
        "apify.ok": result.ok,
        "apify.status": result.ok ? result.job.status : null,
        "apify.reasonCode": result.ok ? null : result.reasonCode,
      };
    }
    case "apify-job-schedule": {
      const job = state.apify.job;
      if (job === null) return { "apify.ok": false, "apify.reasonCode": "JOB_NOT_CREATED" };
      const result = scheduleActorJob(job, state.apify.rateLedger, step.units, CLOCK.t2);
      if (result.job.ok) {
        state.apify.job = result.job.job;
        if (result.budget.ok) state.apify.rateLedger = result.budget.ledger;
      }
      logPush(
        state,
        "apify.statusLog",
        `${job.jobId}:${result.job.ok ? result.job.job.status : result.job.reasonCode}`,
      );
      // The REAL ledger accounting as it stands AFTER the step — a refused
      // reservation leaves the ledger untouched, and its honest utilization
      // (plus the ceiling-not-authorization note) is still the REAL output.
      const accounting = accountRateBudget(state.apify.rateLedger);
      return {
        "apify.ok": result.job.ok,
        "apify.status": result.job.ok ? result.job.job.status : null,
        "apify.reasonCode": result.job.ok ? null : result.job.reasonCode,
        "apify.reservedUnits": result.job.ok ? (result.job.job.reservedUnits ?? -1) : -1,
        "apify.budgetSpent": accounting.spentUnits,
        "apify.budgetUtilizationBps": accounting.utilizationBps,
        "apify.budgetNote": accounting.note,
        "apify.budgetOvershootUnits": result.budget.ok ? null : (result.budget.overshootUnits ?? null),
      };
    }
    case "apify-job-transition": {
      const job = state.apify.job;
      if (job === null) return { "apify.ok": false, "apify.reasonCode": "JOB_NOT_CREATED" };
      const result =
        step.command === "start"
          ? startActorJob(job, CLOCK.t3)
          : step.command === "complete"
            ? completeActorJob(job, CLOCK.t4)
            : step.command === "fail"
              ? failActorJob(job, "ACTOR_ERROR", CLOCK.t4)
              : expireActorJob(job, CLOCK.t5);
      if (result.ok) state.apify.job = result.job;
      logPush(
        state,
        "apify.statusLog",
        `${job.jobId}:${result.ok ? result.job.status : result.reasonCode}`,
      );
      return {
        "apify.ok": result.ok,
        "apify.status": result.ok ? result.job.status : null,
        "apify.reasonCode": result.ok ? null : result.reasonCode,
      };
    }
    case "apify-ingest-result": {
      const payload: unknown =
        step.payload === "structured"
          ? { pages: 3, vendors: ["ven-x"] }
          : step.payload === "empty"
            ? {}
            : "not-an-object";
      const result = ingestJobResult({
        tenant: state.tenant,
        resultId: step.resultId,
        jobId: state.apify.job?.jobId ?? "job-1",
        payload,
        now: CLOCK.t4,
      });
      if (!result.ok) return { "apifyIngest.ok": false, "apifyIngest.reasonCode": result.reasonCode };
      state.apify.results = [...state.apify.results, result.result];
      logPush(
        state,
        "apifyIngest.stateLog",
        `${step.resultId}:${result.result.state}:${result.result.quarantineReasonCode ?? "-"}`,
      );
      return {
        "apifyIngest.ok": true,
        "apifyIngest.state": result.result.state,
        "apifyIngest.classification": result.result.payloadClassification,
        "apifyIngest.quarantineReasonCode": result.result.quarantineReasonCode,
      };
    }
    case "apify-attach-evidence": {
      const target = state.apify.results[state.apify.results.length - 1];
      if (target === undefined) return { "apifyEvidence.ok": false, "apifyEvidence.reasonCode": "RESULT_NOT_INGESTED" };
      const attached = attachEvidenceBundle(
        target,
        {
          bundleId: step.bundleId,
          tenantId: state.tenant.tenantId,
          digest: step.digestShapeValid ? SHA_256 : "deadbeef",
        },
        CLOCK.t5,
      );
      if (!attached.ok) {
        logPush(state, "apifyEvidence.log", `${step.bundleId}:refused:${attached.reasonCode}`);
        // The refused attach still leaves the REAL result set observable:
        // surface the partition so the quarantine invariants stay assertable.
        const refusalPartition = partitionByState(state.apify.results);
        return {
          "apifyEvidence.ok": false,
          "apifyEvidence.reasonCode": attached.reasonCode,
          "apifyEvidence.usableCount": refusalPartition.usable.length,
          "apifyEvidence.quarantinedCount": refusalPartition.quarantined.length,
        };
      }
      state.apify.results = state.apify.results.map((r, i) => (i === state.apify.results.length - 1 ? attached.result : r));
      logPush(state, "apifyEvidence.log", `${step.bundleId}:usable`);
      const partition = partitionByState(state.apify.results);
      return {
        "apifyEvidence.ok": true,
        "apifyEvidence.state": attached.result.state,
        "apifyEvidence.bundleId": attached.result.evidence?.bundleId ?? null,
        "apifyEvidence.usableCount": partition.usable.length,
        "apifyEvidence.quarantinedCount": partition.quarantined.length,
      };
    }
    default:
      return { "step.ok": false, "step.reasonCode": `UNHANDLED_STEP:${step.kind}` };
  }
}
