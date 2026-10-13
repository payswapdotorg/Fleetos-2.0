/**
 * FleetOS shell — the Command Console page (F301; F351A durable mode): UI
 * intent → lane CommandDraft → TowerCommandBus → REAL control-plane queue —
 * in-process (browser memory, the F301 composition) or durable (the :3106
 * service's disk-backed segments), through the SAME port contracts.
 */

import { useCallback, useEffect, useState } from "react";
import { listTowerCommands, type TowerCommandEntry } from "@fleetos/control-tower";
import type { CommandRecord } from "@fleetos/control-plane";
import type { FleetCommandPort } from "./port.js";
import type { DurableCommandPath, DurableHealth, DurableState, DurableSubmitOutcome } from "./durable.js";
import { DurablePanel } from "./durable-panel.js";
import type { SubmissionRecord } from "./commandPath.js";
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
  port: FleetCommandPort;
  durable: DurableCommandPath | null;
  tenantId: string;
  actorId: string;
}) {
  const { tw, port, durable, tenantId, actorId } = props;
  const [assetId, setAssetId] = useState("ast_acme-truck-01");
  const [deviceId, setDeviceId] = useState("dev_acme-telem-1001");
  const [serial, setSerial] = useState("SN-NEW-0001");
  const [reason, setReason] = useState("onboarding");
  const [last, setLast] = useState<string>("");
  const [queueRecords, setQueueRecords] = useState<readonly CommandRecord[]>([]);
  const [submissions, setSubmissions] = useState<readonly SubmissionRecord[]>([]);
  const [durableState, setDurableState] = useState<DurableState | null>(null);
  const [durableHealth, setDurableHealth] = useState<DurableHealth | null>(null);
  const registry: readonly TowerCommandEntry[] = listTowerCommands();
  const ctx = port.contextFor(tenantId, actorId);

  const refresh = useCallback(async () => {
    if (durable !== null) {
      const s = await durable.stateOf(ctx);
      setDurableState(s);
      setQueueRecords(s === null ? [] : s.commands);
      setSubmissions(s === null ? [] : s.submissions);
      setDurableHealth(await durable.healthOf());
    } else {
      setQueueRecords(await port.queueRecords(ctx));
      setSubmissions(await port.submissionsOf());
    }
    // ctx is derived from tenantId/actorId; the deps are the primitive inputs.
  }, [port, durable, tenantId, actorId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const show = (r: DurableSubmitOutcome) => {
    setLast(
      r.ok
        ? `ENQUEUED ${r.ack.commandId} (duplicate=${r.ack.duplicate})`
        : `REFUSED ${r.refused}: ${r.detail}`,
    );
  };

  const submitEnroll = async () => {
    show(await port.submitEnrollAsset(ctx, { assetId, deviceId, serial, reason }));
    await refresh();
  };
  const submitRecovery = async () => {
    show(await port.submitRecoveryRequest(ctx, { deviceId, reason }));
    await refresh();
  };
  const submitRemediation = async () => {
    const proposal = tw.remediations[0];
    if (!proposal) {
      setLast("No remediation proposal in this demo composition.");
      return;
    }
    show(
      await port.submitRemediationRequest(ctx, {
        proposalId: proposal.proposalId,
        findingIds: [...proposal.findingIds],
        remediationKind: proposal.remediationKind,
        reason: "risk-reduction",
      }),
    );
    await refresh();
  };

  return (
    <div className="fos-grid">
      <section className="fos-card fos-span2">
        <h2>
          Typed command path — {tenantId} / {actorId}{" "}
          <span className="fos-badge">
            {durable !== null ? "DURABLE · service :3106" : "in-process · browser memory"}
          </span>
        </h2>
        <p className="fos-note">
          UI intent → lane CommandDraft → REAL control-plane queue (idempotent, Guardian-adjudicated).
          Submission enqueues for adjudication; it never authorizes execution —
          capability ceilings are requests, not authorizations.
          {durable !== null
            ? " In durable mode the draft is POSTed to the :3106 service; the ack/refusal comes back from the REAL queue it owns (write-before-ack, replay-on-start)."
            : ""}
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
            <button onClick={() => void submitEnroll()}>Submit asset.enroll</button>
            <button onClick={() => void submitRecovery()}>Submit recovery.request</button>
            <button onClick={() => void submitRemediation()}>Submit security.remediation.request (lane B)</button>
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
          durable !== null && durableState === null ? (
            <RefusalView code="service-unreachable" detail="The durable service on :3106 did not answer — no queue records can be shown." />
          ) : (
            <EmptyView what="queued command" />
          )
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
          durable !== null && durableState === null ? (
            <RefusalView code="service-unreachable" detail="The durable service on :3106 did not answer — no audit records can be shown." />
          ) : (
            <EmptyView what="submission" />
          )
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
      {durable !== null && (
        <DurablePanel durable={durable} ctx={ctx} state={durableState} health={durableHealth} refresh={refresh} />
      )}
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
