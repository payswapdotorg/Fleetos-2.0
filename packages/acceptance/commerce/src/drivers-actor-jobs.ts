/**
 * @fleetos/acceptance-commerce — actor-job step drivers (F321C, Wave 12
 * lane C).
 *
 * Interprets typed journey steps against the REAL public entry points of
 * `@fleetos/apify` job-lifecycle.ts that no journey exercised before:
 *   - `createActorJobIdempotent` — tenant-scoped dedupe by idempotency
 *     key (same key + same manifest digest → the ORIGINAL job with
 *     duplicate: true; same key + different draft → the typed conflict;
 *     a foreign-tenant job with the same key never collides);
 *   - `failActorJob` — failure from a RUNNING job with a non-empty
 *     reason code (empty → FAILURE_REASON_REQUIRED; non-running →
 *     ILLEGAL_TRANSITION; terminal → TERMINAL_STATE);
 *   - `expireActorJob` — expiry at/after expiresAt from
 *     proposed/authorized/scheduled (before the window →
 *     NOT_DUE_FOR_EXPIRY; a RUNNING job is NEVER expired — it completes
 *     or fails).
 *
 * CONTRACT-LEVEL LOCAL LIFECYCLE ONLY: these steps drive the local
 * job-record state machine over a logical clock — they make NO live or
 * sandbox Apify provider claim anywhere.
 *
 * Facts are namespaced per `factKey`; refusals are honest facts carrying
 * the domain's reason codes.
 */

import type { FactValue, ActorJobStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, logPush } from "./journey-world.js";
import {
  createActorJob,
  createActorJobIdempotent,
  failActorJob,
  expireActorJob,
} from "@fleetos/apify";
import type { ActorJobRecord, CreateJobDraft } from "@fleetos/apify";

export type DriverFacts = Record<string, FactValue>;

/** The standard create-step input shape (drivers-external.ts apify-job-create). */
const STANDARD_INPUT: Readonly<Record<string, unknown>> = { query: "vendor price pages", maxPages: 3 };

export async function runActorJobStep(step: ActorJobStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "apify-job-create-idempotent": {
      const input: Readonly<Record<string, unknown>> =
        step.inputTag === "same" ? STANDARD_INPUT : { query: "vendor price pages", maxPages: 5 };
      const draft: CreateJobDraft = {
        tenant: state.tenant,
        jobId: step.jobId,
        actorId: step.actorId,
        input,
        idempotencyKey: step.idempotencyKey,
        window: step.window,
        now: step.nowMs,
        expiresAt: step.expiresAtMs,
      };
      let existing: readonly ActorJobRecord[];
      if (step.prior === "current") {
        const job = state.apify.job;
        if (job === null) {
          return { [`apifyIdem.${step.factKey}.ok`]: false, [`apifyIdem.${step.factKey}.reasonCode`]: "JOB_NOT_CREATED" };
        }
        existing = [job];
      } else if (step.prior === "foreign-same-key") {
        const foreign = createActorJob({ ...draft, tenant: state.otherTenant });
        if (!foreign.ok) {
          return { [`apifyIdem.${step.factKey}.ok`]: false, [`apifyIdem.${step.factKey}.reasonCode`]: foreign.reasonCode };
        }
        existing = [foreign.job];
      } else {
        existing = [];
      }
      const result = createActorJobIdempotent(existing, draft);
      if (!result.ok) {
        logPush(state, "apifyFx.log", `${step.jobId}:refused:${result.reasonCode}`);
        return {
          [`apifyIdem.${step.factKey}.ok`]: false,
          [`apifyIdem.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      if (!result.duplicate) state.apify.job = result.job;
      logPush(state, "apifyFx.log", `${result.job.jobId}:${result.duplicate ? "duplicate" : "fresh"}`);
      return {
        [`apifyIdem.${step.factKey}.ok`]: true,
        [`apifyIdem.${step.factKey}.duplicate`]: result.duplicate,
        [`apifyIdem.${step.factKey}.jobId`]: result.job.jobId,
        [`apifyIdem.${step.factKey}.status`]: result.job.status,
        [`apifyIdem.${step.factKey}.tenantId`]: result.job.tenant.tenantId,
        [`apifyIdem.${step.factKey}.idempotencyKey`]: result.job.idempotencyKey,
      };
    }
    case "apify-job-fail": {
      const job = state.apify.job;
      if (job === null) {
        return { [`apifyFail.${step.factKey}.ok`]: false, [`apifyFail.${step.factKey}.reasonCode`]: "JOB_NOT_CREATED" };
      }
      const result = failActorJob(job, step.reasonCode, CLOCK.t4);
      if (result.ok) state.apify.job = result.job;
      logPush(state, "apifyFx.log", `${job.jobId}:${result.ok ? result.job.status : result.reasonCode}`);
      return {
        [`apifyFail.${step.factKey}.ok`]: result.ok,
        [`apifyFail.${step.factKey}.status`]: result.ok ? result.job.status : null,
        [`apifyFail.${step.factKey}.reasonCode`]: result.ok ? null : result.reasonCode,
        [`apifyFail.${step.factKey}.failureReasonCode`]: result.ok ? (result.job.failure?.reasonCode ?? null) : null,
      };
    }
    case "apify-job-expire-at": {
      const job = state.apify.job;
      if (job === null) {
        return { [`apifyExpire.${step.factKey}.ok`]: false, [`apifyExpire.${step.factKey}.reasonCode`]: "JOB_NOT_CREATED" };
      }
      const result = expireActorJob(job, step.nowMs);
      if (result.ok) state.apify.job = result.job;
      logPush(state, "apifyFx.log", `${job.jobId}:${result.ok ? result.job.status : result.reasonCode}`);
      return {
        [`apifyExpire.${step.factKey}.ok`]: result.ok,
        [`apifyExpire.${step.factKey}.status`]: result.ok ? result.job.status : null,
        [`apifyExpire.${step.factKey}.reasonCode`]: result.ok ? null : result.reasonCode,
      };
    }
  }
}
