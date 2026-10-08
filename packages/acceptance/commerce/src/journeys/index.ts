/**
 * @fleetos/acceptance-commerce — the journey corpus (public `./journeys`).
 *
 * 14 journeys over the worker-C lane's REAL packages. The corpus is pure
 * data; validation of its shape happens in tests (unique ids, vocabulary
 * membership, at least one assertion per journey).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { WORK_JOURNEYS } from "./work.js";
import { COMMERCE_JOURNEYS } from "./commerce.js";
import { ORG_JOURNEYS } from "./org.js";

export const JOURNEYS: readonly AcceptanceJourney[] = [
  ...WORK_JOURNEYS,
  ...COMMERCE_JOURNEYS,
  ...ORG_JOURNEYS,
];

export { WORK_JOURNEYS, COMMERCE_JOURNEYS, ORG_JOURNEYS };
