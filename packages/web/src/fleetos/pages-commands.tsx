/**
 * FleetOS shell — the Command Console page (F301): UI intent → lane
 * CommandDraft → TowerCommandBus → REAL control-plane queue.
 */

import { useState } from "react";
import { listTowerCommands, type TowerCommandEntry } from "@fleetos/control-tower";
import type { FleetCommandPath, SubmissionRecord } from "./commandPath.js";
import type { TenantWorld } from "./world.js";

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

export function CommandsPage(props: {
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
  const submitRemediation = () => {
    const proposal = tw.remediations[0];
    if (!proposal) { setLast("No remediation proposal in this demo composition."); return; }
    const r = cmdPath.submitRemediationRequest(ctx, {
      proposalId: proposal.proposalId,
      findingIds: [...proposal.findingIds],
      remediationKind: proposal.remediationKind,
      reason: "risk-reduction",
    });
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
            recovery.request: incident-response · operator-request;
            security.remediation.request: risk-reduction · policy-remediation. Reasons outside
            the vocabulary are REFUSED (shown honestly).
          </p>
          <div className="fos-actions">
            <button onClick={submitEnroll}>Submit asset.enroll</button>
            <button onClick={submitRecovery}>Submit recovery.request</button>
            <button onClick={submitRemediation}>Submit security.remediation.request (lane B)</button>
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

