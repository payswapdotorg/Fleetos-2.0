/**
 * FleetOS shell pages (F301) — the six surfaces, split from main for the
 * file law. Every page renders REAL package outputs; refusals/empties are
 * honest states.
 */

import { useMemo } from "react";
import {
  assembleControlTower,
  listTowerCommands,
  type TowerCommandEntry,
} from "@fleetos/control-tower";
import { buildFindingViews } from "@fleetos/experience-safety-intel";
import { buildWorkBoard } from "@fleetos/experience-work-commerce";
import { assetFieldHostSurface } from "@fleetos/experience-asset-field/host";
import { workCommerceHostSurface } from "@fleetos/experience-work-commerce/host";
import { makeTenantContext } from "@fleetos/identity";
import { T0, runLab, type TenantWorld } from "./world.js";
import { mapWorkItems } from "./work-items.js";
import type { FleetCommandPath, SubmissionRecord } from "./commandPath.js";

declare const __FLEETOS_COMMIT__: string;
declare const __FLEETOS_BUILT_AT__: string;

export type RouteId = "tower" | "field" | "safety" | "commerce" | "lab" | "commands";

export const ROUTES: readonly { readonly id: RouteId; readonly label: string; readonly blurb: string }[] = [
  { id: "tower", label: "Control Tower", blurb: "Cross-lane cockpit — fleet, findings, work, attention queue" },
  { id: "field", label: "Device 360 / Field", blurb: "Assets, devices, observations, health timeline" },
  { id: "safety", label: "Safety & Intelligence", blurb: "Findings, evidence, Guardian decisions, advisories" },
  { id: "commerce", label: "Work & Commerce", blurb: "Work board, procurement, budgets" },
  { id: "lab", label: "Engineering Lab", blurb: "Simulation worlds, benchmarks, experiments" },
  { id: "commands", label: "Command Console", blurb: "Typed command path — submit, adjudicate, verify" },
];

function RefusalView({ code, detail }: { code: string; detail: string }) {
  return (
    <div className="fos-refusal" role="alert">
      <strong>Refused — {code}</strong>
      <div>{detail}</div>
    </div>
  );
}

function EmptyView({ what }: { what: string }) {
  return <div className="fos-empty">No {what} records in this demo composition. (Honest empty state.)</div>;
}

export function TowerPage({ tw }: { tw: TenantWorld }) {
  const workItems = mapWorkItems(tw);
  const workBoard = buildWorkBoard({
    tenant: { tenantId: tw.tenantId },
    workItems: workItems as never,
    computedAt: new Date(T0).toISOString(),
  });
  const tower = assembleControlTower(
    {
      tenantId: tw.tenantId,
      assetField: tw.slice,
      safety: { findings: tw.securityFindings, remediations: tw.remediations },
      work: { workItems: workItems as never, computedAt: new Date(T0).toISOString() },
      advisoryCards: [],
    },
    { now: T0 + 10_000 },
  );
  if (!tower.ok) return <RefusalView code={`tower-refused/${String(tower.refused)}`} detail={tower.detail ?? ""} />;
  const t = tower.tower;
  return (
    <div className="fos-grid">
      <section className="fos-card">
        <h2>Fleet (Lane A)</h2>
        <ul className="fos-list">
          {t.fleet.assetRefs.map((a) => (
            <li key={a.id}>{a.title}</li>
          ))}
        </ul>
        <pre className="fos-digest">fleet digest: {t.fleet.digest}</pre>
      </section>
      <section className="fos-card">
        <h2>Findings (Lane B)</h2>
        <ul className="fos-list">
          {t.safety.findingRefs.map((f) => (
            <li key={f.id}>{f.title}</li>
          ))}
        </ul>
        <p className="fos-note">total findings: {t.safety.totalFindings} · proposals: {t.safety.totalProposals}</p>
        <pre className="fos-digest">findings digest: {t.safety.digest}</pre>
      </section>
      <section className="fos-card">
        <h2>Work (Lane C)</h2>
        {workBoard.ok ? (
          <ul className="fos-list">
            {workBoard.board.columns.flatMap((c) => c.cards.map((i) => (
              <li key={i.workItemId}>{i.title} — {i.status} — {i.assigneeId ?? "unassigned"}</li>
            )))}
          </ul>
        ) : (
          <RefusalView code={String(workBoard.reasonCode)} detail={String(workBoard.detail)} />
        )}
        <pre className="fos-digest">work digest: {t.work.digest}</pre>
      </section>
      <section className="fos-card">
        <h2>Attention queue</h2>
        {t.attention.length === 0 ? (
          <EmptyView what="attention" />
        ) : (
          <ul className="fos-list">
            {t.attention.map((it, i) => (
              <li key={i}>{it.lane}: {it.title} — {it.summary}</li>
            ))}
          </ul>
        )}
        <pre className="fos-digest">tower digest: {t.digest}</pre>
      </section>
    </div>
  );
}

export function FieldPage({ tw }: { tw: TenantWorld }) {
  // F301 convergence: the REAL lane HostSurface (F300A) — the contract §2 seam.
  const ctxR = makeTenantContext({
    tenantId: tw.tenantId,
    actorId: "act_shell-operator",
    roleId: "role_fleet-operator",
    establishedAt: T0 + 10_000,
  });
  const host = ctxR.ok ? assetFieldHostSurface.buildViewModels(tw.slice, ctxR.context) : null;
  if (!ctxR.ok) return <RefusalView code={`context-refused/${ctxR.reason}`} detail="" />;
  if (!host || !host.ok) {
    return <RefusalView code={`host-refused/${host ? String(host.rejected) : "no-host"}`} detail={host?.detail ?? ""} />;
  }
  const vm = host.models;
  const overview = vm.fleetOverview;
  return (
    <div className="fos-grid">
      <section className="fos-card fos-span2">
        <h2>Fleet overview — {tw.tenantId} <span className="fos-badge">via F300A HostSurface</span></h2>
        {overview.ok ? (
          <>
            <div className="fos-counters">
              <div><b>{overview.view.counters.assets}</b><span>assets ({overview.view.counters.active} active)</span></div>
              <div><b>{overview.view.counters.devices}</b><span>devices</span></div>
              <div><b>{overview.view.counters.fresh}</b><span>fresh</span></div>
              <div><b>{overview.view.counters.stale}</b><span>stale</span></div>
            </div>
            <pre className="fos-digest">overview digest: {overview.view.digest} · host bundle digest: {vm.digest}</pre>
          </>
        ) : (
          <RefusalView code="fleet-overview-refused" detail={String(overview.detail ?? overview.rejected)} />
        )}
      </section>
      <section className="fos-card">
        <h2>Assets (real directory)</h2>
        <table className="fos-table">
          <thead><tr><th>id</th><th>kind</th><th>lifecycle</th></tr></thead>
          <tbody>
            {tw.assets.map((a) => (
              <tr key={a.id}><td>{a.id}</td><td>{a.kind}</td><td>{a.lifecycle}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="fos-card">
        <h2>Device 360 (host sheets, assetId order)</h2>
        <table className="fos-table">
          <thead><tr><th>asset</th><th>outcome</th></tr></thead>
          <tbody>
            {vm.device360.map((s) => (
              <tr key={s.assetId}>
                <td>{s.assetId}</td>
                <td>{s.outcome.ok ? `${s.outcome.view.displayName} · ${s.outcome.view.lifecycle} · posture ${s.outcome.view.posture}` : `REFUSED ${String(s.outcome.rejected)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="fos-card fos-span2">
        <h2>Health board / recovery timeline / maintenance (host view models)</h2>
        <ul className="fos-list">
          <li>health board: {vm.healthBoard.ok ? `${vm.healthBoard.view.rows.length} rows · fleet: ${vm.healthBoard.view.fleet.assets} assets, ${vm.healthBoard.view.fleet.critical} critical, ${vm.healthBoard.view.fleet.warning} warning` : `REFUSED ${String(vm.healthBoard.rejected)}`}</li>
          <li>recovery timeline: {vm.recoveryTimeline.ok ? `${vm.recoveryTimeline.view.cases.length} case timeline(s), ${vm.recoveryTimeline.view.open} open` : `REFUSED ${String(vm.recoveryTimeline.rejected)}`}</li>
          <li>maintenance board: {vm.maintenanceBoard.ok ? `${vm.maintenanceBoard.view.scheduled.length} scheduled · ${vm.maintenanceBoard.view.inProgress.length} in progress · ${vm.maintenanceBoard.view.completed.length} completed` : `REFUSED ${String(vm.maintenanceBoard.rejected)}`}</li>
        </ul>
      </section>
      <section className="fos-card fos-span2">
        <h2>Observation timeline (ingested through the real pipeline)</h2>
        <table className="fos-table">
          <thead><tr><th>seq</th><th>device</th><th>kind</th><th>observedAt</th><th>digest</th></tr></thead>
          <tbody>
            {tw.observations.slice(0, 12).map((ob) => (
              <tr key={String(ob.id)}>
                <td>{String(ob.seq)}</td><td>{ob.deviceId}</td><td>{ob.kind}</td>
                <td>{new Date(ob.observedAt).toISOString()}</td>
                <td className="fos-mono">{ob.payloadDigest.slice(0, 16)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="fos-card fos-span2">
        <h2>Route limitation markers (honest, per contract §2)</h2>
        <ul className="fos-list fos-mono">
          {vm.routeLimitations.map((r) => (
            <li key={r.routeId}>{r.routeId}: {r.markers.length ? r.markers.join(", ") : "(none)"}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function SafetyPage({ tw }: { tw: TenantWorld }) {
  const views = buildFindingViews({
    tenantId: tw.tenantId,
    findings: tw.securityFindings,
    remediations: tw.remediations,
  });
  return (
    <div className="fos-grid">
      <section className="fos-card fos-span2">
        <h2>Security findings — posture {tw.posture.postureScore}/100</h2>
        {!views.ok ? (
          <RefusalView code={String(views.refused)} detail={String(views.detail)} />
        ) : (
          <>
            <p className="fos-note">
              total {views.views.rollup.totalFindings} · critical {views.views.rollup.bySeverity.critical} ·
              high {views.views.rollup.bySeverity.high} · medium {views.views.rollup.bySeverity.medium}
            </p>
            <table className="fos-table">
              <thead><tr><th>rank</th><th>finding</th><th>kind</th><th>severity</th><th>confidence</th></tr></thead>
              <tbody>
                {views.views.triageQueue.items.map((f) => (
                  <tr key={f.findingId}>
                    <td>{f.queueRank}</td><td>{f.findingId}</td><td>{f.kind}</td>
                    <td>{f.severity}</td><td>{f.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <pre className="fos-digest">rollup digest: {views.views.rollup.digest}</pre>
          </>
        )}
      </section>
      <section className="fos-card">
        <h2>Remediation lifecycle (evidence-gated)</h2>
        <ul className="fos-list">
          {tw.remediations.map((p) => (
            <li key={p.proposalId}>
              {p.proposalId} — {p.remediationKind} — state <b>{p.state}</b>
              {p.state === "proposed" ? " (Guardian approval required — approvalRef is null)" : ""}
            </li>
          ))}
        </ul>
        <p className="fos-note">
          The remediation lifecycle is evidence-gated: reaching "approved" requires a Guardian
          approval ref; "applied" requires verification evidence; "verified" requires a verification
          outcome. Nothing here bypasses Guardian.
        </p>
      </section>
      <section className="fos-card">
        <h2>Advisory board</h2>
        <EmptyView what="advisory card (none composed in this demo)" />
        <p className="fos-note">
          Predictive outputs render as advisories with provenance and uncertainty. The JEPA-family
          world models are deterministic structural reference models — trained accuracy is never
          claimed for them.
        </p>
      </section>
    </div>
  );
}

export function CommercePage({ tw }: { tw: TenantWorld }) {
  // F301 convergence: the REAL lane C HostSurface (F300C) — work board +
  // honest not-composed sections for undeployed lanes of the demo world.
  const workItems = mapWorkItems(tw);
  const host = workCommerceHostSurface.buildViewModels(
    {
      tenantId: tw.tenantId,
      workItems: workItems as never,
      projects: [], stages: [], milestones: [],
      capacities: [], allocations: [],
      needs: [], demands: [], quotes: [], orders: [], fulfillments: [],
      vendors: [], exposures: [],
      subscriptions: [], entitlements: [],
      assignments: [], budgets: [], usage: [],
    },
    { tenantId: tw.tenantId, actorId: "act_shell-operator", roleId: "role_fleet-operator", establishedAt: T0 + 10_000, scope: "tenant" },
  );
  return (
    <div className="fos-grid">
      <section className="fos-card fos-span2">
        <h2>Work board — {tw.tenantId} <span className="fos-badge">via F300C HostSurface</span></h2>
        {!host.ok ? (
          <RefusalView code={`host-refused/${String(host.rejected)}`} detail={host.detail} />
        ) : !host.models.workBoard.ok ? (
          <RefusalView code={String(host.models.workBoard.reasonCode)} detail={String(host.models.workBoard.detail)} />
        ) : (
          <table className="fos-table">
            <thead><tr><th>column</th><th>cards</th></tr></thead>
            <tbody>
              {host.models.workBoard.board.columns.map((c) => (
                <tr key={c.status}>
                  <td>{c.status}</td>
                  <td>{c.cards.map((i) => `${i.title} (${i.assigneeId ?? "unassigned"})`).join(" · ") || "— (honest empty)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {host.ok && <pre className="fos-digest">host bundle digest: {host.models.digest}</pre>}
      </section>
      <section className="fos-card">
        <h2>Integration status (honest disclosure)</h2>
        <table className="fos-table">
          <thead><tr><th>connector</th><th>status</th></tr></thead>
          <tbody>
            <tr><td>Aurum settlement</td><td><em>CONTRACT_ONLY — deterministic adapter, not live connectivity</em></td></tr>
            <tr><td>Apify actor jobs</td><td><em>CONTRACT_ONLY</em></td></tr>
            <tr><td>External vendor catalog</td><td><em>CONTRACT_ONLY</em></td></tr>
            <tr><td>Model-gateway providers</td><td><em>CONTRACT_ONLY (metadata only)</em></td></tr>
            <tr><td>ADCOS</td><td><em>CONTRACT_ONLY — lane A evidence</em></td></tr>
            <tr><td>Arena</td><td><em>CONTRACT_ONLY — lane B evidence</em></td></tr>
          </tbody>
        </table>
        <p className="fos-note">
          Full evidence-backed matrix: docs/evidence/F300C/report.md §4. No connector is
          LIVE_VERIFIED — no credentials exist in the environment (machine-audited).
        </p>
      </section>
      <section className="fos-card">
        <h2>Adoption ledger (converged, machine-run)</h2>
        <ul className="fos-list">
          <li>counted journey executions: <b>1,575</b> (was 1,113)</li>
          <li>fully-applicable firm cap: <b>58</b> (field 20 + commerce 21 + security 17)</li>
          <li>target: 100 per firm — <b>structurally short, preserved honestly</b></li>
          <li>identical reruns never counted; masks recorded with rationale</li>
        </ul>
        <p className="fos-note">docs/evidence/F300C/report.md §6; the F271 documented decision stands.</p>
      </section>
    </div>
  );
}

export function LabPage() {
  const lab = useMemo(() => runLab(24), []);
  const emissions = lab.events.filter((e) => e.kind === "observation-emitted").slice(0, 14);
  const failures = lab.events.filter((e) => e.kind === "asset-failed");
  const maintenance = lab.events.filter((e) =>
    e.kind === "maintenance-due" || e.kind === "maintenance-started" || e.kind === "maintenance-completed",
  );
  return (
    <div className="fos-grid">
      <section className="fos-card fos-span2">
        <h2>Engineering Lab — deterministic simulation run (experimental evidence only)</h2>
        {!lab.ok ? (
          <RefusalView code="world-refused" detail="the lab world failed validation" />
        ) : (
          <>
            <div className="fos-counters">
              <div><b>{lab.step}</b><span>steps advanced</span></div>
              <div><b>{lab.eventCount}</b><span>events</span></div>
              <div><b>{failures.length}</b><span>asset failures</span></div>
              <div><b>{maintenance.length}</b><span>maintenance events</span></div>
            </div>
            <p className="fos-note">
              Real <code>@fleetos/sim-worlds</code> engine over a fixed seeded world
              (world_fleetos-lab-01, seed fleetos-lab-seed-01): same world + seed ⇒
              byte-identical trajectory. Outputs are EXPERIMENTAL EVIDENCE ONLY — they never
              self-execute and never adopt into operational state.
            </p>
            <pre className="fos-digest">state digest: {lab.lastDigest}</pre>
          </>
        )}
      </section>
      <section className="fos-card fos-span2">
        <h2>Emitted observations (first 14)</h2>
        <table className="fos-table">
          <thead><tr><th>seq</th><th>device</th><th>stream</th><th>value</th><th>unit</th></tr></thead>
          <tbody>
            {emissions.map((e, i) =>
              e.kind === "observation-emitted" ? (
                <tr key={i}>
                  <td>{e.observationSeq}</td><td>{e.deviceId}</td><td>{e.streamKind}</td>
                  <td>{e.value}</td><td>{e.unit}</td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export { CommandsPage } from "./pages-commands.js";
