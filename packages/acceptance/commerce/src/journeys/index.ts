/**
 * @fleetos/acceptance-commerce — the journey corpus (public `./journeys`).
 *
 * 49 journeys over the worker-C lane's REAL packages (F300C extended the
 * Wave 7 corpus 15 → 21; F310C extended 21 → 31; F321C extends 31 → 34;
 * F331C extends 34 → 36; F351C extends 36 → 41 (the five commerce-
 * discipline journeys); F361C extends 41 → 45: +1 marketplace-request-
 * lifecycle — the REAL §3.1 equipment-request machine (idempotent
 * create/submit keyed tenant+natural key, typed transitions, illegal-
 * transition refusals, fail-closed reads); +1 marketplace-offer-
 * freshness-discipline — the REAL §3.2 offer schema + THE FRESHNESS LAW
 * (expired offers never silently appear current) + the comparison
 * composing the EXISTING compareQuotes/matchVendors kernels with
 * hard-constraint vs preference-weight separation; +1 marketplace-
 * supplier-verification-gate — the REAL §3.3 machine (verified-only
 * enter matching) + the PLAINLY-LABELLED manual catalogue import seam;
 * +1 marketplace-order-ack-discipline — the REAL §3.4 order lifecycle
 * with the manual provider-ack seam (idempotent, duplicate-event-
 * refusing) composed with the REAL work package's service-completion
 * accept gate. F362 (the TL-delegated E2E lane) extends 45 → 46: +1
 * marketplace-transaction-spine — the deterministic transaction-spine
 * journey through the REAL public APIs of ALL THREE Wave-17 lanes (the
 * F361B approval/evidence surfaces + the F361A receipt/enrollment
 * surfaces driven from the commerce corpus for the first time, composed
 * over the F361C chain; a refusal asserted at every gate; fixture-
 * labelled, never live). The corpus is pure data; validation of its shape
 * happens in tests (unique ids, vocabulary membership, at least five
 * assertions per journey).
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
import { F361C_PROCUREMENT_JOURNEYS } from "./f361c-procurement.js";
import { F361C_VENDOR_JOURNEYS } from "./f361c-vendors.js";
import { F361C_ORDER_JOURNEYS } from "./f361c-order.js";
import { F362_SPINE_JOURNEYS } from "./f362-spine.js";
import { F370C_PERSISTENCE_JOURNEYS } from "./f370c-persistence.js";
import { F370C_AUTHORIZATION_JOURNEYS } from "./f370c-authorization.js";
import { F370C_BACKUP_JOURNEYS } from "./f370c-backup-restore.js";

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
  ...F361C_PROCUREMENT_JOURNEYS,
  ...F361C_VENDOR_JOURNEYS,
  ...F361C_ORDER_JOURNEYS,
  ...F362_SPINE_JOURNEYS,
  ...F370C_PERSISTENCE_JOURNEYS,
  ...F370C_AUTHORIZATION_JOURNEYS,
  ...F370C_BACKUP_JOURNEYS,
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
  F370C_PERSISTENCE_JOURNEYS,
  F370C_AUTHORIZATION_JOURNEYS,
  F370C_BACKUP_JOURNEYS,
  MARKETPLACE_JOURNEYS,
  ACTOR_JOBS_JOURNEYS,
  MARKETPLACE_TRANSACTION_JOURNEYS,
  TENANT_BILLING_JOURNEYS,
  F351C_PROCUREMENT_JOURNEYS,
  F351C_VENDOR_JOURNEYS,
  F361C_PROCUREMENT_JOURNEYS,
  F361C_VENDOR_JOURNEYS,
  F361C_ORDER_JOURNEYS,
  F362_SPINE_JOURNEYS,
};
