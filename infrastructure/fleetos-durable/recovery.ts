/**
 * infrastructure/fleetos-durable/recovery.ts — replay-on-start (F351A, Q2).
 *
 * On every boot the service rebuilds its ENTIRE operational state by replaying
 * the JSONL segments through the REAL domain objects — the same
 * `TowerCommandBus`/`CommandQueue` and `EnrollmentDirectory` the live path
 * uses — and verifies, record by record, that the regenerated state is
 * byte-identical (canonical-JSON compare) to what was persisted.
 *
 * Why re-drive instead of hydrating: the queue's in-memory records ARE its
 * state (idempotency dedupe map, per-tenant monotonic id counters, audit
 * digests). Re-submitting each persisted envelope in segment order rebuilds
 * all of it deterministically: same counter order → same `cmd_…` ids, same
 * inputs → same sha256 audit digests. A replay that regenerates anything that
 * differs from the persisted record is a corrupted or incompatible history —
 * the service refuses to start (fail-closed), it never silently serves a
 * mutated record set.
 */

import { makeTenantContext, type TenantContext } from "@fleetos/kernel";
import type { CommandQueue, CommandRecord } from "@fleetos/control-plane";
import type { EnrollmentDirectory } from "@fleetos/assets";
import { canonicalJson, type DurableAssetRecord, type DurableSubmissionRecord, type DurableStore } from "./store.js";

/** The fixed session identity the durable plane threads through every
 *  submission (the in-process shell uses sess_fleetos-console; the durable
 *  plane has its own — recorded so replay regenerates identical digests). */
export const DURABLE_SESSION_ID = "sess_fleetos-durable";

export function contextFor(tenantId: string, actorId: string, establishedAt: number): TenantContext {
  const r = makeTenantContext({
    tenantId,
    actorId,
    sessionId: DURABLE_SESSION_ID,
    establishedAt,
  });
  if (!r.ok) throw new Error(`tenant context refused: ${r.reason}`);
  return r.context;
}

function isRecord(value: unknown): value is CommandRecord {
  if (value === null || typeof value !== "object") return false;
  const envelope = (value as { envelope?: unknown }).envelope;
  return (
    envelope !== null &&
    typeof envelope === "object" &&
    typeof (envelope as { id?: unknown }).id === "string" &&
    typeof (envelope as { tenantId?: unknown }).tenantId === "string" &&
    typeof (envelope as { actorId?: unknown }).actorId === "string"
  );
}

export interface ReplayOutcome {
  readonly commands: number;
  readonly audit: number;
  readonly assets: number;
  readonly droppedTornLines: number;
}

/** Replay every segment. Throws (fail-closed) on any inconsistency. */
export function replaySegments(
  store: DurableStore,
  queue: CommandQueue,
  enrollmentDirectory: EnrollmentDirectory,
): ReplayOutcome {
  // --- commands: re-submit each persisted envelope, verify byte-exactness ---
  const commandLines = store.loadCommandLines();
  const commands: CommandRecord[] = [];
  for (const [i, line] of commandLines.entries()) {
    if (!isRecord(line)) {
      throw new Error(`commands.jsonl line ${i + 1}: not a command record — fail-closed`);
    }
    const envelope = line.envelope;
    const ctx = contextFor(String(envelope.tenantId), String(envelope.actorId), envelope.submittedAt);
    const submitted = queue.submit({
      ctx,
      command: {
        kind: envelope.kind,
        payload: envelope.payload,
        idempotencyKey: envelope.idempotencyKey,
        issuedAt: envelope.issuedAt,
        ...(envelope.availableAt > envelope.issuedAt ? { notBefore: envelope.availableAt } : {}),
      },
      now: envelope.submittedAt,
    });
    if (!submitted.ok) {
      throw new Error(
        `commands.jsonl line ${i + 1}: replay submit refused (${submitted.reason}) — fail-closed`,
      );
    }
    if (submitted.value.duplicate) {
      throw new Error(
        `commands.jsonl line ${i + 1}: replay hit the idempotency dedupe — the segment contains an impossible duplicate enqueue — fail-closed`,
      );
    }
    const regenerated = submitted.value.command;
    if (regenerated.id !== envelope.id || canonicalJson(regenerated) !== canonicalJson(envelope)) {
      throw new Error(
        `commands.jsonl line ${i + 1}: replay regenerated a byte-different envelope (id ${regenerated.id} vs persisted ${envelope.id}) — fail-closed`,
      );
    }
    const record = queue.findById(ctx, envelope.id);
    if (!record.ok || canonicalJson(record.value) !== canonicalJson(line)) {
      throw new Error(
        `commands.jsonl line ${i + 1}: replayed record differs from the persisted record — fail-closed`,
      );
    }
    commands.push(record.value);
  }

  // --- audit: persisted verbatim; shape-check only ---
  const auditLines = store.loadAuditLines();
  const audit: DurableSubmissionRecord[] = [];
  for (const [i, line] of auditLines.entries()) {
    const entry = line as Partial<DurableSubmissionRecord> | null;
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.kind !== "string" ||
      typeof entry.tenantId !== "string" ||
      typeof entry.at !== "number"
    ) {
      throw new Error(`audit.jsonl line ${i + 1}: malformed audit entry — fail-closed`);
    }
    audit.push(entry as DurableSubmissionRecord);
  }

  // --- assets: re-enroll each record through the REAL directory ---
  const assetLines = store.loadAssetLines();
  const assets: DurableAssetRecord[] = [];
  for (const [i, line] of assetLines.entries()) {
    const record = line as Partial<DurableAssetRecord> | null;
    if (
      record === null ||
      typeof record !== "object" ||
      record.enrollment === undefined ||
      record.audit === undefined
    ) {
      throw new Error(`assets.jsonl line ${i + 1}: malformed asset record — fail-closed`);
    }
    const enrollment = record.enrollment;
    const r = enrollmentDirectory.enroll({
      deviceId: enrollment.deviceId,
      tenantId: enrollment.tenantId,
      enrolledAt: enrollment.enrolledAt,
      actor: record.audit.actor,
    });
    if (!r.ok) {
      throw new Error(
        `assets.jsonl line ${i + 1}: replay enrollment refused (${r.reason}) — fail-closed`,
      );
    }
    if (canonicalJson({ enrollment: r.enrollment, audit: r.audit }) !== canonicalJson(line)) {
      throw new Error(
        `assets.jsonl line ${i + 1}: replayed enrollment differs from the persisted record — fail-closed`,
      );
    }
    assets.push({ enrollment: r.enrollment, audit: r.audit });
  }

  store.adopt(commands, audit, assets);
  return { commands: commands.length, audit: audit.length, assets: assets.length, droppedTornLines: store.tornLines };
}
