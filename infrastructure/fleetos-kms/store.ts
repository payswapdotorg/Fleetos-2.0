/**
 * infrastructure/fleetos-kms/store.ts — the at-rest store (F373).
 *
 * Two files under the service data dir (gitignored):
 *   - kms-state.json — the envelope-encrypted state (NO plaintext key
 *     material — machine-scanned by the kms-boundary journey). Written
 *     ATOMICALLY (tmp file + fsync + rename) per mutation, BEFORE the
 *     HTTP response (write-before-ack);
 *   - kms-audit.jsonl — the append-only audit journal (one JSON line per
 *     op; write + fsync before the response; a torn trailing line from a
 *     SIGKILL mid-append is dropped on replay — the F351A precedent; a
 *     corrupt line anywhere else is a hard failure, fail-closed).
 *
 * Recovery order note (recorded honestly): a mutation persists the state
 * file FIRST, then appends its audit line, then acks. A SIGKILL in the
 * microseconds between the two writes leaves the journal one entry behind
 * the state (an unacknowledged op present in the key-set truth; the client
 * never saw an ack). The state file is the recovery truth for the key set;
 * the journal is the audit trail — recovery replays the journal for
 * reporting only, never to rebuild keys. Journeys crash only at post-ack
 * points, where both writes are complete (the ack is the boundary).
 */

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, writeSync, fsyncSync } from "node:fs";
import * as path from "node:path";
import type { KmsAuditEntry, KmsStateFile } from "./kms-core.js";

/** The boot-read recovery report (health observability as data). */
export interface KmsRecoveryReport {
  readonly recovered: boolean;
  readonly keys: number;
  readonly admins: number;
  readonly adminTokenKeyRecovered: boolean;
  readonly auditEntries: number;
  readonly droppedTornAuditLines: number;
  readonly freshBoot: boolean;
}

export class KmsStore {
  private readonly dir: string;
  private readonly statePath: string;
  private readonly stateTmpPath: string;
  private readonly auditPath: string;

  constructor(dataDir: string) {
    this.dir = dataDir;
    this.statePath = path.join(dataDir, "kms-state.json");
    this.stateTmpPath = path.join(dataDir, "kms-state.json.tmp");
    this.auditPath = path.join(dataDir, "kms-audit.jsonl");
    mkdirSync(dataDir, { recursive: true });
  }

  dataDir(): string {
    return this.dir;
  }

  /** Read the at-rest state file, if any. A present-but-unparsable file is
   *  a hard failure (fail-closed — refuse to serve a mutated envelope). */
  readStateFile(): { ok: true; file: KmsStateFile } | { ok: false; reason: "absent" | "corrupt" } {
    let text: string;
    try {
      text = readFileSync(this.statePath, "utf8");
    } catch {
      return { ok: false, reason: "absent" };
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "corrupt" };
      return { ok: true, file: parsed as KmsStateFile };
    } catch {
      return { ok: false, reason: "corrupt" };
    }
  }

  /** WRITE-BEFORE-ACK persist of the state file: tmp + fsync + rename. */
  persistStateFile(file: KmsStateFile): void {
    const text = JSON.stringify(file);
    const fd = openSync(this.stateTmpPath, "w");
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(this.stateTmpPath, this.statePath);
  }

  /** WRITE-BEFORE-ACK append of one audit line (write + fsync). */
  appendAudit(entry: KmsAuditEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    const fd = openSync(this.auditPath, "a");
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /** Replay the audit journal. A torn TRAILING line (SIGKILL mid-append of
   *  an unacked op) is dropped and reported; a corrupt line elsewhere is a
   *  hard failure (fail-closed). */
  readAuditJournal(): { ok: true; entries: KmsAuditEntry[]; droppedTorn: number } | { ok: false; reason: string } {
    let text: string;
    try {
      text = readFileSync(this.auditPath, "utf8");
    } catch {
      return { ok: true, entries: [], droppedTorn: 0 };
    }
    const lines = text.split("\n").filter((l) => l.length > 0);
    const entries: KmsAuditEntry[] = [];
    let droppedTorn = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { ok: false, reason: "audit journal contains a corrupt line (fail-closed)" };
        }
        const e = parsed as Record<string, unknown>;
        if (typeof e["opSeq"] !== "number" || typeof e["op"] !== "string" || typeof e["actor"] !== "string" || typeof e["detail"] !== "string") {
          return { ok: false, reason: "audit journal contains a corrupt line (fail-closed)" };
        }
        if (e["opSeq"] !== entries.length + 1 + droppedTorn) {
          return { ok: false, reason: "audit journal op sequence is not contiguous (fail-closed)" };
        }
        entries.push({ opSeq: e["opSeq"], op: e["op"] as KmsAuditEntry["op"], actor: e["actor"], detail: e["detail"] });
      } catch {
        if (i === lines.length - 1) {
          droppedTorn += 1;
        } else {
          return { ok: false, reason: "audit journal contains a corrupt line (fail-closed)" };
        }
      }
    }
    return { ok: true, entries, droppedTorn };
  }
}
