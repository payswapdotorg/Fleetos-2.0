/**
 * FleetOS application shell (F301) — mount + navigation + session state.
 * The pages live in pages.tsx; the REAL composed world in world.ts; the
 * command path in commandPath.ts.
 */

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildWorld, TENANTS, type TenantWorld } from "./world.js";
import { FleetCommandPath } from "./commandPath.js";
import { InProcessCommandPath, durableModeActive, type FleetCommandPort } from "./port.js";
import { DurableCommandPath } from "./durable.js";
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
  const durableMode = useMemo(() => durableModeActive(), []);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const world = useMemo(() => buildWorld(), []);
  // noUncheckedIndexedAccess: index reads narrow to undefined; the switcher's
  // invariants are made explicit — fail loudly on a broken index rather than
  // silently rendering a wrong tenant/actor.
  const pickedTenant = TENANTS[tenantIdx];
  if (pickedTenant === undefined) throw new Error(`tenant index ${tenantIdx} out of range`);
  const tenant = pickedTenant;
  const pickedActor = tenant.actors[actorIdx % tenant.actors.length];
  if (pickedActor === undefined) throw new Error(`no actor at index ${actorIdx} for tenant ${tenant.id}`);
  const actor = pickedActor;
  const tw = world.get(tenant.id) as TenantWorld;
  // The command path: the F301 in-process composition (browser memory) or the
  // F351A durable composition (the :3106 service) — same port contracts.
  const cmdPath = useMemo(() => new FleetCommandPath(), []);
  const durablePath = useMemo(() => (durableMode ? new DurableCommandPath() : null), [durableMode]);
  const port: FleetCommandPort = useMemo(
    () => (durablePath !== null ? durablePath : new InProcessCommandPath(cmdPath)),
    [durablePath, cmdPath],
  );

  const nav = (id: RouteId) => {
    window.location.hash = `#/${id}`;
    setRoute(id);
  };

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
            port={port}
            durable={durablePath}
            tenantId={tenant.id}
            actorId={actor.id}
          />
        )}
      </main>
      <footer className="fos-footer">
        <span>
          Demo composition — deterministic logical time T0 ({new Date(T0_FALLBACK).toISOString()}), fixed fixture
          inputs; every view is a REAL output of the FleetOS packages.
        </span>
        <span className="fos-mode">
          operational plane: {durableMode ? "DURABLE — service :3106, disk-backed segments, replay-on-start" : "in-process — browser memory (fixture-composed)"}{" "}
          <a href={durableMode ? `?${window.location.hash}` : `?mode=durable${window.location.hash}`}>
            {durableMode ? "switch to in-process" : "switch to durable"}
          </a>
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
