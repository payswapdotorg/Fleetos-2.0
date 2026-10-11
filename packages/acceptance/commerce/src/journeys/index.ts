/**
 * @fleetos/acceptance-commerce — the journey corpus (public `./journeys`).
 *
 * 34 journeys over the worker-C lane's REAL packages (F300C extended the
 * Wave 7 corpus 15 → 21; F310C extended 21 → 31; F321C extends 31 → 34:
 * +2 vendor-family journeys — the marketplace publication lifecycle
 * (publication gate, delisting cascade, deterministic search) and the
 * vendor-directory service-relationship surface (audit events, worst-wins
 * scorecards, capability matching feed, fail-closed tenant reads); +1
 * actor-job failure/expiry journey — the contract-level local terminal
 * lifecycle + idempotent creation, with NO live Apify claim). The corpus
 * is pure data; validation of its shape happens in tests (unique ids,
 * vocabulary membership, at least five assertions per journey).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { WORK_JOURNEYS } from "./work.js";
import { COMMERCE_JOURNEYS } from "./commerce.js";
import { ORG_JOURNEYS } from "./org.js";
import { HOST_JOURNEYS } from "./host.js";
import { GATEWAY_JOURNEYS } from "./gateway.js";
import { LIFECYCLE_JOURNEYS } from "./lifecycle.js";
import { FINANCE_JOURNEYS } from "./finance.js";
import { RESILIENCE_JOURNEYS } from "./resilience.js";
import { MARKETPLACE_JOURNEYS } from "./marketplace.js";
import { ACTOR_JOBS_JOURNEYS } from "./actor-jobs.js";

export const JOURNEYS: readonly AcceptanceJourney[] = [
  ...WORK_JOURNEYS,
  ...COMMERCE_JOURNEYS,
  ...ORG_JOURNEYS,
  ...HOST_JOURNEYS,
  ...GATEWAY_JOURNEYS,
  ...LIFECYCLE_JOURNEYS,
  ...FINANCE_JOURNEYS,
  ...RESILIENCE_JOURNEYS,
  ...MARKETPLACE_JOURNEYS,
  ...ACTOR_JOBS_JOURNEYS,
];

export {
  WORK_JOURNEYS,
  COMMERCE_JOURNEYS,
  ORG_JOURNEYS,
  HOST_JOURNEYS,
  GATEWAY_JOURNEYS,
  LIFECYCLE_JOURNEYS,
  FINANCE_JOURNEYS,
  RESILIENCE_JOURNEYS,
  MARKETPLACE_JOURNEYS,
  ACTOR_JOBS_JOURNEYS,
};
