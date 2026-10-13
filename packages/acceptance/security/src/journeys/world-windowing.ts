/**
 * F341B journey B2 — world-context windowing (persona:
 * site-reliability-engineer).
 *
 * CENSUS CITATION (F340 §1, candidate B2, verbatim row): "world-context
 * windowing | `packages/world-context/src/windowing.ts`
 * (projectWindowedWorkload, projectWindowedProject, isObservationMature,
 * filterMatureObservations) | staleness-window assertions exist
 * (reasoning.ts) but WINDOWING (context assembly windows) is NOT exercised
 * — distinct semantics | CANDIDATE B2". Re-verified at this lane's base
 * `5c2ba68`: the security corpus drives the assembly.ts family
 * (assembleContext) and the staleness family (classifyStaleness) but has
 * ZERO references to the windowing family. Honest census nuance (recorded
 * in the lane report): the TL-owned convergence suite binds
 * projectWindowedWorkload's happy path as scenario-seeding composition
 * glue (F290B); NO journey anywhere exercises the windowing LAWS — the
 * project projector, the maturity/horizon gate, the window boundaries, or
 * the windowing-vs-staleness distinction.
 *
 * The SRE proves the windowing laws over real observations:
 *   - windowed workload AND project projections carry ONLY in-window
 *     provenance ([windowStart, windowEnd] INCLUSIVE at both edges — one
 *     millisecond outside excludes), with the window and computedAt echoed
 *     verbatim and window integrity machine-verifiable
 *     (verifyWindowIntegrity; a forged projection with an out-of-window
 *     provenance entry is CAUGHT);
 *   - MATURITY GATING (the horizon discipline): never join an observation
 *     before producedAt + horizonMs. The boundary is inclusive (mature
 *     exactly at producedAt+horizon, immature one millisecond short); an
 *     immature observation NEVER joins the composed projection even when
 *     it sits INSIDE the window;
 *   - WINDOWING IS NOT STALENESS — both asserted on the same observations:
 *     a 10-minute-old observation is staleness-unknown yet legitimately
 *     included in a historical window (windowing selects by interval, not
 *     by age-vs-now); a 10-second-old observation is staleness-fresh yet
 *     IMMATURE for a 60s-horizon join. The two axes are independent —
 *     proven by divergence in both directions;
 *   - the degraded law: a projection over an empty window is degraded, and
 *     a negative utilization input degrades honestly.
 *
 * Determinism: the observation/window/now clocks are derived from the run
 * anchor (`ctx.startedAt`, the F331B seam — the reasoning.ts pattern)
 * through the fixture world's pure integer-math `isoOfEpochMs`; every
 * ASSERTED value is relative (counts, refs, classes, booleans) — the
 * journey is byte-identical at any anchor by construction (the census's
 * invariant class). No clock, no randomness, no network.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  filterMatureObservations,
  isObservationMature,
  projectWindowedProject,
  projectWindowedWorkload,
  verifyWindowIntegrity,
} from "@fleetos/world-context";
import type { ObservationProvenance, WindowedWorkloadProjection } from "@fleetos/world-context";
import { classifyStaleness } from "@fleetos/world-model";
import { STALENESS_THRESHOLDS, TENANT, isoOfEpochMs } from "./fixture-world.ts";

/** The windowing horizon for this journey's joins (60s — a real horizon). */
const HORIZON_MS = 60_000;

/** ISO clock at `now + offsetMs` (pure integer math — anchor-derived). */
function at(now: number, offsetMs: number): string {
  return isoOfEpochMs(now + offsetMs);
}

/** An observation provenance at `now + offsetMs`. */
function obs(now: number, ref: string, offsetMs: number, sensorKind = "vibration"): ObservationProvenance {
  return { observationRef: ref, observedAt: at(now, offsetMs), observer: "sensor-pump-7", sensorKind };
}

export const worldContextWindowingJourney: AcceptanceJourney = {
  journeyId: "security.world-context-windowing",
  persona: "site-reliability-engineer",
  capabilities: ["reasoning-context"],
  goal: "Prove windowed context projections: inclusive window boundaries, horizon-gated maturity, and the windowing-vs-staleness distinction",
  steps: [
    {
      stepId: "windowed-workload-projection",
      kind: "projection",
      description: "Project the workload over a real window; only in-window observations carry provenance, echoed verbatim",
      packages: ["@fleetos/world-context"],
      operations: ["projectWindowedWorkload", "verifyWindowIntegrity"],
      run: (ctx) => {
        const now = ctx.startedAt;
        // Window A: [now-300s, now-60s] — both edges land exactly on w-2 and w-4.
        const windowStart = at(now, -300_000);
        const windowEnd = at(now, -60_000);
        const computedAt = at(now, 0);
        const workload = projectWindowedWorkload({
          tenant: TENANT,
          workloadId: "wl-pump-7-maintenance",
          assetIds: ["pump-7"],
          workItemRefs: [{ workItemId: "wi-line-3-a" }],
          projectRefs: [{ projectId: "proj-line-3" }],
          observations: [
            obs(now, "obs-w-1", -600_000),
            obs(now, "obs-w-2", -300_000),
            obs(now, "obs-w-3", -120_000),
            obs(now, "obs-w-4", -60_000),
            obs(now, "obs-w-5", -10_000, "temperature"),
          ],
          utilization: 0.72,
          computedAt,
          windowStart,
          windowEnd,
        });
        ctx.record("wl.windowStartEchoed", workload.windowStart === windowStart);
        ctx.record("wl.windowEndEchoed", workload.windowEnd === windowEnd);
        ctx.record("wl.computedAtEchoed", workload.computedAt === computedAt);
        ctx.record("wl.provenanceRefs", workload.provenance.map((p) => p.observationRef));
        ctx.record("wl.provenanceCount", workload.provenance.length);
        ctx.record("wl.utilization", workload.utilization);
        ctx.record("wl.degraded", workload.degraded);
        ctx.record("wl.schemaVersion", workload.schemaVersion);
        ctx.record("wl.assetIds", workload.assetIds);
        ctx.record("wl.workItemCount", workload.workItemRefs.length);
        ctx.record("wl.tenant", workload.tenant.tenantId);
        const integrity = verifyWindowIntegrity(workload);
        ctx.record("wl.integrityOk", integrity.ok);
        ctx.record("wl.integrityOutOfWindow", integrity.outOfWindow);
        ctx.record("wl.beforeWindowExcluded", !workload.provenance.some((p) => p.observationRef === "obs-w-1"));
        ctx.record("wl.afterWindowExcluded", !workload.provenance.some((p) => p.observationRef === "obs-w-5"));
      },
    },
    {
      stepId: "window-boundary-honesty",
      kind: "negative-check",
      description: "Window edges are inclusive to the millisecond; empty windows and negative utilization degrade honestly; a forged out-of-window provenance entry is caught",
      packages: ["@fleetos/world-context"],
      operations: ["projectWindowedWorkload", "verifyWindowIntegrity"],
      run: (ctx) => {
        const now = ctx.startedAt;
        const observations = [
          obs(now, "obs-w-2", -300_000),
          obs(now, "obs-w-3", -120_000),
          obs(now, "obs-w-4", -60_000),
        ];
        const base = {
          tenant: TENANT,
          workloadId: "wl-boundary-probe",
          assetIds: ["pump-7"],
          workItemRefs: [],
          projectRefs: [],
          observations,
          utilization: 0.5,
          computedAt: at(now, 0),
        };
        const project = (windowStart: string, windowEnd: string): WindowedWorkloadProjection =>
          projectWindowedWorkload({ ...base, windowStart, windowEnd });

        // Both edges inclusive: w-2 sits exactly on windowStart, w-4 on windowEnd.
        const inclusive = project(at(now, -300_000), at(now, -60_000));
        ctx.record("edge.startInclusive", inclusive.provenance.some((p) => p.observationRef === "obs-w-2"));
        ctx.record("edge.endInclusive", inclusive.provenance.some((p) => p.observationRef === "obs-w-4"));
        // One millisecond tighter excludes the edge observation entirely.
        const startPlusOne = project(at(now, -299_999), at(now, -60_000));
        ctx.record("edge.oneMsAfterStartExcluded", !startPlusOne.provenance.some((p) => p.observationRef === "obs-w-2"));
        const endMinusOne = project(at(now, -300_000), at(now, -60_001));
        ctx.record("edge.oneMsBeforeEndExcluded", !endMinusOne.provenance.some((p) => p.observationRef === "obs-w-4"));
        // An empty window (between w-3 and w-4) degrades honestly.
        const empty = project(at(now, -119_000), at(now, -61_000));
        ctx.record("edge.emptyWindowProvenance", empty.provenance.length);
        ctx.record("edge.emptyWindowDegraded", empty.degraded);
        // Negative utilization degrades even with a full window.
        const negative = projectWindowedWorkload({
          ...base,
          utilization: -0.5,
          windowStart: at(now, -300_000),
          windowEnd: at(now, -60_000),
        });
        ctx.record("edge.negativeUtilizationDegraded", negative.degraded);
        // A FORGED projection (an out-of-window provenance entry injected
        // after the fact) is caught by the integrity verifier.
        const genuine = project(at(now, -300_000), at(now, -60_000));
        const forged: WindowedWorkloadProjection = {
          ...genuine,
          provenance: [...genuine.provenance, obs(now, "obs-w-5", -10_000)],
        };
        const forgedCheck = verifyWindowIntegrity(forged);
        ctx.record("edge.forgedCaught", !forgedCheck.ok);
        ctx.record("edge.forgedOutOfWindow", forgedCheck.outOfWindow);
        ctx.record("edge.genuineIntegrityOk", verifyWindowIntegrity(genuine).ok);
      },
    },
    {
      stepId: "maturity-gating",
      kind: "context-assembly",
      description: "Horizon discipline: the boundary is inclusive, an immature observation NEVER joins — even inside the window",
      packages: ["@fleetos/world-context"],
      operations: ["isObservationMature", "filterMatureObservations", "projectWindowedWorkload"],
      run: (ctx) => {
        const now = ctx.startedAt;
        const observations = [
          obs(now, "obs-w-1", -600_000),
          obs(now, "obs-w-2", -300_000),
          obs(now, "obs-w-3", -120_000),
          obs(now, "obs-w-4", -60_000),
          obs(now, "obs-w-5", -10_000),
        ];
        // The boundary: mature exactly at producedAt + horizon; one ms short is immature.
        ctx.record("mat.boundaryMature", isObservationMature(at(now, -60_000), HORIZON_MS, at(now, 0)));
        ctx.record("mat.boundaryOneMsShortImmature", !isObservationMature(at(now, -60_000), HORIZON_MS, at(now, -1)));

        const mature = filterMatureObservations(observations, HORIZON_MS, at(now, 0));
        ctx.record("mat.filterRefs", mature.map((m) => m.observationRef));
        ctx.record("mat.filterCount", mature.length);
        ctx.record("mat.immatureRefused", !mature.some((m) => m.observationRef === "obs-w-5"));

        // COMPOSITION LAW: windowing over the MATURE set — the immature
        // observation sits INSIDE this wider window yet never joins.
        const windowStart = at(now, -300_000);
        const windowEnd = at(now, 0);
        const inWindow = observations.filter((o) => o.observedAt >= windowStart && o.observedAt <= windowEnd);
        ctx.record("mat.compositionInWindowCount", inWindow.length);
        const joined = projectWindowedWorkload({
          tenant: TENANT,
          workloadId: "wl-horizon-gated",
          assetIds: ["pump-7"],
          workItemRefs: [],
          projectRefs: [],
          observations: mature,
          utilization: 0.6,
          computedAt: at(now, 0),
          windowStart,
          windowEnd,
        });
        ctx.record("mat.compositionJoinedRefs", joined.provenance.map((p) => p.observationRef));
        ctx.record("mat.compositionJoinedCount", joined.provenance.length);
        ctx.record(
          "mat.immatureInWindowNeverJoins",
          joined.provenance.every((p) => p.observationRef !== "obs-w-5"),
        );
        ctx.record("mat.joinedIntegrityOk", verifyWindowIntegrity(joined).ok);
      },
    },
    {
      stepId: "windowing-vs-staleness",
      kind: "view-read",
      description: "Windowing is NOT staleness: an unknown-class observation joins a historical window; a fresh-class observation is refused by the horizon",
      packages: ["@fleetos/world-context", "@fleetos/world-model"],
      operations: ["classifyStaleness", "projectWindowedWorkload"],
      run: (ctx) => {
        const now = ctx.startedAt;
        // DIVERGENCE 1: the 10-minute-old observation — staleness says
        // unknown (age 600s > the 60s staleness window)...
        const oldClass = classifyStaleness(now - 600_000, now, STALENESS_THRESHOLDS);
        if (!oldClass.ok) throw new Error("staleness classification refused");
        ctx.record("st.oldObsClass", oldClass.staleness);
        ctx.record("st.oldObsAgeMs", oldClass.ageMs);
        // ...yet a HISTORICAL analysis window legitimately includes it.
        const historical = projectWindowedWorkload({
          tenant: TENANT,
          workloadId: "wl-historical-analysis",
          assetIds: ["pump-7"],
          workItemRefs: [],
          projectRefs: [],
          observations: [obs(now, "obs-w-1", -600_000), obs(now, "obs-w-2", -300_000)],
          utilization: 0.4,
          computedAt: at(now, 0),
          windowStart: at(now, -700_000),
          windowEnd: at(now, -500_000),
        });
        ctx.record("st.oldObsInHistoricalWindow", historical.provenance.some((p) => p.observationRef === "obs-w-1"));
        ctx.record(
          "st.unknownYetWindowed",
          oldClass.staleness === "unknown" && historical.provenance.some((p) => p.observationRef === "obs-w-1"),
        );
        // DIVERGENCE 2: the 10-second-old observation — staleness says
        // fresh (age exactly at the fresh threshold, inclusive)...
        const freshClass = classifyStaleness(now - 10_000, now, STALENESS_THRESHOLDS);
        if (!freshClass.ok) throw new Error("staleness classification refused");
        ctx.record("st.freshObsClass", freshClass.staleness);
        ctx.record("st.freshObsAgeMs", freshClass.ageMs);
        // ...yet the 60s horizon gate REFUSES it for the join.
        ctx.record("st.freshObsMature", isObservationMature(at(now, -10_000), HORIZON_MS, at(now, 0)));
        ctx.record(
          "st.freshYetRefused",
          freshClass.staleness === "fresh" && !isObservationMature(at(now, -10_000), HORIZON_MS, at(now, 0)),
        );
      },
    },
    {
      stepId: "windowed-project-projection",
      kind: "projection",
      description: "Project the project over a real window — active work items, assets and window-filtered provenance",
      packages: ["@fleetos/world-context"],
      operations: ["projectWindowedProject", "verifyWindowIntegrity"],
      run: (ctx) => {
        const now = ctx.startedAt;
        const windowStart = at(now, -300_000);
        const windowEnd = at(now, -120_000);
        const computedAt = at(now, 0);
        const project = projectWindowedProject({
          tenant: TENANT,
          project: { projectId: "proj-line-3" },
          workItems: [{ workItemId: "wi-line-3-a" }, { workItemId: "wi-line-3-b" }],
          assetIds: ["pump-7", "pump-8"],
          observations: [
            obs(now, "obs-w-1", -600_000),
            obs(now, "obs-w-2", -300_000),
            obs(now, "obs-w-3", -120_000),
            obs(now, "obs-w-4", -60_000),
          ],
          computedAt,
          windowStart,
          windowEnd,
        });
        ctx.record("proj.projectId", project.project.projectId);
        ctx.record("proj.activeWorkItems", project.activeWorkItems);
        ctx.record("proj.assetIds", project.assetIds);
        ctx.record("proj.provenanceRefs", project.provenance.map((p) => p.observationRef));
        ctx.record("proj.provenanceCount", project.provenance.length);
        ctx.record("proj.schemaVersion", project.schemaVersion);
        ctx.record("proj.windowStartEchoed", project.windowStart === windowStart);
        ctx.record("proj.windowEndEchoed", project.windowEnd === windowEnd);
        ctx.record("proj.computedAtEchoed", project.computedAt === computedAt);
        ctx.record("proj.integrityOk", verifyWindowIntegrity(project).ok);
        ctx.record("proj.tenant", project.tenant.tenantId);
      },
    },
  ],
  assertions: [
    { assertionId: "ww-1", description: "The projection echoes windowStart verbatim", path: "wl.windowStartEchoed", expected: true },
    { assertionId: "ww-2", description: "The projection echoes windowEnd verbatim", path: "wl.windowEndEchoed", expected: true },
    { assertionId: "ww-3", description: "The projection echoes computedAt verbatim", path: "wl.computedAtEchoed", expected: true },
    { assertionId: "ww-4", description: "Only the three in-window observations carry provenance (both edge observations included)", path: "wl.provenanceRefs", expected: ["obs-w-2", "obs-w-3", "obs-w-4"] },
    { assertionId: "ww-5", description: "In-window provenance count", path: "wl.provenanceCount", expected: 3 },
    { assertionId: "ww-6", description: "Utilization carried unchanged", path: "wl.utilization", expected: 0.72 },
    { assertionId: "ww-7", description: "A populated window does not degrade", path: "wl.degraded", expected: false },
    { assertionId: "ww-8", description: "The windowed projection carries the schema version", path: "wl.schemaVersion", expected: "1.0.0" },
    { assertionId: "ww-9", description: "Asset ids carried", path: "wl.assetIds", expected: ["pump-7"] },
    { assertionId: "ww-10", description: "Work-item refs carried", path: "wl.workItemCount", expected: 1 },
    { assertionId: "ww-11", description: "The projection is tenant-scoped", path: "wl.tenant", expected: "acme-ops" },
    { assertionId: "ww-12", description: "Window integrity verifies (zero out-of-window)", path: "wl.integrityOk", expected: true },
    { assertionId: "ww-13", description: "Out-of-window count is zero on the real projection", path: "wl.integrityOutOfWindow", expected: 0 },
    { assertionId: "ww-14", description: "The observation before windowStart is excluded", path: "wl.beforeWindowExcluded", expected: true },
    { assertionId: "ww-15", description: "The observation after windowEnd is excluded", path: "wl.afterWindowExcluded", expected: true },
    { assertionId: "ww-16", description: "An observation exactly at windowStart is INCLUDED (inclusive edge)", path: "edge.startInclusive", expected: true },
    { assertionId: "ww-17", description: "An observation exactly at windowEnd is INCLUDED (inclusive edge)", path: "edge.endInclusive", expected: true },
    { assertionId: "ww-18", description: "One millisecond past windowStart excludes the edge observation", path: "edge.oneMsAfterStartExcluded", expected: true },
    { assertionId: "ww-19", description: "One millisecond before windowEnd excludes the edge observation", path: "edge.oneMsBeforeEndExcluded", expected: true },
    { assertionId: "ww-20", description: "An empty window yields zero provenance", path: "edge.emptyWindowProvenance", expected: 0 },
    { assertionId: "ww-21", description: "An empty window degrades honestly", path: "edge.emptyWindowDegraded", expected: true },
    { assertionId: "ww-22", description: "Negative utilization degrades honestly", path: "edge.negativeUtilizationDegraded", expected: true },
    { assertionId: "ww-23", description: "A forged out-of-window provenance entry is CAUGHT", path: "edge.forgedCaught", expected: true },
    { assertionId: "ww-24", description: "The forged projection reports exactly one out-of-window entry", path: "edge.forgedOutOfWindow", expected: 1 },
    { assertionId: "ww-25", description: "The genuine projection's integrity is ok (contrast with the forgery)", path: "edge.genuineIntegrityOk", expected: true },
    { assertionId: "ww-26", description: "Mature exactly at producedAt + horizon (inclusive boundary)", path: "mat.boundaryMature", expected: true },
    { assertionId: "ww-27", description: "One millisecond short of the horizon is immature", path: "mat.boundaryOneMsShortImmature", expected: true },
    { assertionId: "ww-28", description: "The maturity filter keeps exactly the four at-or-past-horizon observations", path: "mat.filterRefs", expected: ["obs-w-1", "obs-w-2", "obs-w-3", "obs-w-4"] },
    { assertionId: "ww-29", description: "Mature count", path: "mat.filterCount", expected: 4 },
    { assertionId: "ww-30", description: "REFUSAL: the immature observation is refused by the horizon gate", path: "mat.immatureRefused", expected: true },
    { assertionId: "ww-31", description: "The composition window contains four observations (incl. the immature one)", path: "mat.compositionInWindowCount", expected: 4 },
    { assertionId: "ww-32", description: "REFUSAL: the immature observation NEVER joins the composed projection (3 of 4 windowed)", path: "mat.compositionJoinedCount", expected: 3 },
    { assertionId: "ww-33", description: "The joined provenance is exactly the mature in-window set", path: "mat.compositionJoinedRefs", expected: ["obs-w-2", "obs-w-3", "obs-w-4"] },
    { assertionId: "ww-34", description: "The horizon-gated projection still verifies window integrity", path: "mat.joinedIntegrityOk", expected: true },
    { assertionId: "ww-35", description: "The 10-minute-old observation is staleness-unknown (beyond the 60s staleness window)", path: "st.oldObsClass", expected: "unknown" },
    { assertionId: "ww-36", description: "Its age is surfaced exactly (600s)", path: "st.oldObsAgeMs", expected: 600000 },
    { assertionId: "ww-37", description: "...yet the HISTORICAL window legitimately includes it (windowing selects by interval)", path: "st.oldObsInHistoricalWindow", expected: true },
    { assertionId: "ww-38", description: "DISTINCTION: unknown-class yet windowed — windowing is NOT staleness", path: "st.unknownYetWindowed", expected: true },
    { assertionId: "ww-39", description: "The 10-second-old observation is staleness-fresh (inclusive fresh threshold)", path: "st.freshObsClass", expected: "fresh" },
    { assertionId: "ww-40", description: "Its age is surfaced exactly (10s)", path: "st.freshObsAgeMs", expected: 10000 },
    { assertionId: "ww-41", description: "...yet it is NOT mature for a 60s-horizon join", path: "st.freshObsMature", expected: false },
    { assertionId: "ww-42", description: "DISTINCTION: fresh-class yet horizon-refused — staleness is NOT the join gate", path: "st.freshYetRefused", expected: true },
    { assertionId: "ww-43", description: "The windowed project projection carries the project id", path: "proj.projectId", expected: "proj-line-3" },
    { assertionId: "ww-44", description: "Active work items counted", path: "proj.activeWorkItems", expected: 2 },
    { assertionId: "ww-45", description: "Project asset ids carried", path: "proj.assetIds", expected: ["pump-7", "pump-8"] },
    { assertionId: "ww-46", description: "The project projection windows its provenance to the two in-window observations", path: "proj.provenanceRefs", expected: ["obs-w-2", "obs-w-3"] },
    { assertionId: "ww-47", description: "Project provenance count", path: "proj.provenanceCount", expected: 2 },
    { assertionId: "ww-48", description: "The project projection carries the schema version", path: "proj.schemaVersion", expected: "1.0.0" },
    { assertionId: "ww-49", description: "The project projection echoes windowStart verbatim", path: "proj.windowStartEchoed", expected: true },
    { assertionId: "ww-50", description: "The project projection echoes windowEnd verbatim", path: "proj.windowEndEchoed", expected: true },
    { assertionId: "ww-51", description: "The project projection echoes computedAt verbatim", path: "proj.computedAtEchoed", expected: true },
    { assertionId: "ww-52", description: "The project projection's window integrity verifies", path: "proj.integrityOk", expected: true },
    { assertionId: "ww-53", description: "The project projection is tenant-scoped", path: "proj.tenant", expected: "acme-ops" },
  ],
};
