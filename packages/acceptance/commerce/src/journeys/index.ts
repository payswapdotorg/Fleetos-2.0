/**
 * @fleetos/acceptance-commerce — the journey corpus (public `./journeys`).
 *
 * 31 journeys over the worker-C lane's REAL packages (F300C extended the
 * Wave 7 corpus 15 → 21; F310C extends 21 → 31: +4 lifecycle journeys —
 * assignment supersession, deadline escalation, workload release/rebalance,
 * project completion/portfolio; +4 finance journeys — SLA scorecard/credit,
 * batched reconciliation, exact-sum cost allocation, renewal windows; +2
 * resilience journeys — provider fallback ladders, budget rebalance
 * proposals). The corpus is pure data; validation of its shape happens in
 * tests (unique ids, vocabulary membership, at least five assertions per
 * journey).
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

export const JOURNEYS: readonly AcceptanceJourney[] = [
  ...WORK_JOURNEYS,
  ...COMMERCE_JOURNEYS,
  ...ORG_JOURNEYS,
  ...HOST_JOURNEYS,
  ...GATEWAY_JOURNEYS,
  ...LIFECYCLE_JOURNEYS,
  ...FINANCE_JOURNEYS,
  ...RESILIENCE_JOURNEYS,
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
};
