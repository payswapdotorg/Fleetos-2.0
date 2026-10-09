/**
 * @fleetos/experience-safety-intel/host — the HostSurface adapter (F300B
 * deliverable 1, subpath export `./host` per WAVE10-HOST-CONTRACT §2).
 *
 * `SAFETY_INTEL_HOST_SURFACE` is THE seam the TL's F301 shell mounts:
 *
 *   - `surfaceId: "safety-intel"` — stable, never renumbered;
 *   - `routes` — the 7 F300B route manifest (findings board, evidence chain,
 *     Guardian decision view, action authorization, execution results +
 *     audit trail, inspect-why, advisory board);
 *   - `buildViewModels(slice, ctx)` — pure, deterministic view models over
 *     the lane's REAL read-models, tenant fail-closed, honest not-composed
 *     markers for optional sections;
 *   - `intents` — the UI-event catalog bound to the lane's EXISTING inert
 *     CommandDraft builders (`buildHostIntentDraft` dispatches them).
 *
 * Inert-intent law, machine-tested: this module exports NO submit, execute,
 * dispatch, or enqueue function of any kind — drafts are values, and
 * binding them to the real control-plane submit is TL composition.
 */

import type { HostSurface } from "./contract.ts";
import { SAFETY_INTEL_INTENTS, SAFETY_INTEL_ROUTES } from "./contract.ts";
import { buildViewModels } from "./view-models.ts";
import type {
  SafetyIntelHostResult,
  SafetyIntelSlice,
} from "./view-models.ts";

export * from "./contract.ts";
export * from "./honesty.ts";
export * from "./evidence-view.ts";
export * from "./execution-view.ts";
export * from "./advisory-route.ts";
export * from "./intents.ts";
export * from "./view-models.ts";

/**
 * The safety/intelligence HostSurface — the single mounted seam. Generic
 * parameters pinned: Slice = SafetyIntelSlice (the lane's real read-models),
 * VM = SafetyIntelHostResult (the honest ok/refused view-model value).
 */
export const SAFETY_INTEL_HOST_SURFACE: HostSurface<SafetyIntelSlice, SafetyIntelHostResult> = {
  surfaceId: "safety-intel",
  surfaceKind: "lane-experience",
  routes: SAFETY_INTEL_ROUTES,
  buildViewModels,
  intents: SAFETY_INTEL_INTENTS,
};
