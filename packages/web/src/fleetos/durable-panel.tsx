/**
 * FleetOS shell — the durable-plane panel (F351A). Rendered by the Command
 * Console in durable mode only: the service card (health + replay report),
 * the device-enrollment path (the REAL EnrollmentDirectory behind :3106),
 * the durable enrollment registry, and the per-tenant record digests — the
 * in-page surfaces the restart-survival evidence is read from.
 */

import { useState } from "react";
import type { TenantContext } from "@fleetos/kernel";
import type { DurableCommandPath, DurableHealth, DurableState } from "./durable.js";

export function DurablePanel(props: {
  durable: DurableCommandPath;
  ctx: TenantContext;
  state: DurableState | null;
  health: DurableHealth | null;
  refresh: () => Promise<void>;
}) {
  const { durable, ctx, state, health, refresh } = props;
  const [deviceId, setDeviceId] = useState("dev_new-device-001");
  const [lastEnroll, setLastEnroll] = useState<string>("");

  const enroll = async () => {
    const r = await durable.enrollDevice(ctx, deviceId);
    if (r.ok) {
      setLastEnroll(`ENROLLED ${r.enrollment.deviceId} at ${new Date(r.enrollment.enrolledAt).toISOString()} (audit digest ${r.audit.digest.slice(0, 16)}…)`);
    } else if ("refused" in r) {
      setLastEnroll(`SERVICE UNREACHABLE — ${r.detail}`);
    } else {
      setLastEnroll(`REFUSED ${r.reason} (the REAL enrollment contract: duplicate enrollments and malformed device ids are refused)`);
    }
    await refresh();
  };

  return (
    <>
      <section className="fos-card fos-span2">
        <h2>
          Durable operational plane <span className="fos-badge">service :3106 · disk-backed</span>
        </h2>
        {health === null ? (
          <div className="fos-refusal" role="alert">
            <strong>Service unreachable</strong>
            <div>The durable service on :3106 did not answer /api/health. No durable state can be shown.</div>
          </div>
        ) : (
          <>
            <ul className="fos-list fos-mono">
              <li>service {health.service} · port {health.port} · commit {health.commit}</li>
              <li>started {health.startedAt} · replay-on-start: {health.replay.commands} command(s), {health.replay.audit} audit entrie(s), {health.replay.assets} enrollment(s) in {health.replay.replayMs}ms</li>
            </ul>
            <p className="fos-note">
              Append-only JSONL segments (write-before-ack, fsync): commands.jsonl · audit.jsonl · assets.jsonl.
              The queue records, submission audit log and enrollments below are the SERVICE's state, not
              browser memory — kill -9 the service and they replay byte-exactly.
            </p>
          </>
        )}
      </section>
      <section className="fos-card">
        <h2>Enroll device (durable registry)</h2>
        <p className="fos-note">
          The REAL <code>EnrollmentDirectory</code> behind the service — the kernel's own audited
          enrollment boundary (the same one the fixture world composes through at T0).
        </p>
        <div className="fos-form">
          <label>deviceId <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} /></label>
          <div className="fos-actions">
            <button onClick={() => void enroll()}>Enroll into the durable registry</button>
          </div>
        </div>
        {lastEnroll && <pre className="fos-result">{lastEnroll}</pre>}
      </section>
      <section className="fos-card">
        <h2>Durable enrollments ({state === null ? "?" : state.enrollments.length}, this tenant)</h2>
        {state === null || state.enrollments.length === 0 ? (
          <div className="fos-empty">No durable enrollments for this tenant yet. (Honest empty state.)</div>
        ) : (
          <table className="fos-table">
            <thead><tr><th>device</th><th>enrolled at</th><th>revoked</th></tr></thead>
            <tbody>
              {state.enrollments.map((e) => (
                <tr key={e.deviceId}>
                  <td className="fos-mono">{e.deviceId}</td>
                  <td>{new Date(e.enrolledAt).toISOString()}</td>
                  <td>{e.revokedAt === null ? "—" : new Date(e.revokedAt).toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="fos-card fos-span2">
        <h2>Durable record digests (this tenant, sha256 over canonical JSON)</h2>
        {state === null ? (
          <div className="fos-empty">Digests unavailable (service unreachable).</div>
        ) : (
          <ul className="fos-list fos-mono">
            <li>commands: {state.digests.commands}</li>
            <li>audit:    {state.digests.audit}</li>
            <li>assets:   {state.digests.assets}</li>
            <li>total:    {state.digests.total}</li>
          </ul>
        )}
        <p className="fos-note">
          Byte-stable across a service restart: kill -9, let the supervisor restart it, refresh —
          these digests must render identically (the Q2 law, read from the page).
        </p>
      </section>
    </>
  );
}
