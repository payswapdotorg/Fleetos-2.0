/**
 * @fleetos/acceptance-commerce — the journey corpus (public `./journeys`).
 *
 * 41 journeys over the worker-C lane's REAL packages (F300C extended the
 * Wave 7 corpus 15 → 21; F310C extended 21 → 31; F321C extends 31 → 34;
 * F331C extends 34 → 36; F351C extends 36 → 41: +1 procurement-order-
 * authorization — the REAL ProcurementDirectory application service over
 * the REAL in-memory repository (accepted-quote gate + law-A5 Guardian
 * authorization + audit events + fail-closed cross-tenant reads); +1
 * vendor-matching-discipline — the REAL matching engine through the REAL
 * directory (score composition, matched tags, RECORDED tie-break rules,
 * tenant fail-closed); +1 quote-comparison-discipline — the REAL
 * commerce-math compareQuotes kernel (integer-bps decomposition, recorded
 * tie-break rules, honest refusals); +1 vendor-fulfillment-kpi-rollup —
 * the REAL rollupVendorKpis + capabilityCatalogSummary read models
 * (on-time ratio + fill rate in integer bps, declared/verified counts);
 * +1 procurement-idempotent-creation — the REAL createDocumentIdempotent
 * + computeRequestDigest discipline. The corpus is pure data;
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
import { F351C_PROCUREMENT_JOURNEYS } from "./f351c-procurement.js";
import { F351C_VENDOR_JOURNEYS } from "./f351c-vendors.js";

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
  ...F351C_PROCUREMENT_JOURNEYS,
  ...F351C_VENDOR_JOURNEYS,
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
  F351C_PROCUREMENT_JOURNEYS,
  F351C_VENDOR_JOURNEYS,
};
