# fleetos-kms — the FleetOS key-management service (F373, Wave 19 lane B)

ONE Node process, `node:http` only (the F351A service laws; the F351A/F370C
resolve-hooks precedent via `hooks.mjs`/`runtime.mjs`). This service gives
the keyring a REAL KMS-class trust boundary: it owns the key material at
rest (envelope-encrypted), serves it over an AUTHENTICATED API, rotates it
through that API with a full append-only audit journal, and survives its
own crash-restart. The honest label: a **self-hosted KMS daemon** — REAL in
process boundary, at-rest encryption, API discipline and audit; cloud/HSM
KMS adapters (AWS/GCP/Vault) stay operator-credential-gated seams, never
pretended here.

## The trust boundary (plainly labelled)

- The **master key** exists only at THIS process boundary — env/file AT THE
  SERVICE (`FLEETOS_KMS_MASTER_KEY` / `FLEETOS_KMS_MASTER_KEY_FILE`, 64 hex
  = 32 bytes). Neither set => fail-closed refusal to boot.
- **Data keys** (the keyring's HMAC-SHA256 signing keys + the service's own
  admin token key) live only in the process (unwrapped) and in the at-rest
  envelope (`AES-256-GCM`, `wrapped` = b64(iv|ct|tag)). The state file
  contains NO plaintext key material (machine-scanned by the journeys).
- Key material is served ONLY over the authenticated resolve channel to the
  keyring adapter (`@fleetos/identity/keyring-kms`) — never wrapped for
  caller-side unwrapping, never in logs/errors/audit/health.

## Environment

| variable | default | law |
|---|---|---|
| `FLEETOS_KMS_PORT` | `3108` (the service-census port) | `0`/overrides exist solely for the journeys' ephemeral isolated instances |
| `FLEETOS_KMS_HOST` | `127.0.0.1` | the sandbox localhost law |
| `FLEETOS_KMS_DATA` | `<here>/data` (gitignored) | `kms-state.json` + `kms-audit.jsonl` |
| `FLEETOS_KMS_MASTER_KEY` | — | 64 hex; fail-closed without one (or `_FILE`) |
| `FLEETOS_KMS_RANDOM_STREAM` | — | a JSON array of hex draws for the SecureRandom port — TEST/CORPUS ONLY (plainly labelled; reported by `/api/health`); absent => node:crypto randomBytes (the F370B host-boundary recipe) |

## API (all JSON; logical `now` on every request — query for GET, body for POST)

```
GET  /api/health                 liveness + recovery report + bindings (no secrets)
POST /api/admin/credentials      the journaled bootstrap seam (unauthenticated)
POST /api/session                login => an fka1 admin session token (HMAC-SHA256, expiry, tamper => SIGNATURE_INVALID)
GET  /api/keys/current           the current key id                        (auth)
GET  /api/keys                   the key ids, creation order               (auth)
POST /api/keys/resolve           key material over the authenticated channel (auth; the ONLY material-serving route)
POST /api/keys/create            the first-key bootstrap draw              (auth)
POST /api/keys/rotate            the REAL F370B rotateKeyring kernel      (auth)
GET  /api/audit                  the append-only journal (who/what/when-as-op-seq; no secrets)
```

Refusals are frozen reason codes (verdicts-as-data): `UNAUTHENTICATED`,
`SIGNATURE_INVALID`, `SESSION_EXPIRED`, `ADMIN_CREDENTIAL_INVALID` (byte-
identical for unknown admin / wrong secret / malformed — enumeration-
resistant), `ADMIN_EXISTS`, `KEY_UNKNOWN`, `KEY_EXISTS`, `MALFORMED`.

## Crash-restart law

Mutations persist state-first (atomic tmp+fsync+rename), then append the
audit line (fsync), then ack. A SIGKILL between the two writes leaves the
journal one entry behind the state (the unacknowledged op is present in the
key-set truth; the client never saw an ack) — the state file IS the
recovery truth; the journal replays for reporting only. Boot re-unwraps the
envelope (fail-closed on any GCM failure — tampered at rest / wrong master
key) and re-serves identical digests/verdicts (machine-proved by the
`security.kms-crash-restart` journey).

## Run

```
node --experimental-transform-types --no-warnings --import ./runtime.mjs service.ts
FLEETOS_KMS_MASTER_KEY=<64-hex>     # required — fail-closed without it
./proof-smoke.sh                    # the operator one-shot (boot -> API -> SIGKILL -> restart)
```
