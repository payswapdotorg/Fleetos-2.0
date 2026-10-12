/**
 * @fleetos/acceptance-commerce — the journey corpus (public `./journeys`).
 *
 * 36 journeys over the worker-C lane's REAL packages (F300C extended the
 * Wave 7 corpus 15 → 21; F310C extended 21 → 31; F321C extends 31 → 34;
 * F331C extends 34 → 36: +1 marketplace-transaction-flow — the row-34
 * ordering/checkout state machine over published listings through the
 * REAL publication gate and the REAL procurement transaction API with
 * anchored absolute order windows; +1 tenant-billing-invoicing — the
 * row-35 seat/consumption billing over the REAL usage ledger
 * (appendUsage through the documented budget-port seam) and the REAL
 * software invoice-issuance module). The corpus is pure data;
 * validation of its shape happens in tests (unique ids, vocabulary
 * membership, at least five assertions per journey).
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
import { MARKETPLACE_TRANSACTION_JOURNEYS } from "./marketplace-transactions.js";
import { TENANT_BILLING_JOURNEYS } from "./tenant-billing.js";

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
  ...MARKETPLACE_TRANSACTION_JOURNEYS,
  ...TENANT_BILLING_JOURNEYS,
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
  MARKETPLACE_TRANSACTION_JOURNEYS,
  TENANT_BILLING_JOURNEYS,
};
