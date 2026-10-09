/**
 * @fleetos/experience-safety-intel — the Safety + Intelligence experience
 * package (Wave 4 lane B, F240B).
 *
 * Presentation read-models over Worker B's domain packages — the experience
 * plane sits ABOVE the domain kernel, projected READ-ONLY:
 *   - `finding-views`   — security findings intake views: severity rollups,
 *     triage queues, remediation progress gated by evidence state.
 *   - `guardian-views`  — rule catalog with applicability summaries,
 *     capability-ceiling views ("ceilings are NOT authorizations", carried
 *     structurally), action-plan board with dead-letter visibility.
 *   - `inspect-views`   — decision-provenance ("why did this happen") views
 *     over actions/execution journals with tamper-evident digests.
 *   - `advisory-cards`  — predictive/world-context advisory presentation;
 *     `advisory: true` carried STRUCTURALLY through the view layer (law A2).
 *   - `command-intents` — typed intent builders producing CommandDraft
 *     records via a LOCAL structural seam mirroring the control-plane
 *     submit contract. Drafts never execute and never bypass Guardian.
 *
 * Determinism laws: no Date.now(), no Math.random(), no network, no timers.
 * Logical `now` and caller-supplied inputs everywhere. Tenant fail-closed
 * everywhere (law A8): missing or cross-tenant inputs refuse with NO partial
 * state.
 */

export * from "./finding-views.ts";
export * from "./guardian-views.ts";
export * from "./inspect-views.ts";
export * from "./advisory-cards.ts";
export * from "./command-intents.ts";

// ---------- Wave 8 (F280B) propagated-staleness advisory cards ----------

export * from "./staleness-cards.ts";
