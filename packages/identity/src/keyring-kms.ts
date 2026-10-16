/**
 * @fleetos/identity — F373 the real-KMS keyring adapter (keyring-kms.ts).
 *
 * The F373 packet deliverable 2: the `kms` source provider at the EXISTING
 * `KeyringProvider` port — the F370B contract VERBATIM
 * (currentKeyId/resolveKeyMaterial/listKeyIds); the composition
 * `issueKeyedSession` + `verifyKeyedSession` + `rotateKeyring` stays
 * UNTOUCHED (zero edits in keyring.ts beyond the grow-only `kms` source
 * label). The F370B fixture/file/env providers stay, labels unchanged —
 * configuration-class fallbacks; THIS source is the KMS class.
 *
 * The adapter is a SNAPSHOT loader (`loadKmsKeyringProvider`): it logs in
 * through nothing — the host/journey obtains an admin session token over
 * the KMS's authenticated API (`POST /api/session`) and hands it to the
 * factory — then the factory prefetches the WHOLE key set over the
 * authenticated API (current -> list -> resolve every id) and returns a
 * synchronous provider over the snapshot, exactly like the file/env
 * loaders (a boot-time snapshot; a refresh/poll class adapter is the
 * recorded follow-up, never pretended here). The material therefore
 * arrives ONLY over the authenticated channel to this adapter — never
 * wrapped for local unwrapping, never in logs/errors (fixed-string
 * refusals; response bodies are never echoed — the no-leak law).
 *
 * Host seam: `fetchImpl` — injectable for tests (deterministic fake
 * responders; the domain package stays network-free under test). The
 * default binding is the ambient `fetch` — the production host's
 * transport. The caller-supplied `now` is the logical instant of the
 * snapshot (the KMS checks the admin session's expiry against it).
 */

import type {
  KeyringData,
  KeyringKeyEntry,
  KeyringProvider,
  KeyringProviderLoadResult,
} from "./keyring.js";
import { keyringProviderFromData } from "./keyring.js";

/** The injectable transport seam. Tests inject fake responders; the
 *  production host uses the default (ambient fetch). */
export type KmsFetch = (url: string, init: { readonly method: string; readonly headers: Record<string, string>; readonly body?: string }) => Promise<{ readonly status: number; readonly json: () => Promise<unknown> }>;

/** The load input. `token` is a pre-issued KMS admin session token — the
 *  host obtained it over the authenticated login API; the adapter never
 *  sees the admin credential. `baseUrl` never enters any refusal detail. */
export interface KmsKeyringInput {
  readonly baseUrl: string;
  readonly token: string;
  readonly now: number;
  readonly fetchImpl?: KmsFetch;
}

const DEFAULT_FETCH_IMPL: KmsFetch = (url, init) => fetch(url, init);

function isHex64(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && /^[0-9a-fA-F]+$/.test(value);
}

function kmsCall(fetchImpl: KmsFetch, input: KmsKeyringInput, method: "GET" | "POST", path: string, body?: string): Promise<unknown> {
  return fetchImpl(`${input.baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${input.token}` },
    ...(body === undefined ? {} : { body }),
  }).then((res) => {
    if (res.status !== 200) return Promise.reject(new Error(`kms-refused:${res.status}`));
    return res.json();
  });
}

/**
 * Load the keyring snapshot from the REAL KMS over its authenticated API:
 * current -> list -> resolve every id. Every refusal is a fixed-string
 * verdict (response bodies are NEVER echoed — a body could carry material
 * on a successful resolve; a refused one must never enter an error).
 */
export async function loadKmsKeyringProvider(input: KmsKeyringInput): Promise<KeyringProviderLoadResult> {
  const fetchImpl = input.fetchImpl ?? DEFAULT_FETCH_IMPL;
  const nowQuery = String(input.now);
  let current: unknown;
  try {
    current = await kmsCall(fetchImpl, input, "GET", `/api/keys/current?now=${nowQuery}`);
  } catch {
    return { ok: false, reason: "malformed", detail: "the KMS currentKey call failed (never echoed)" };
  }
  if (current === null || typeof current !== "object" || Array.isArray(current)) {
    return { ok: false, reason: "malformed", detail: "the KMS currentKey response is malformed (never echoed)" };
  }
  const currentKeyId = (current as Record<string, unknown>)["keyId"];
  if (typeof currentKeyId !== "string" || currentKeyId.length === 0) {
    return { ok: false, reason: "malformed", detail: "the KMS reports no current key (create or rotate first)" };
  }
  let list: unknown;
  try {
    list = await kmsCall(fetchImpl, input, "GET", `/api/keys?now=${nowQuery}`);
  } catch {
    return { ok: false, reason: "malformed", detail: "the KMS listKeyIds call failed (never echoed)" };
  }
  if (list === null || typeof list !== "object" || Array.isArray(list)) {
    return { ok: false, reason: "malformed", detail: "the KMS listKeyIds response is malformed (never echoed)" };
  }
  const rawIds = (list as Record<string, unknown>)["keyIds"];
  if (!Array.isArray(rawIds) || rawIds.length === 0 || !rawIds.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
    return { ok: false, reason: "malformed", detail: "the KMS key id list is malformed (never echoed)" };
  }
  const keyIds = rawIds as readonly string[];
  const entries: KeyringKeyEntry[] = [];
  for (const keyId of keyIds) {
    let served: unknown;
    try {
      served = await kmsCall(fetchImpl, input, "POST", "/api/keys/resolve", JSON.stringify({ keyId, now: input.now }));
    } catch {
      return { ok: false, reason: "malformed", detail: "the KMS resolve call failed (never echoed)" };
    }
    if (served === null || typeof served !== "object" || Array.isArray(served)) {
      return { ok: false, reason: "malformed", detail: "the KMS resolve response is malformed (never echoed)" };
    }
    const s = served as Record<string, unknown>;
    const algorithm = s["algorithm"];
    const secretHex = s["secretHex"];
    const retireAt = s["retireAt"];
    if (algorithm !== "HMAC-SHA256" || !isHex64(secretHex)) {
      return { ok: false, reason: "malformed", detail: "the KMS-served material is malformed (never echoed)" };
    }
    if (retireAt !== null && (typeof retireAt !== "number" || !Number.isFinite(retireAt) || retireAt <= 0)) {
      return { ok: false, reason: "malformed", detail: "the KMS-served material is malformed (never echoed)" };
    }
    entries.push({ keyId, algorithm, secretHex, retireAt: retireAt ?? null });
  }
  const byId = new Map(entries.map((e) => [e.keyId, e]));
  if (!byId.has(currentKeyId)) {
    return { ok: false, reason: "malformed", detail: "the KMS current key does not resolve to served material (incoherent snapshot)" };
  }
  const data: KeyringData = { currentKeyId, keys: entries };
  const provider: KeyringProvider = { ...keyringProviderFromData(data), source: "kms" };
  return { ok: true, provider };
}
