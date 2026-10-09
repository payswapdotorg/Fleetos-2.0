/**
 * @fleetos/acceptance-commerce — the journey corpus (public `./journeys`).
 *
 * 21 journeys over the worker-C lane's REAL packages (F300C extended the
 * Wave 7 corpus from 15: +3 host-seam journeys, +2 gateway/role journeys,
 * +1 work-order blocking journey). The corpus is pure data; validation of
 * its shape happens in tests (unique ids, vocabulary membership, at least
 * one assertion per journey).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { WORK_JOURNEYS } from "./work.js";
import { COMMERCE_JOURNEYS } from "./commerce.js";
import { ORG_JOURNEYS } from "./org.js";
import { HOST_JOURNEYS } from "./host.js";
import { GATEWAY_JOURNEYS } from "./gateway.js";

export const JOURNEYS: readonly AcceptanceJourney[] = [
  ...WORK_JOURNEYS,
  ...COMMERCE_JOURNEYS,
  ...ORG_JOURNEYS,
  ...HOST_JOURNEYS,
  ...GATEWAY_JOURNEYS,
];

export { WORK_JOURNEYS, COMMERCE_JOURNEYS, ORG_JOURNEYS, HOST_JOURNEYS, GATEWAY_JOURNEYS };
