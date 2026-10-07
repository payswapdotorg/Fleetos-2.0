/**
 * @fleetos/experience-work-commerce — public entry.
 *
 * The Work/Projects/Commerce experience plane (Wave 4 lane C, F240C):
 * pure, deterministic, tenant-scoped presentation read-models over the
 * work/projects/workloads/procurement/vendors/software/
 * agent-organizations/model-gateway domain surfaces — plus typed command
 * INTENT drafts that mirror the control-plane submit contract through a
 * LOCAL structural seam and never execute (Guardian adjudicates).
 *
 * Consumed through public entry points only (never deep paths); zero
 * runtime imports from TL or other lanes' packages. The experience plane
 * sits ABOVE the domain kernel, projected read-only: nothing here writes
 * domain truth.
 */

export const WORK_COMMERCE_SCHEMA_VERSION = 1;

export * from "./work-views.js";
export * from "./commerce-views.js";
export * from "./org-views.js";
export * from "./command-intents.js";
