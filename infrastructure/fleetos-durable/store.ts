/**
 * infrastructure/fleetos-durable/store.ts — the append-only segment store
 * (F351A, Q1/Q2).
 *
 * Three JSONL segments under the data dir (gitignored):
 *   - commands.jsonl — one line per UNIQUE enqueued command (the REAL
 *     control-plane CommandRecord). Duplicates never enqueue, so they never
 *     append; refusals never append (they are audit facts, not queue state).
 *   - audit.jsonl   — one line per command-submission ATTEMPT (ack, duplicate
 *     and refusal alike) — the durable analog of the in-process submission
 *     log (commandPath.ts), extended with the tenantId the durable plane
 *     needs for fail-closed tenant-scoped reads.
 *   - assets.jsonl  — one line per successful device enrollment: the REAL
 *     EnrollmentRecord plus the kernel AuditEventRef the EnrollmentDirectory
 *     emitted for it.
 *
 * Laws implemented here:
 *   - WRITE-BEFORE-ACK: append() writes the line AND fsyncs it to the segment
 *     BEFORE returning — the caller only responds to HTTP after append()
 *     returns. Acked records are on disk.
 *   - REPLAY-ON-START: load() re-reads the segments; a torn trailing line
 *     (a SIGKILL landing mid-write of an UNACKED record) is dropped with a
 *     logged warning; a corrupt line anywhere else is a hard failure
 *     (fail-closed — the store refuses to serve mutated history).
 *   - Order: records keep append (segment) order; digests are defined over
 *     that order, so they are byte-stable across restarts.
 */

import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync, fsyncSync } from "node:fs";
import * as path from "node:path";
import type { CommandRecord } from "@fleetos/control-plane";
import type { AuditEventRef, EnrollmentRecord } from "@fleetos/assets";

// ---------------------------------------------------------------------------
// Record shapes (the durable plane's persisted forms)
// ---------------------------------------------------------------------------

/** The in-process SubmissionRecord (commandPath.ts) + the scoping tenant. */
export interface DurableSubmissionRecord {
  readonly at: number;
  readonly kind: string;
  readonly actor: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly commandId: string | null;
  readonly duplicate: boolean;
  readonly idempotencyKey: string;
  readonly tenantId: string;
}

/** A successful enrollment + the kernel audit ref it emitted. */
export interface DurableAssetRecord {
  readonly enrollment: EnrollmentRecord;
  readonly audit: AuditEventRef;
}

export type SegmentName = "commands" | "audit" | "assets";

export interface SegmentDigests {
  readonly commands: string;
  readonly audit: string;
  readonly assets: string;
  readonly total: string;
}

export interface SegmentCounts {
  readonly commands: number;
  readonly audit: number;
  readonly assets: number;
}

// ---------------------------------------------------------------------------
// Canonical JSON + digests — same convention family as the tower's
// canonicalJson (sorted keys, array order preserved), hashed with sha256.
// ---------------------------------------------------------------------------

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Digests over a record set, in the fixed segment order (commands/audit/assets). */
export function digestsOf(
  commands: readonly unknown[],
  audit: readonly unknown[],
  assets: readonly unknown[],
): SegmentDigests {
  const c = sha256Hex(canonicalJson(commands));
  const a = sha256Hex(canonicalJson(audit));
  const s = sha256Hex(canonicalJson(assets));
  const total = sha256Hex(
    canonicalJson({ assets, audit, commands }),
  );
  return { commands: c, audit: a, assets: s, total };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const SEGMENT_FILES: Readonly<Record<SegmentName, string>> = {
  commands: "commands.jsonl",
  audit: "audit.jsonl",
  assets: "assets.jsonl",
};

export class DurableStore {
  readonly dataDir: string;
  private readonly commands: CommandRecord[] = [];
  private readonly audit: DurableSubmissionRecord[] = [];
  private readonly assets: DurableAssetRecord[] = [];
  /** Count of torn trailing lines dropped at load (unacked writes at kill). */
  tornLines = 0;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  }

  private segmentPath(name: SegmentName): string {
    return path.join(this.dataDir, SEGMENT_FILES[name]);
  }

  /** WRITE-BEFORE-ACK append: single write + fsync, then the caller may ack. */
  private append(name: SegmentName, record: unknown): void {
    const line = `${JSON.stringify(record)}\n`;
    const fd = openSync(this.segmentPath(name), "a");
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /** Load a segment's lines. A torn LAST line (unacked write at SIGKILL) is
   *  dropped with a warning; any other parse failure is fatal. */
  private loadSegment(name: SegmentName): unknown[] {
    const file = this.segmentPath(name);
    if (!existsSync(file)) return [];
    const text = readFileSync(file, "utf-8");
    const out: unknown[] = [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined || line === "") continue;
      try {
        out.push(JSON.parse(line) as unknown);
      } catch (error) {
        if (i === lines.length - 1) {
          this.tornLines += 1;
          console.warn(
            `[fleetos-durable] ${SEGMENT_FILES[name]}: dropping torn trailing line (unacked write at kill): ${(error as Error).message}`,
          );
          continue;
        }
        throw new Error(
          `segment ${SEGMENT_FILES[name]} line ${i + 1} is corrupt — refusing to serve mutated history (fail-closed)`,
        );
      }
    }
    return out;
  }

  // --- live appends (each: write+fsync, then in-memory bookkeeping) ---

  appendCommand(record: CommandRecord): void {
    this.append("commands", record);
    this.commands.push(record);
  }

  appendAudit(entry: DurableSubmissionRecord): void {
    this.append("audit", entry);
    this.audit.push(entry);
  }

  appendAsset(record: DurableAssetRecord): void {
    this.append("assets", record);
    this.assets.push(record);
  }

  // --- loads used by replay-on-start ---

  loadCommandLines(): unknown[] {
    return this.loadSegment("commands");
  }

  loadAuditLines(): unknown[] {
    return this.loadSegment("audit");
  }

  loadAssetLines(): unknown[] {
    return this.loadSegment("assets");
  }

  /** Adopt the replayed records as the live in-memory state. */
  adopt(commands: readonly CommandRecord[], audit: readonly DurableSubmissionRecord[], assets: readonly DurableAssetRecord[]): void {
    this.commands.length = 0;
    this.commands.push(...commands);
    this.audit.length = 0;
    this.audit.push(...audit);
    this.assets.length = 0;
    this.assets.push(...assets);
  }

  // --- reads (append order preserved; digests defined over this order) ---

  commandsAll(): readonly CommandRecord[] {
    return this.commands;
  }

  auditAll(): readonly DurableSubmissionRecord[] {
    return this.audit;
  }

  assetsAll(): readonly DurableAssetRecord[] {
    return this.assets;
  }

  commandsByTenant(tenantId: string): CommandRecord[] {
    return this.commands.filter((r) => String(r.envelope.tenantId) === tenantId);
  }

  auditByTenant(tenantId: string): DurableSubmissionRecord[] {
    return this.audit.filter((r) => r.tenantId === tenantId);
  }

  assetsByTenant(tenantId: string): DurableAssetRecord[] {
    return this.assets.filter((r) => r.enrollment.tenantId === tenantId);
  }

  digestsAll(): SegmentDigests {
    return digestsOf(this.commands, this.audit, this.assets);
  }

  digestsByTenant(tenantId: string): SegmentDigests {
    return digestsOf(this.commandsByTenant(tenantId), this.auditByTenant(tenantId), this.assetsByTenant(tenantId));
  }

  countsAll(): SegmentCounts {
    return { commands: this.commands.length, audit: this.audit.length, assets: this.assets.length };
  }
}
