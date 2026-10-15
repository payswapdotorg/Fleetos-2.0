# fleetos-marketplace — the marketplace pilot's verified deployment service (F370C)

ONE Node process, `node:http` only (no framework), **REAL PostgreSQL**
via [`@electric-sql/pglite`](https://pglite.dev) — the official WASM build
of PostgreSQL, in-process — as the authoritative business truth (law A1).
It composes the REAL Wave-17 kernels behind the F370A gate + the F370B
keyring, on the F351A service laws: write-before-ack (one PostgreSQL
transaction per request), verify-on-start (fail-closed), tenant
fail-closed (A8 — the caller tenant is the VERIFIED session's).

The F351A JSONL segments are NOT used for marketplace transaction state —
this service replaces that qualification with the real thing.

## The boundary stack

Every verb request passes: **verify credential** (F370A scrypt,
enumeration-resistant) → **issue keyed session** (the F370B keyring: the
`fsk1` envelope wrapping the untouched F370A kernel token) →
**authenticate** (the F370B keyring + revocation stack) → **authorize**
(the F370A gate — inside the REAL `marketplace-authenticated` composed
verbs where F370A wrapped the operation) → **delegate to the EXISTING
kernels** (never re-implemented) → **persist via the store**
(write-before-ack). Domain refusals are DATA in 200 responses (the
kernels' reason codes, verbatim).

## Run

```bash
export FLEETOS_SESSION_KEYRING_JSON='{"currentKeyId":"k1","keys":[{"keyId":"k1","algorithm":"HMAC-SHA256","secretHex":"<64 hex>","retireAt":null}]}'
node --experimental-transform-types --no-warnings \
     --import ./infrastructure/fleetos-marketplace/runtime.mjs \
     infrastructure/fleetos-marketplace/service.ts
# :3107 (bound to 127.0.0.1). FLEETOS_MARKETPLACE_DATA overrides the data
# dir; FLEETOS_MARKETPLACE_PORT exists solely for the journeys' ephemeral
# isolated instances.
```

See **RUNBOOK.md** for the restart/backup/restore procedures (the
rollback law: `--restore` is the recorded incident path, never ad-hoc
SQL) and `proof-smoke.mjs` for a one-shot end-to-end proof (spine →
SIGKILL → restart → dump → restore → digests identical).

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | liveness + the verify-on-start report + counters (observability as data) |
| `GET /api/digest` | the full digest envelope (13 record sets + total — byte-stable across restarts) |
| `POST /api/auth/credentials` | the bootstrap seam: provision a credential (F370B host-boundary salt; journaled) |
| `POST /api/auth/login` | verifyCredential → issueKeyedSession (scopes + ttl + jti caller-declared; jti always present) |
| `POST /api/auth/revocations` | self-scope revocation (own jti / own actor sweep) — persisted, replayed on boot |
| `POST /api/marketplace/requests` | the `request` verb: idempotent submit (natural-key law) |
| `POST /api/marketplace/request-transitions` | the request state machine (typed transitions) |
| `POST /api/marketplace/offers` | the `offer` verb: the full-schema capture |
| `GET /api/marketplace/offers/sheet?at=` | THE FRESHNESS LAW read model over the store's authoritative offers |
| `POST /api/marketplace/comparisons` | the `comparison` verb: hard constraints vs preference weights over the STORE's offers (supplier verifications composed at the boundary) |
| `POST /api/marketplace/orders` / `order-places` / `order-transitions` / `order-acks` | the `order` + `ack` verbs: the §3.4 lifecycle + the manual provider-ack seam (idempotent, duplicate-refusing) |
| `POST /api/marketplace/receipts` / `receipt-verifications` | the `receipt` verb: the F361A receipt state machine |
| `POST /api/marketplace/enrollments` / `enrollment-completions` | the `enrollment` verb: asset admission + the twin link (the REAL F361A ports over PostgreSQL) |
| `POST /api/marketplace/approvals` | the `approval` verb: the Guardian decision as DATA (approve OR refuse both retained) |
| `POST /api/marketplace/evidence` / `GET …/evidence` | the F361B evidence port over PostgreSQL (content-addressed, provider-event dedup) |
| `GET /api/marketplace/state?family=` | authenticated tenant-scoped record reads (the family's verb authorizes; audit = all eight scopes) |
| `GET /api/admin/backup?now=` | the host-operator dump (localhost boundary; journaled) |

Every request carries `now` (logical epoch ms) — the fixture-clock law;
no wall clock, no randomness enters any persisted record. The response
convention: `{ok, authorization, result}` | `{refusedBy: "boundary" |
"gate", refusal}` (401/403/400) | `{refusedBy: "domain",
domainRefusal}` (200 — the kernel's refusal as data).

## Files

- `store.ts` — the **MarketplaceStore PORT** (the frozen operation set)
- `schema.ts` — the PostgreSQL DDL (tenant-scoped tables, natural keys +
  idempotency exactly as the in-process contracts)
- `pglite-tables.ts` + `pglite-store.ts` — the pglite adapter (upserts,
  scoped reads, the digest envelope, dump/restore)
- `ports.ts` — the REAL F361A kernel ports over the store (write-back
  mirror, one flush per request = write-before-ack)
- `evidence-store.ts` — the F361B MarketplaceEvidenceStorePort over PG
- `auth.ts` — the F370B-stack boundary authentication + the F370A gate
- `recovery.ts` — replay/verify-on-start (receipts byte-exact through the
  REAL directory; revocations replayed)
- `api*.ts` — the handlers (response convention in `api.ts`)
- `service.ts` — the composition root + routing + the `--restore` CLI

## Honest scope

pglite is the WASM build of PostgreSQL **in-process** — a networked-PG
adapter at the host boundary is the recorded follow-up (the PORT stays
swappable). Sandbox localhost only; the admin plane trusts that boundary;
single process / single connection. Nothing is live: the F369/F371 gate
stays BLOCKED; the provider seams stay manual and labelled. The journeys
(`packages/acceptance/commerce`, ids `marketplace-persistence-spine` /
`marketplace-boundary-authorization` / `marketplace-backup-restore`)
drive THIS service as a real child process — ports and timestamps never
in their output.
