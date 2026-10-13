# infrastructure/fleetos-durable — the durable deployment service (F351A)

One Node process, one fixed port **:3106**, `node:http` only (no framework,
no new top-level dependencies — node: builtins + the REAL `@fleetos` domain
packages, composed through the ESM resolve hooks in `hooks.mjs` because the
workspace ships raw TypeScript sources).

Serves BOTH:

1. **the static shell** — `packages/web/dist-fleetos/` (build first:
   `cd packages/web && npx vite build --config vite.fleetos.config.ts`;
   build at the lane-tip SHA so the footer's `__FLEETOS_COMMIT__` proves the
   candidate). Hash routing with an SPA fallback.
2. **the durable API** — the operational plane, append-only JSONL segments
   under `data/` (gitignored):
   - `commands.jsonl` — the REAL control-plane command-queue records (one
     line per UNIQUE enqueue; duplicates never enqueue, so they never append)
   - `audit.jsonl` — one line per command-submission attempt (acks,
     duplicates and refusals — the durable analog of the in-process
     submission log, extended with `tenantId` for fail-closed scoped reads)
   - `assets.jsonl` — one line per successful device enrollment: the REAL
     `EnrollmentRecord` + the kernel `AuditEventRef` it emitted

## The laws (F350 §2)

- **Write-before-ack** — every append is a single write + `fsync` to the
  segment before the HTTP response is sent.
- **Replay-on-start** — every boot rebuilds the full state by re-driving the
  segments through the REAL `CommandQueue` / `EnrollmentDirectory` and
  verifies each regenerated record byte-exactly (canonical JSON) against the
  persisted one; any mismatch is a hard, fail-closed refusal to start.
- **Idempotency exactly as the in-process contract** — a duplicate logical
  intent returns the ORIGINAL ack with `duplicate=true`; the command is never
  enqueued twice (the REAL queue's dedupe law, unmodified).
- **Tenant-scoping fail-closed** — contexts are kernel-validated; reads are
  strictly ctx-scoped (other tenants' records are absent, not hidden-but-
  enumerable); a draft whose tenant does not match the submission context is
  refused (`tenant-mismatch`), never recorded.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | liveness + commit + replay report |
| `GET /api/digest` | full record-set digests (sha256 over canonical JSON, per segment + total) — the operator proof surface |
| `GET /api/state?tenantId=&actorId=` | tenant-scoped queue records, submission log (newest first), enrollments + per-tenant digests |
| `POST /api/commands` | `{tenantId, actorId, draft}` — submit a lane CommandDraft (built with the REAL lane builders, the same ones the shell uses); returns the `TowerSubmitResult` verbatim |
| `POST /api/enrollments` | `{tenantId, actorId, deviceId}` — enroll a device through the REAL `EnrollmentDirectory`; returns its result verbatim |

## Run

```bash
# build the shell first (at the lane-tip SHA):
cd packages/web && npx vite build --config vite.fleetos.config.ts && cd ../..

# the service (single run):
node --experimental-transform-types --no-warnings \
  --import ./infrastructure/fleetos-durable/runtime.mjs \
  infrastructure/fleetos-durable/service.ts

# the supervisor-kept deployment (restarts on any exit, incl. SIGKILL):
node infrastructure/fleetos-durable/supervisor.mjs

# the Q2 restart-recovery proof (seed -> digest -> kill -9 -> restart -> re-digest):
node --experimental-transform-types --no-warnings \
  --import ./infrastructure/fleetos-durable/runtime.mjs \
  infrastructure/fleetos-durable/proof-restart.mjs
```

`FLEETOS_DURABLE_DATA` overrides the data dir (the proof uses an isolated
temp dir; the deployment default is `./data`). The port is fixed at 3106.

## Honest scope (Q4)

Sandbox-hosted (single external port occupied by the resident console — no
public-internet claim). Providers stay CONTRACT_ONLY. The fixture WORLD
(observations, sim-worlds) remains the domain-input convention composed
in-browser; what is durable here is the OPERATIONAL plane only: commands,
the submission audit log, and enrollments. Actor identity is validated for
shape/scope, not authenticated — the same trust model as the shell demo.
