/**
 * @fleetos/experience-asset-field — asset views public module (F240A
 * deliverable 1: `./asset-views`).
 *
 * Barrel over the fleet overview and asset detail read-models; the split
 * keeps every source file under the repo's max-lines lint budget
 * (f230b-lint precedent). The exported surface is the deliverable.
 */

export * from "./asset-overview.js";
export * from "./asset-detail.js";
export type { ViewRejection, ViewResult } from "./view-support.js";
