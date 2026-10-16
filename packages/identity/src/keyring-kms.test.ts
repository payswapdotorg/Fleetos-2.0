/**
 * keyring-kms.test.ts — the F373 real-KMS keyring adapter battery.
 *
 * Deterministic-under-injection (the repo law): the transport seam
 * (`fetchImpl`) is a scripted fake responder — NO network, no clock, no
 * randomness anywhere in this file. The fake serves the exact shapes the
 * real fleetos-kms service serves; the no-echo law is asserted by planting
 * canary strings in response BODIES and proving they never enter any
 * refusal detail (the no-leak law's machine form).
 */

import { describe, expect, it } from "vitest";
import { loadKmsKeyringProvider, type KmsFetch } from "./keyring-kms.ts";
import { issueKeyedSession, verifyKeyedSession } from "./keyring.ts";

const NOW = 1_791_830_400_000;
const TOKEN = "fka1.fake-admin-session-token-for-tests";
const CANARY = "LEAK-CANARY-never-in-any-detail";
const BASE = "http://127.0.0.1:9";

const K1 = {
  keyId: "kms-fake-k1",
  secretHex: "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
};
const K2 = {
  keyId: "kms-fake-k2",
  secretHex: "ffffeeeeddddccccbbbbaaaa9999888877776666555544443333222211110000",
};
const K2_RETIRE_AT = NOW + 600_000;

// --- the scripted fake (discriminated specs; the real service's shapes) ---

type CurrentSpec = { kind: "ok"; keyId: string | null } | { kind: "refuse" };
type ListSpec = { kind: "ok"; keyIds: readonly string[] } | { kind: "refuse" } | { kind: "malformed"; value: unknown };
type MaterialSpec = { kind: "ok"; secretHex: string; retireAt: number | null } | { kind: "refuse"; status?: number; body?: string };
type ResolveSpec = { kind: "table"; entries: Record<string, MaterialSpec> } | { kind: "refuse" };
type Served = { current?: CurrentSpec; list?: ListSpec; resolve?: ResolveSpec };

interface Call {
  method: string;
  url: string;
  auth: string | undefined;
  body?: string;
}

function fakeKms(served: Served): { fetchImpl: KmsFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: KmsFetch = (url, init) => {
    calls.push({ method: init.method, url, auth: init.headers["authorization"], body: init.body });
    const respond = (status: number, json: unknown) =>
      Promise.resolve({ status, json: () => Promise.resolve(JSON.parse(JSON.stringify(json)) as unknown) });
    const refuseBody = (status: number) => ({ ok: false, refusal: { reason: status === 404 ? "KEY_UNKNOWN" : "UNAUTHENTICATED", detail: CANARY } });
    if (init.method === "GET" && url.startsWith(`${BASE}/api/keys/current`)) {
      const spec: CurrentSpec = served.current ?? { kind: "ok", keyId: K1.keyId };
      if (spec.kind === "refuse") return respond(401, refuseBody(401));
      return respond(200, { ok: true, keyId: spec.keyId });
    }
    if (init.method === "GET" && url.startsWith(`${BASE}/api/keys?`)) {
      const spec: ListSpec = served.list ?? { kind: "ok", keyIds: [K1.keyId, K2.keyId] };
      if (spec.kind === "refuse") return respond(401, refuseBody(401));
      if (spec.kind === "malformed") return respond(200, { ok: true, keyIds: spec.value });
      return respond(200, { ok: true, keyIds: spec.keyIds });
    }
    if (init.method === "POST" && url.endsWith("/api/keys/resolve")) {
      const spec: ResolveSpec = served.resolve ?? {
        kind: "table",
        entries: {
          [K1.keyId]: { kind: "ok", secretHex: K1.secretHex, retireAt: null },
          [K2.keyId]: { kind: "ok", secretHex: K2.secretHex, retireAt: K2_RETIRE_AT },
        },
      };
      if (spec.kind === "refuse") return respond(401, refuseBody(401));
      const keyId = (JSON.parse(init.body ?? "{}") as { keyId?: string }).keyId ?? "";
      const entry = spec.entries[keyId];
      if (entry === undefined) return respond(404, refuseBody(404));
      if (entry.kind === "refuse") return respond(entry.status ?? 404, { ok: false, refusal: { reason: "KEY_UNKNOWN", detail: entry.body ?? CANARY } });
      return respond(200, { ok: true, keyId, algorithm: "HMAC-SHA256", secretHex: entry.secretHex, retireAt: entry.retireAt });
    }
    return respond(404, refuseBody(404));
  };
  return { fetchImpl, calls };
}

const defaultTable: ResolveSpec = {
  kind: "table",
  entries: {
    [K1.keyId]: { kind: "ok", secretHex: K1.secretHex, retireAt: null },
    [K2.keyId]: { kind: "ok", secretHex: K2.secretHex, retireAt: K2_RETIRE_AT },
  },
};

async function loadWith(served: Served) {
  const fake = fakeKms(served);
  const loaded = await loadKmsKeyringProvider({ baseUrl: BASE, token: TOKEN, now: NOW, fetchImpl: fake.fetchImpl });
  return { loaded, fake };
}

describe("loadKmsKeyringProvider — the snapshot load over the authenticated API", () => {
  it("loads the full key set: current, list, resolve-every-id; source is plainly labelled kms", async () => {
    const { loaded } = await loadWith({});
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("unreachable");
    expect(loaded.provider.source).toBe("kms");
    expect(loaded.provider.currentKeyId()).toBe(K1.keyId);
    expect(loaded.provider.listKeyIds()).toEqual([K1.keyId, K2.keyId]);
    expect(loaded.provider.resolveKeyMaterial(K1.keyId)).toEqual({ algorithm: "HMAC-SHA256", secretHex: K1.secretHex, retireAt: null });
    expect(loaded.provider.resolveKeyMaterial(K2.keyId)).toEqual({ algorithm: "HMAC-SHA256", secretHex: K2.secretHex, retireAt: K2_RETIRE_AT });
    expect(loaded.provider.resolveKeyMaterial("ghost-k9")).toBeNull();
  });

  it("carries the Bearer token and the logical now on every call", async () => {
    const { fake } = await loadWith({});
    expect(fake.calls.length).toBe(4);
    for (const call of fake.calls) {
      expect(call.auth).toBe(`Bearer ${TOKEN}`);
    }
    expect(fake.calls[0]?.url).toContain(`now=${NOW}`);
    const resolve = fake.calls.find((c) => c.method === "POST");
    expect(resolve?.body).toContain(`"now":${NOW}`);
  });

  it("the snapshot is cached per the port's semantics: repeated calls are stable and never re-fetch", async () => {
    const { loaded, fake } = await loadWith({});
    if (!loaded.ok) throw new Error("unreachable");
    const first = loaded.provider.resolveKeyMaterial(K1.keyId);
    const second = loaded.provider.resolveKeyMaterial(K1.keyId);
    expect(first).toEqual(second);
    expect(fake.calls.length).toBe(4);
  });

  it("the F370B composition works over the kms source unchanged (issue under current, verify by carried id)", async () => {
    const { loaded } = await loadWith({});
    if (!loaded.ok) throw new Error("unreachable");
    const issued = issueKeyedSession({
      provider: loaded.provider,
      actorId: "act_kms_adapter_01",
      tenantId: "acme-ops",
      scopes: ["marketplace.request"],
      issuedAt: NOW,
      expiresAt: NOW + 3_600_000,
      jti: "jti-kms-adapter-1",
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("unreachable");
    expect(issued.keyId).toBe(K1.keyId);
    const verified = verifyKeyedSession(issued.token, { provider: loaded.provider, now: NOW + 1_000 });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");
    expect(verified.keyId).toBe(K1.keyId);
    expect(verified.keyStatus).toBe("current");
  });
});

describe("loadKmsKeyringProvider — the refusal family (fixed strings, no echo)", () => {
  it("refuses when the KMS refuses the calls (401): ok:false, reason malformed, a fixed detail", async () => {
    const { loaded } = await loadWith({ current: { kind: "refuse" } });
    expect(loaded).toEqual({ ok: false, reason: "malformed", detail: "the KMS currentKey call failed (never echoed)" });
  });

  it("refuses on a transport failure (connection refused): the same fixed verdict shape", async () => {
    const fetchImpl: KmsFetch = () => Promise.reject(new Error("ECONNREFUSED (this message must never surface)"));
    const loaded = await loadKmsKeyringProvider({ baseUrl: BASE, token: TOKEN, now: NOW, fetchImpl });
    expect(loaded).toEqual({ ok: false, reason: "malformed", detail: "the KMS currentKey call failed (never echoed)" });
  });

  it("refuses when the KMS reports no current key (the create-first bootstrap law)", async () => {
    const { loaded } = await loadWith({ current: { kind: "ok", keyId: null } });
    expect(loaded).toEqual({ ok: false, reason: "malformed", detail: "the KMS reports no current key (create or rotate first)" });
  });

  it("refuses when the list plane is malformed", async () => {
    const { loaded } = await loadWith({ list: { kind: "malformed", value: "not-an-array" } });
    expect(loaded).toEqual({ ok: false, reason: "malformed", detail: "the KMS key id list is malformed (never echoed)" });
  });

  it("refuses when the list call itself is refused (401 on list)", async () => {
    const { loaded } = await loadWith({ list: { kind: "refuse" } });
    expect(loaded).toEqual({ ok: false, reason: "malformed", detail: "the KMS listKeyIds call failed (never echoed)" });
  });

  it("refuses when the resolve plane is refused wholesale (401 on resolve)", async () => {
    const { loaded } = await loadWith({ resolve: { kind: "refuse" } });
    expect(loaded).toEqual({ ok: false, reason: "malformed", detail: "the KMS resolve call failed (never echoed)" });
  });

  it("refuses when the served material is malformed (non-hex secret)", async () => {
    const { loaded } = await loadWith({ resolve: { kind: "table", entries: { [K1.keyId]: { kind: "ok", secretHex: "zz-not-hex", retireAt: null } } } });
    expect(loaded).toEqual({ ok: false, reason: "malformed", detail: "the KMS-served material is malformed (never echoed)" });
  });

  it("refuses when the served retireAt is invalid (zero)", async () => {
    const { loaded } = await loadWith({ resolve: { kind: "table", entries: { [K1.keyId]: { kind: "ok", secretHex: K1.secretHex, retireAt: 0 } } } });
    expect(loaded).toEqual({ ok: false, reason: "malformed", detail: "the KMS-served material is malformed (never echoed)" });
  });
});

describe("loadKmsKeyringProvider — the no-leak law (bodies never echoed)", () => {
  it("no refusal detail ever contains the response body (canary-asserted), and no detail carries served material", async () => {
    const cases: Served[] = [
      { current: { kind: "refuse" } },
      { list: { kind: "refuse" } },
      { resolve: { kind: "refuse" } },
      { resolve: { kind: "table", entries: { [K1.keyId]: { kind: "refuse", status: 404, body: `${CANARY} ${K1.secretHex}` } } } },
    ];
    for (const served of cases) {
      const { loaded } = await loadWith(served);
      const serialized = JSON.stringify(loaded);
      expect(serialized.includes(CANARY), "a response body leaked into a load verdict").toBe(false);
      expect(serialized.includes(K1.secretHex), "served material leaked into a load verdict").toBe(false);
      expect(serialized.includes(K2.secretHex), "served material leaked into a load verdict").toBe(false);
    }
  });

  it("the baseUrl and the token never enter any verdict", async () => {
    const { loaded } = await loadWith({ current: { kind: "refuse" } });
    const serialized = JSON.stringify(loaded);
    expect(serialized.includes("127.0.0.1")).toBe(false);
    expect(serialized.includes(TOKEN)).toBe(false);
  });
});

describe("loadKmsKeyringProvider — honest snapshot semantics", () => {
  it("an incoherent snapshot (current not in the served set) refuses fail-closed", async () => {
    // The default table only knows K1/K2; a ghost current is not resolvable
    // -> the loader must refuse (never a provider whose current key
    // resolves to nothing).
    const { loaded } = await loadWith({ current: { kind: "ok", keyId: "kms-ghost-current" }, resolve: defaultTable });
    expect(loaded.ok).toBe(false);
  });

  it("a retired key's grace deadline flows through the port verbatim (retireAt + verify-grace at the composition)", async () => {
    const { loaded } = await loadWith({});
    if (!loaded.ok) throw new Error("unreachable");
    // K2 is a rotated-out key inside its grace window: the adapter serves
    // its material + deadline; the F370B composition verifies it in grace
    // and retires it past the deadline (the refusal ladder over the kms
    // source, exactly as over file/env).
    const issued = issueKeyedSession({
      provider: { ...loaded.provider, currentKeyId: () => K2.keyId },
      actorId: "act_kms_adapter_01",
      tenantId: "acme-ops",
      scopes: ["marketplace.request"],
      issuedAt: NOW,
      expiresAt: NOW + 3_600_000,
      jti: "jti-kms-adapter-2",
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("unreachable");
    expect(issued.keyId).toBe(K2.keyId);
    const inGrace = verifyKeyedSession(issued.token, { provider: loaded.provider, now: K2_RETIRE_AT });
    expect(inGrace.ok).toBe(true);
    if (!inGrace.ok) throw new Error("unreachable");
    expect(inGrace.keyStatus).toBe("verify-grace");
    const retired = verifyKeyedSession(issued.token, { provider: loaded.provider, now: K2_RETIRE_AT + 1 });
    expect(retired.ok ? "accepted" : retired.reason).toBe("KEY_RETIRED");
  });
});
