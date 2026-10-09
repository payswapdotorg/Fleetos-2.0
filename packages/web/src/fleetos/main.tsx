/**
 * FleetOS application shell (F301) — mount + navigation + session state.
 * The pages live in pages.tsx; the REAL composed world in world.ts; the
 * command path in commandPath.ts.
 */

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildWorld, TENANTS, type TenantWorld } from "./world.js";
import { FleetCommandPath, type SubmissionRecord } from "./commandPath.js";
import { ROUTES, type RouteId, TowerPage, FieldPage, SafetyPage, CommercePage, LabPage, CommandsPage } from "./pages.js";
import { STYLES } from "./styles.js";

declare const __FLEETOS_COMMIT__: string;
declare const __FLEETOS_BUILT_AT__: string;

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
          Demo composition — deterministic logical time T0 ({new Date(T0_FALLBACK).toISOString()}), fixed fixture
          inputs; every view is a REAL output of the FleetOS packages.
        </span>
        <span className="fos-commit">
          commit <code>{__FLEETOS_COMMIT__}</code> · built {__FLEETOS_BUILT_AT__}
        </span>
      </footer>
    </div>
  );
}

const T0_FALLBACK = 1_774_000_000_000;

function mount() {
  const el = document.getElementById("fleetos-root");
  if (!el) return;
  const style = document.createElement("style");
  style.textContent = STYLES;
  document.head.appendChild(style);
  createRoot(el).render(<App />);
}

mount();
