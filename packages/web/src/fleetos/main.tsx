/**
 * FleetOS application shell (F301) — the user-facing product surface.
 *
 * Mounts the REAL FleetOS surfaces over the composed world: Control Tower,
 * Device 360/field, safety/intelligence, work/commerce, Engineering Lab,
 * and the command console (UI intent → CommandDraft → REAL queue →
 * Guardian adjudication — submissions, never authorizations).
 *
 * Honest states: refusals, tenant-mismatch and empty surfaces render
 * verbatim; nothing is fabricated. Demo composition is labeled as such.
 */

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  assembleControlTower,
  listTowerCommands,
  type TowerCommandEntry,
} from "@fleetos/control-tower";
import { buildFindingViews } from "@fleetos/experience-safety-intel";
import { buildWorkBoard } from "@fleetos/experience-work-commerce";
import { assembleFleetOverview } from "@fleetos/experience-asset-field";
import { buildWorld, runLab, TENANTS, T0, type TenantWorld } from "./world.js";
import { FleetCommandPath, type SubmissionRecord } from "./commandPath.js";

declare const __FLEETOS_COMMIT__: string;
declare const __FLEETOS_BUILT_AT__: string;

// ---------------------------------------------------------------------------
// Shell state
// ---------------------------------------------------------------------------

type RouteId = "tower" | "field" | "safety" | "commerce" | "lab" | "commands";

const ROUTES: readonly { readonly id: RouteId; readonly label: string; readonly blurb: string }[] = [
  { id: "tower", label: "Control Tower", blurb: "Cross-lane cockpit — fleet, findings, work, attention queue" },
  { id: "field", label: "Device 360 / Field", blurb: "Assets, devices, observations, health timeline" },
  { id: "safety", label: "Safety & Intelligence", blurb: "Findings, evidence, Guardian decisions, advisories" },
  { id: "commerce", label: "Work & Commerce", blurb: "Work board, procurement, budgets" },
  { id: "lab", label: "Engineering Lab", blurb: "Simulation worlds, benchmarks, experiments" },
  { id: "commands", label: "Command Console", blurb: "Typed command path — submit, adjudicate, verify" },
];

function currentRoute(): RouteId {
  const h = window.location.hash.replace(/^#\/?/, "");
  const found = ROUTES.find((r) => r.id === h);
  return found ? found.id : "tower";
}

function App() {
  const [route, setRoute] = useState<RouteId>(currentRoute());
  const [tenantIdx, setTenantIdx] = useState(0);
  const [actorIdx, setActorIdx] = useState(0);
  const [submissions, setSubmissions] = useState<readonly SubmissionRecord[]>([]);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const world = useMemo(() => buildWorld(), []);
  const tenant = TENANTS[tenantIdx];
  const actor = tenant.actors[actorIdx % tenant.actors.length];
  const tw = world.get(tenant.id) as TenantWorld;
  const cmdPath = useMemo(() => new FleetCommandPath(), []);

  const nav = (id: RouteId) => {
    window.location.hash = `#/${id}`;
    setRoute(id);
  };

  const refreshSubmissions = () => setSubmissions([...cmdPath.submissionsOf()]);

  return (
    <div className="fos-shell">
      <header className="fos-header">
        <div className="fos-brand">
          <span className="fos-logo" aria-hidden>◈</span>
          <span className="fos-title">FleetOS</span>
          <span className="fos-sub">operational truth, from enrollment to evidence</span>
        </div>
        <div className="fos-session">
          <label className="fos-switch">
            <span className="fos-switch-label">Tenant</span>
            <select
              value={tenantIdx}
              onChange={(e) => {
                setTenantIdx(Number(e.target.value));
                setActorIdx(0);
              }}
            >
              {TENANTS.map((t, i) => (
                <option key={t.id} value={i}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="fos-switch">
            <span className="fos-switch-label">Role</span>
            <select value={actorIdx % tenant.actors.length} onChange={(e) => setActorIdx(Number(e.target.value))}>
              {tenant.actors.map((a, i) => (
                <option key={a.id} value={i}>{a.name}</option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <nav className="fos-nav" aria-label="FleetOS sections">
        {ROUTES.map((r) => (
          <button
            key={r.id}
            className={r.id === route ? "fos-nav-btn fos-nav-active" : "fos-nav-btn"}
            onClick={() => nav(r.id)}
          >
            {r.label}
          </button>
        ))}
      </nav>
      <main className="fos-main">
        <p className="fos-blurb">{ROUTES.find((r) => r.id === route)?.blurb}</p>
        {route === "tower" && <TowerPage tw={tw} />}
        {route === "field" && <FieldPage tw={tw} />}
        {route === "safety" && <SafetyPage tw={tw} />}
        {route === "commerce" && <CommercePage tw={tw} />}
        {route === "lab" && <LabPage />}
        {route === "commands" && (
          <CommandsPage
            tw={tw}
            cmdPath={cmdPath}
            tenantId={tenant.id}
            actorId={actor.id}
            submissions={submissions}
            onSubmit={refreshSubmissions}
          />
        )}
      </main>
      <footer className="fos-footer">
        <span>
          Demo composition — deterministic logical time T0 ({new Date(T0).toISOString()}), fixed fixture
          inputs; every view is a REAL output of the FleetOS packages.
        </span>
        <span className="fos-commit">
          commit <code>{__FLEETOS_COMMIT__}</code> · built {__FLEETOS_BUILT_AT__}
        </span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Honest-state renderers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function mapWorkItems(tw: TenantWorld) {
  return tw.workBoardItems.map((w) => ({
    id: { kind: "work-item" as const, value: w.id },
    tenant: { tenantId: w.tenant },
    title: w.title,
    assignee: { assigneeId: w.assignee, assignedAt: new Date(T0).toISOString() },
    assignmentHistory: [],
    deadline: null,
    status: w.state === "in_progress" ? ("in_progress" as const) : ("todo" as const),
    blockedReason: null,
    missionRef: null,
    workflowRef: null,
    projectId: null,
  }));
}

function TowerPage({ tw }: { tw: TenantWorld }) {
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

function FieldPage({ tw }: { tw: TenantWorld }) {
  const overview = assembleFleetOverview(tw.slice, { now: T0 + 10_000 });
  if (!overview.ok) return <RefusalView code="fleet-overview-refused" detail={String(overview.detail ?? overview.refused)} />;
  const o = overview.view;
  return (
    <div className="fos-grid">
      <section className="fos-card fos-span2">
        <h2>Fleet overview — {tw.tenantId}</h2>
        <div className="fos-counters">
          <div><b>{o.counters.assets}</b><span>assets ({o.counters.active} active)</span></div>
          <div><b>{o.counters.devices}</b><span>devices</span></div>
          <div><b>{o.counters.fresh}</b><span>fresh</span></div>
          <div><b>{o.counters.stale}</b><span>stale</span></div>
        </div>
        <pre className="fos-digest">overview digest: {o.digest}</pre>
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
        <h2>Devices & enrollment</h2>
        <table className="fos-table">
          <thead><tr><th>device</th><th>asset</th><th>serial</th></tr></thead>
          <tbody>
            {tw.devices.map((d) => (
              <tr key={d.id}><td>{d.id}</td><td>{d.assetId}</td><td>{d.serial}</td></tr>
            ))}
          </tbody>
        </table>
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
        <h2>Health findings (real triage)</h2>
        {tw.healthFindings.length === 0 ? (
          <EmptyView what="health-finding" />
        ) : (
          <ul className="fos-list">
            {tw.healthFindings.map((f, i) => (
              <li key={i}>{String(f.deviceId)} — {f.code} — {f.severity}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SafetyPage({ tw }: { tw: TenantWorld }) {
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

function CommercePage({ tw }: { tw: TenantWorld }) {
  const workItems = mapWorkItems(tw);
  const board = buildWorkBoard({
    tenant: { tenantId: tw.tenantId },
    workItems: workItems as never,
    computedAt: new Date(T0).toISOString(),
  });
  return (
    <div className="fos-grid">
      <section className="fos-card fos-span2">
        <h2>Work board — {tw.tenantId}</h2>
        {!board.ok ? (
          <RefusalView code={String(board.reasonCode)} detail={String(board.detail)} />
        ) : (
          <table className="fos-table">
            <thead><tr><th>item</th><th>status</th><th>assignee</th></tr></thead>
            <tbody>
              {board.board.columns.flatMap((c) => c.cards.map((i) => (
                <tr key={i.workItemId}><td>{i.title}</td><td>{i.status}</td><td>{i.assigneeId ?? "unassigned"}</td></tr>
              )))}
            </tbody>
          </table>
        )}
      </section>
      <section className="fos-card">
        <h2>Integration status (honest disclosure)</h2>
        <table className="fos-table">
          <thead><tr><th>connector</th><th>status</th></tr></thead>
          <tbody>
            <tr><td>Aurum</td><td><em>CONTRACT_ONLY — deterministic adapter contract, not live connectivity</em></td></tr>
            <tr><td>Apify</td><td><em>CONTRACT_ONLY</em></td></tr>
            <tr><td>ADCOS</td><td><em>CONTRACT_ONLY</em></td></tr>
            <tr><td>Arena</td><td><em>CONTRACT_ONLY</em></td></tr>
          </tbody>
        </table>
        <p className="fos-note">
          Full evidence-backed matrix lands with the F300C lane delivery.
        </p>
      </section>
    </div>
  );
}

function LabPage() {
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

function CommandsPage(props: {
  tw: TenantWorld;
  cmdPath: FleetCommandPath;
  tenantId: string;
  actorId: string;
  submissions: readonly SubmissionRecord[];
  onSubmit: () => void;
}) {
  const { tw, cmdPath, tenantId, actorId, submissions, onSubmit } = props;
  const [assetId, setAssetId] = useState("ast_acme-truck-01");
  const [deviceId, setDeviceId] = useState("dev_acme-telem-1001");
  const [serial, setSerial] = useState("SN-NEW-0001");
  const [reason, setReason] = useState("onboarding");
  const [last, setLast] = useState<string>("");
  const registry: readonly TowerCommandEntry[] = listTowerCommands();
  const ctx = cmdPath.contextFor(tenantId, actorId);
  const queueRecords = cmdPath.queueRecords(ctx);

  const submitEnroll = () => {
    const r = cmdPath.submitEnrollAsset(ctx, { assetId, deviceId, serial, reason });
    setLast(r.ok ? `ENQUEUED ${r.ack.commandId} (duplicate=${r.ack.duplicate})` : `REFUSED ${r.refused}: ${r.detail}`);
    onSubmit();
  };
  const submitRecovery = () => {
    const r = cmdPath.submitRecoveryRequest(ctx, { deviceId, reason });
    setLast(r.ok ? `ENQUEUED ${r.ack.commandId} (duplicate=${r.ack.duplicate})` : `REFUSED ${r.refused}: ${r.detail}`);
    onSubmit();
  };

  return (
    <div className="fos-grid">
      <section className="fos-card fos-span2">
        <h2>Typed command path — {tenantId} / {actorId}</h2>
        <p className="fos-note">
          UI intent → lane CommandDraft → REAL control-plane queue (idempotent, Guardian-adjudicated).
          Submission enqueues for adjudication; it never authorizes execution —
          capability ceilings are requests, not authorizations.
        </p>
        <div className="fos-form">
          <label>assetId <input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
          <label>deviceId <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} /></label>
          <label>serial <input value={serial} onChange={(e) => setSerial(e.target.value)} /></label>
          <label>reason <input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <p className="fos-note">
            Tower reason vocabulary — asset.enroll: onboarding · replacement · fleet-expansion;
            recovery.request: incident-response · operator-request. Reasons outside the
            vocabulary are REFUSED (shown honestly).
          </p>
          <div className="fos-actions">
            <button onClick={submitEnroll}>Submit asset.enroll</button>
            <button onClick={submitRecovery}>Submit recovery.request</button>
          </div>
        </div>
        {last && <pre className="fos-result">{last}</pre>}
      </section>
      <section className="fos-card">
        <h2>Registry ({registry.length} commands)</h2>
        <ul className="fos-list fos-mono">
          {registry.map((c) => (
            <li key={c.id}>{c.kind} — lane {c.lane} — ceiling: {c.capabilityRequirement}</li>
          ))}
        </ul>
      </section>
      <section className="fos-card">
        <h2>Queue ({queueRecords.length} records, this tenant)</h2>
        {queueRecords.length === 0 ? (
          <EmptyView what="queued command" />
        ) : (
          <ul className="fos-list fos-mono">
            {queueRecords.map((r) => (
              <li key={r.envelope.id}>
                {r.envelope.id.slice(0, 20)}… {r.envelope.kind} — {r.state}
                {r.failures > 0 ? ` (failures: ${r.failures})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="fos-card fos-span2">
        <h2>Submission log (audit trail, verbatim)</h2>
        {submissions.length === 0 ? (
          <EmptyView what="submission" />
        ) : (
          <ul className="fos-list fos-mono">
            {submissions.map((s, i) => (
              <li key={i} className={s.ok ? "fos-ok" : "fos-bad"}>
                {new Date(s.at).toISOString()} {s.kind} by {s.actor}: {s.ok ? "OK" : "REFUSED"} — {s.detail}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="fos-card fos-span2">
        <h2>Available demo devices</h2>
        <table className="fos-table">
          <thead><tr><th>device</th><th>asset</th></tr></thead>
          <tbody>
            {tw.devices.map((d) => (
              <tr key={d.id}><td>{d.id}</td><td>{d.assetId}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount + styles
// ---------------------------------------------------------------------------

const STYLES = `
.fos-shell { min-height: 100vh; display: flex; flex-direction: column; font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0f14; color: #dbe4ec; }
.fos-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 22px; background: #101720; border-bottom: 1px solid #1d2a38; }
.fos-brand { display: flex; align-items: baseline; gap: 10px; }
.fos-logo { color: #e8a33d; font-size: 22px; }
.fos-title { font-size: 20px; font-weight: 700; letter-spacing: 0.04em; color: #f4f7fa; }
.fos-sub { font-size: 12px; color: #7c8ea0; }
.fos-session { display: flex; gap: 12px; }
.fos-switch { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #93a4b5; }
.fos-switch select { background: #16202b; color: #dbe4ec; border: 1px solid #263648; border-radius: 6px; padding: 4px 8px; }
.fos-nav { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 22px 0; background: #101720; border-bottom: 1px solid #1d2a38; }
.fos-nav-btn { background: transparent; color: #93a4b5; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px; font-size: 13px; cursor: pointer; }
.fos-nav-btn:hover { color: #dbe4ec; }
.fos-nav-active { color: #e8a33d; border-bottom-color: #e8a33d; }
.fos-main { flex: 1; padding: 18px 22px; }
.fos-blurb { color: #7c8ea0; font-size: 12px; margin: 0 0 14px; }
.fos-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.fos-card { background: #101720; border: 1px solid #1d2a38; border-radius: 10px; padding: 16px; }
.fos-span2 { grid-column: 1 / -1; }
.fos-card h2 { margin: 0 0 12px; font-size: 14px; color: #e8a33d; letter-spacing: 0.02em; }
.fos-list { list-style: none; margin: 0; padding: 0; font-size: 13px; }
.fos-list li { padding: 6px 8px; border-bottom: 1px solid #182532; }
.fos-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.fos-table th { text-align: left; color: #7c8ea0; font-weight: 500; padding: 4px 8px; border-bottom: 1px solid #1d2a38; }
.fos-table td { padding: 5px 8px; border-bottom: 1px solid #182532; }
.fos-counters { display: flex; gap: 22px; }
.fos-counters div { display: flex; flex-direction: column; }
.fos-counters b { font-size: 24px; color: #f4f7fa; }
.fos-counters span { font-size: 11px; color: #7c8ea0; }
.fos-digest { margin: 10px 0 0; font-size: 10.5px; color: #56697c; overflow-wrap: anywhere; }
.fos-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.fos-refusal { background: #2a1512; border: 1px solid #5c2a22; color: #ffb4a6; border-radius: 8px; padding: 12px 14px; font-size: 13px; }
.fos-empty { background: #121a24; border: 1px dashed #263648; color: #7c8ea0; border-radius: 8px; padding: 14px; font-size: 13px; }
.fos-note { color: #7c8ea0; font-size: 12px; line-height: 1.5; }
.fos-form { display: grid; gap: 8px; max-width: 560px; }
.fos-form label { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #93a4b5; }
.fos-form input { flex: 1; background: #16202b; color: #dbe4ec; border: 1px solid #263648; border-radius: 6px; padding: 6px 10px; font-family: ui-monospace, monospace; font-size: 12px; }
.fos-actions { display: flex; gap: 10px; }
.fos-actions button { background: #e8a33d; color: #101720; border: 0; border-radius: 6px; padding: 8px 14px; font-weight: 600; cursor: pointer; }
.fos-actions button:hover { background: #f4b455; }
.fos-result { margin: 10px 0 0; background: #121a24; border: 1px solid #263648; border-radius: 6px; padding: 10px; font-size: 12px; overflow-wrap: anywhere; }
.fos-ok { color: #8fd0a0; }
.fos-bad { color: #ff9d8f; }
.fos-footer { display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap; padding: 12px 22px; background: #101720; border-top: 1px solid #1d2a38; color: #56697c; font-size: 11px; }
.fos-commit code { color: #93a4b5; }
@media (max-width: 720px) { .fos-header { flex-direction: column; align-items: flex-start; } }
`;

function mount() {
  const el = document.getElementById("fleetos-root");
  if (!el) return;
  const style = document.createElement("style");
  style.textContent = STYLES;
  document.head.appendChild(style);
  createRoot(el).render(<App />);
}

mount();
