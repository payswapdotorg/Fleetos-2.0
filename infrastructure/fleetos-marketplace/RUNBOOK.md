# fleetos-marketplace RUNBOOK — incident + rollback procedures (F370C)

The marketplace pilot's verified deployment service
(`infrastructure/fleetos-marketplace/service.ts`): one Node process,
`node:http` only, **REAL PostgreSQL** via `@electric-sql/pglite` (the
official WASM build, in-process) at the data dir, the deployment port
fixed at **:3107** (bound to `127.0.0.1` — the sandbox localhost law).

**THE ROLLBACK LAW: `--restore` IS THE RECORDED INCIDENT PATH. NEVER
ad-hoc SQL.** The store refuses to serve mutated history (the dump's
envelope digests are re-verified at restore; any mismatch is a fail-closed
refusal to boot). The backup/restore journey
(`marketplace-backup-restore`, packages/acceptance/commerce) drives THESE
EXACT PROCEDURES as its steps — the doc and the test cannot drift.

Environment (all procedures):

```bash
export FLEETOS_SESSION_KEYRING_JSON='{"currentKeyId":"…","keys":[…]}'   # REQUIRED (the F370B env provider)
export FLEETOS_MARKETPLACE_DATA=/var/lib/fleetos-marketplace            # default: ./infrastructure/fleetos-marketplace/data
# FLEETOS_MARKETPLACE_PORT=3107 (the fixed deployment port; the env
# override exists solely for the journeys' ephemeral isolated instances)
```

## 0. The proof surfaces (read-only)

| Surface | Command |
| --- | --- |
| Liveness + verify-on-start report + counters | `curl -s localhost:3107/api/health \| jq` |
| The full digest envelope (13 record sets + total) | `curl -s localhost:3107/api/digest \| jq .digests` |
| A tenant's record families (authenticated) | `curl -s -H "Authorization: Bearer $TOKEN" "localhost:3107/api/marketplace/state?family=requests&tenantId=acme&now=<epoch-ms>" \| jq` |

The digest envelope covers: requests, offers, comparisonSheets, orders,
providerAcks, receipts, enrollments, approvals, evidence, assets, twins,
audit, revocations (+ a `total`). It is **byte-stable across restarts and
restore round-trips** — the crash/recovery proof compares exactly these
values.

## 1. The restart procedure (crash or planned restart)

The service is stateless except for its PostgreSQL data dir: **restart =
stop + start**. Nothing is rebuilt from logs; the store IS the state.

1. Stop: `kill <pid>` (SIGTERM drains and closes; a SIGKILL is equally
   safe — PostgreSQL's own WAL recovers the data dir on the next boot,
   which is exactly what the crash-restart journey asserts).
2. Start:

   ```bash
   node --experimental-transform-types --no-warnings \
        --import ./infrastructure/fleetos-marketplace/runtime.mjs \
        infrastructure/fleetos-marketplace/service.ts
   ```

3. Verify (fail-closed — the service refuses to start on any
   replay/verify mismatch):

   ```bash
   curl -s localhost:3107/api/health | jq .verify     # ok: true, receipts replayed + byte-verified
   curl -s localhost:3107/api/digest | jq .digests.total   # MUST equal the pre-stop value
   ```

**The machine proof:** the `marketplace-persistence-spine` journey
SIGKILLs the service mid-spine and asserts `digestsIdentical: true` twice
(once before any receipt exists, once with a decided receipt that the
boot replays and verifies byte-exactly).

## 2. The backup procedure

`dumpStore()` produces a **single canonical-JSON file** (format
`fleetos-marketplace-dump/1`): every record set + the journals + the
operational state (credentials, the backups ledger) + the digest
envelope. The dump event is **journaled as data** (the backups ledger —
with the caller-supplied logical `now`, never a wall clock).

```bash
curl -s "localhost:3107/api/admin/backup?now=<epoch-ms>" \
  | jq -r .dump > /var/backups/fleetos-marketplace-$(date -u +%Y%m%dT%H%M%SZ).json
# Record the envelope digest next to the file (the restore re-verifies it,
# but the operator ledger should carry it too):
curl -s "localhost:3107/api/admin/backup?now=<epoch-ms>" | jq -r .envelope.digests.total
```

Keep the file (and its recorded envelope digest) on separate storage. The
dump is deterministic in its business content: identical spine state ⇒
identical envelope digests.

## 3. The restore procedure (THE recorded incident path)

The service is DOWN (or about to be). Restore = **wipe + import +
re-verify + serve**, all inside the service binary's `--restore` boot:

```bash
# 1. THE INCIDENT: the service is down (or stop it now).
# 2. Restore from the dump file (fail-closed):
node --experimental-transform-types --no-warnings \
     --import ./infrastructure/fleetos-marketplace/runtime.mjs \
     infrastructure/fleetos-marketplace/service.ts \
     --restore /var/backups/fleetos-marketplace-20261015T120000Z.json \
     --at <epoch-ms>
# 3. The boot wipes the data dir's tables, imports the dump in ONE
#    transaction, recomputes every digest and REFUSES TO SERVE on any
#    mismatch with the dump's envelope (tamper evidence).
# 4. Verify:
curl -s localhost:3107/api/health | jq .verify
curl -s localhost:3107/api/digest | jq .digests.total
#    MUST equal the dump's recorded envelope digest — the business record
#    sets and the audit journal are byte-identical; the backups ledger has
#    grown by exactly one `restore` entry (the incident's own record).
```

**NEVER ad-hoc SQL.** If `--restore` refuses (envelope mismatch /
record-set mismatch), the dump file is corrupted or foreign — do NOT
force it; take a fresher dump or escalate. The restore journal entry
(`--at`, the operator's logical time) is part of the ledger the next
backup carries forward.

**The machine proof:** the `marketplace-backup-restore` journey seeds the
full spine, dumps, SIGKILLs, boots with `--restore`, and asserts the
digest envelope identical, every family intact (requests / orders /
receipts / enrollments), the credential directory alive (the post-restore
login works), and the restored service still serving writes (the order's
final transition).

## 4. Key rotation + revocation (the F370B seams at the boundary)

- **Keyring**: supplied via `FLEETOS_SESSION_KEYRING_JSON` (or
  `FLEETOS_SESSION_KEYRING_FILE`) at boot — the REAL F370B providers. To
  rotate: build the rotated snapshot (`rotateKeyring`, the pure F370B
  operation), swap the env/file, restart. Retired keys keep refusing
  `KEY_RETIRED` (never deleted); tokens minted under them within the
  verify-grace window still authorize — the boundary journey pins both.
- **Revocations**: `POST /api/auth/revocations` (self-scope: a session
  revokes its own jti or sweeps its own actor). Revocations are
  **journaled in the store and replayed on every boot** — a restart never
  forgets them (the F370B honest limitation, closed at this boundary; the
  boundary journey asserts the revoked token is STILL refused after a
  crash-restart).

## 5. Honest scope

- pglite is the WASM build of REAL PostgreSQL **in-process**; a
  networked-PG adapter at the host boundary is the recorded follow-up
  (the store PORT stays swappable — `store.ts`).
- The admin backup endpoint trusts the localhost boundary (the sandbox
  law); a network-fronted deployment needs an operator auth channel —
  same follow-up class.
- Single process, single connection, single writer (concurrent mutating
  requests serialize); multi-replica is networked-PG-class.
- Nothing here is live: the F369/F371 pilot gate stays BLOCKED; provider
  seams stay manual and labelled.
