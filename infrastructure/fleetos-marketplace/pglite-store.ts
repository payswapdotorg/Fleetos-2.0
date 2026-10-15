/**
 * infrastructure/fleetos-marketplace/pglite-store.ts — the MarketplaceStore
 * adapter over @electric-sql/pglite (F370C, Wave 18 lane C).
 *
 * REAL PostgreSQL, the official WASM build, in-process (law A1: this store
 * IS the authoritative business truth). The PORT (store.ts) stays
 * swappable — a networked-PostgreSQL adapter at the host boundary is the
 * recorded follow-up, never pretended here. The F351A JSONL segments are
 * NOT used for marketplace transaction state.
 *
 * Schema: one table per record set, every business table tenant-scoped
 * (tenant_id as a leading key — law A8), natural keys exactly as the
 * in-process contracts (requests keyed tenant+natural key with UNIQUE
 * idempotency; evidence deduped by tenant+provider event; enrollments
 * keyed tenant+serial — the REAL registry port's key; orders/requests/
 * receipts upsert the latest kernel record verbatim as JSONB — the EXACT
 * kernel shapes, never re-shaped). Journals (audit, provider acks,
 * revocations, backups) are append-only with a monotonic seq; digests are
 * defined over natural-key order (record sets) and seq order (journals),
 * so they are byte-stable across restarts and restore round-trips.
 *
 * Write-before-ack: every mutating statement is a committed PostgreSQL
 * transaction before the promise resolves (PGlite's WAL — which is REAL
 * PostgreSQL's WAL: a SIGKILL between requests loses nothing; the machine
 * assertion is the F370C crash-restart journey).
 *
 * transact(): one request's multi-record writes (the business record +
 * its journal entries) commit in ONE transaction — the atomic boundary.
 * PGlite is single-connection; concurrent transactions serialize on its
 * internal mutex, so each transact() scope is linearizable.
 */

import { PGlite } from "@electric-sql/pglite";
import type {
  AssetEnrollmentRecord,
  DeviceTwin,
  ManagedAssetRecord,
  ReceiptEvidence,
} from "@fleetos/assets";
import type { MarketplaceEvidenceRecord } from "@fleetos/evidence";
import type { CredentialRecord } from "@fleetos/identity";
import type { EquipmentRequest, MarketplaceEquipmentOrder, MarketplaceOffer } from "@fleetos/procurement";
import type { MarketplaceOrderApproval } from "@fleetos/policy";
import { MARKETPLACE_SCHEMA_DDL } from "./schema.js";
import { APPROVALS, ASSETS, ENROLLMENTS, EVIDENCE, OFFERS, ORDERS, RECEIPTS, REQUESTS, SHEETS, TWINS, type PgExecutor, type TableSpec, asRecord, parseRecord, specTenant } from "./pglite-tables.js";
import {
  DIGEST_RECORD_SETS,
  DUMP_FORMAT,
  canonicalJson,
  digestsOfRecordSets,
  sha256Hex,
  type BackupJournalEntry,
  type MarketplaceAuditEntry,
  type MarketplaceStore,
  type MarketplaceStoreCaller,
  type MarketplaceStoreCounts,
  type MarketplaceStoreDigests,
  type PersistedReceipt,
  type ProviderAckJournalEntry,
  type RestoreResult,
  type RetainedComparisonSheet,
  type RevocationJournalEntry,
  type StoreDumpEnvelope,
} from "./store.js";

// ---------------------------------------------------------------------------
// The connection shape (PGlite + its transaction object both satisfy it)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export class PgMarketplaceStore implements MarketplaceStore {
  private readonly db: PGlite;
  /** The executor this view writes through (the db, or a transaction). */
  private readonly exec: PgExecutor;

  private constructor(db: PGlite, exec: PgExecutor) {
    this.db = db;
    this.exec = exec;
  }

  static async open(dataDir: string): Promise<PgMarketplaceStore> {
    const db = new PGlite(dataDir);
    await db.exec(MARKETPLACE_SCHEMA_DDL);
    return new PgMarketplaceStore(db, db as unknown as PgExecutor);
  }

  /** One atomic boundary for a request's multi-record writes. */
  async transact<T>(fn: (tx: MarketplaceStore) => Promise<T>): Promise<T> {
    if (this.exec !== (this.db as unknown as PgExecutor)) {
      // Already inside a transaction scope — run inline (PGlite savepoints
      // are not needed by this service's flat usage).
      return fn(this);
    }
    return this.db.transaction(async (tx) => {
      const scoped = new PgMarketplaceStore(this.db, tx as unknown as PgExecutor);
      return fn(scoped);
    });
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  // --- generic record-set operations (natural-key upsert + scoped reads) ---

  private async upsert(spec: TableSpec, caller: MarketplaceStoreCaller, record: unknown, extraSql: string, extraParams: unknown[]): Promise<void> {
    const parsed = asRecord(record);
    const tenantId = spec.tenantOf(parsed);
    if (tenantId !== caller.tenantId) {
      throw new Error(`cross-tenant write refused (A8): ${spec.table} belongs to another tenant scope`);
    }
    const nk = spec.nkOf(parsed);
    await this.exec.query(
      `INSERT INTO ${spec.table} (tenant_id, ${spec.nkColumn}, record) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (tenant_id, ${spec.nkColumn}) DO UPDATE SET record = EXCLUDED.record ${extraSql}`,
      [tenantId, nk, canonicalJson(parsed), ...extraParams],
    );
  }

  private async list(spec: TableSpec, caller: MarketplaceStoreCaller): Promise<unknown[]> {
    const result = await this.exec.query(
      `SELECT record FROM ${spec.table} WHERE tenant_id = $1 ORDER BY ${spec.nkColumn} ASC`,
      [caller.tenantId],
    );
    return result.rows.map((row) => parseRecord(row["record"]));
  }

  private async listAll(spec: TableSpec): Promise<unknown[]> {
    const result = await this.exec.query(
      `SELECT record FROM ${spec.table} ORDER BY tenant_id ASC, ${spec.nkColumn} ASC`,
    );
    return result.rows.map((row) => parseRecord(row["record"]));
  }

  private async find(spec: TableSpec, caller: MarketplaceStoreCaller, nk: string): Promise<unknown | null> {
    const result = await this.exec.query(
      `SELECT record FROM ${spec.table} WHERE tenant_id = $1 AND ${spec.nkColumn} = $2`,
      [caller.tenantId, nk],
    );
    const row = result.rows[0];
    return row === undefined ? null : (parseRecord(row["record"]));
  }

  // --- F361C requests ---

  async saveRequest(caller: MarketplaceStoreCaller, record: EquipmentRequest): Promise<void> {
    const parsed = asRecord(record);
    if (specTenant(REQUESTS, parsed) !== caller.tenantId) {
      throw new Error("cross-tenant write refused (A8): requests belongs to another tenant scope");
    }
    // The natural_key column + UNIQUE (tenant_id, natural_key) make the
    // F361C idempotent create/submit law structural (a tenant's natural
    // key never creates twice); the kernel's duplicate/conflict verdicts
    // govern the response — the store persists only what the kernel accepted.
    await this.exec.query(
      `INSERT INTO requests (tenant_id, request_id, natural_key, record) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (tenant_id, request_id) DO UPDATE SET record = EXCLUDED.record, natural_key = EXCLUDED.natural_key`,
      [caller.tenantId, String(parsed["requestId"]), String(parsed["naturalKey"]), canonicalJson(parsed)],
    );
  }

  async listRequests(caller: MarketplaceStoreCaller): Promise<readonly EquipmentRequest[]> {
    return (await this.list(REQUESTS, caller)) as EquipmentRequest[];
  }

  // --- F361C offers ---

  async saveOffer(caller: MarketplaceStoreCaller, offer: MarketplaceOffer): Promise<void> {
    await this.upsert(OFFERS, caller, offer, "", []);
  }

  async listOffers(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceOffer[]> {
    return (await this.list(OFFERS, caller)) as MarketplaceOffer[];
  }

  // --- retained comparison sheets ---

  async appendComparisonSheet(caller: MarketplaceStoreCaller, sheet: RetainedComparisonSheet): Promise<{ readonly duplicate: boolean }> {
    const result = await this.exec.query(
      `INSERT INTO comparison_sheets (tenant_id, sheet_id, record) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (tenant_id, sheet_id) DO NOTHING RETURNING sheet_id`,
      [caller.tenantId, sheet.sheetId, canonicalJson(sheet)],
    );
    return { duplicate: result.rows.length === 0 };
  }

  async listComparisonSheets(caller: MarketplaceStoreCaller): Promise<readonly RetainedComparisonSheet[]> {
    return (await this.list(SHEETS, caller)) as RetainedComparisonSheet[];
  }

  // --- F361C orders ---

  async saveOrder(caller: MarketplaceStoreCaller, order: MarketplaceEquipmentOrder): Promise<void> {
    await this.upsert(ORDERS, caller, order, "", []);
  }

  async findOrder(caller: MarketplaceStoreCaller, orderId: string): Promise<MarketplaceEquipmentOrder | null> {
    return (await this.find(ORDERS, caller, orderId)) as MarketplaceEquipmentOrder | null;
  }

  async listOrders(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceEquipmentOrder[]> {
    return (await this.list(ORDERS, caller)) as MarketplaceEquipmentOrder[];
  }

  // --- provider-ack journal (append-only, seq order) ---

  async appendProviderAck(caller: MarketplaceStoreCaller, entry: ProviderAckJournalEntry): Promise<void> {
    if (entry.tenantId !== caller.tenantId) throw new Error("cross-tenant write refused (A8): provider ack belongs to another tenant scope");
    await this.exec.query(
      `INSERT INTO provider_acks (tenant_id, record) VALUES ($1, $2::jsonb)`,
      [caller.tenantId, canonicalJson(entry)],
    );
  }

  async listProviderAcks(caller: MarketplaceStoreCaller): Promise<readonly ProviderAckJournalEntry[]> {
    const result = await this.exec.query(
      `SELECT record FROM provider_acks WHERE tenant_id = $1 ORDER BY seq ASC`,
      [caller.tenantId],
    );
    return result.rows.map((row) => parseRecord(row["record"]) as ProviderAckJournalEntry);
  }

  // --- F361A receipts ---

  async saveReceipt(caller: MarketplaceStoreCaller, record: PersistedReceipt): Promise<void> {
    await this.upsert(RECEIPTS, caller, record, "", []);
  }

  async listReceipts(caller: MarketplaceStoreCaller): Promise<readonly PersistedReceipt[]> {
    return (await this.list(RECEIPTS, caller)) as PersistedReceipt[];
  }

  async listAllReceipts(): Promise<readonly PersistedReceipt[]> {
    return (await this.listAll(RECEIPTS)) as PersistedReceipt[];
  }

  // --- F361A enrollments ---

  async saveEnrollment(caller: MarketplaceStoreCaller, record: AssetEnrollmentRecord): Promise<void> {
    await this.upsert(ENROLLMENTS, caller, record, "", []);
  }

  async findEnrollment(caller: MarketplaceStoreCaller, serial: string): Promise<AssetEnrollmentRecord | null> {
    return (await this.find(ENROLLMENTS, caller, serial)) as AssetEnrollmentRecord | null;
  }

  async listEnrollments(caller: MarketplaceStoreCaller): Promise<readonly AssetEnrollmentRecord[]> {
    return (await this.list(ENROLLMENTS, caller)) as AssetEnrollmentRecord[];
  }

  // --- F361B approvals ---

  async appendApproval(caller: MarketplaceStoreCaller, approval: MarketplaceOrderApproval): Promise<void> {
    // Idempotent by the deterministic approvalId (the kernel's stable id law).
    await this.upsert(APPROVALS, caller, approval, "", []);
  }

  async listApprovals(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceOrderApproval[]> {
    return (await this.list(APPROVALS, caller)) as MarketplaceOrderApproval[];
  }

  // --- marketplace evidence ---

  async insertEvidenceIfAbsent(caller: MarketplaceStoreCaller, record: MarketplaceEvidenceRecord): Promise<{ readonly inserted: boolean }> {
    if (record.tenantId !== caller.tenantId) throw new Error("cross-tenant write refused (A8): evidence belongs to another tenant scope");
    const result = await this.exec.query(
      `INSERT INTO evidence (tenant_id, evidence_id, provider_event_id, record) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (tenant_id, evidence_id) DO NOTHING RETURNING evidence_id`,
      [caller.tenantId, record.evidenceId, record.providerEventId, canonicalJson(record)],
    );
    return { inserted: result.rows.length > 0 };
  }

  async findEvidenceByProviderEvent(caller: MarketplaceStoreCaller, providerEventId: string): Promise<MarketplaceEvidenceRecord | null> {
    const result = await this.exec.query(
      `SELECT record FROM evidence WHERE tenant_id = $1 AND provider_event_id = $2`,
      [caller.tenantId, providerEventId],
    );
    const row = result.rows[0];
    return row === undefined ? null : (parseRecord(row["record"]) as MarketplaceEvidenceRecord);
  }

  async listEvidence(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceEvidenceRecord[]> {
    return (await this.list(EVIDENCE, caller)) as MarketplaceEvidenceRecord[];
  }

  // --- the F361A authoritative registry ---

  async saveAsset(caller: MarketplaceStoreCaller, asset: ManagedAssetRecord): Promise<void> {
    await this.upsert(ASSETS, caller, asset, "", []);
  }

  async findAsset(caller: MarketplaceStoreCaller, assetId: string): Promise<ManagedAssetRecord | null> {
    return (await this.find(ASSETS, caller, assetId)) as ManagedAssetRecord | null;
  }

  async listAssets(caller: MarketplaceStoreCaller): Promise<readonly ManagedAssetRecord[]> {
    return (await this.list(ASSETS, caller)) as ManagedAssetRecord[];
  }

  async saveTwin(caller: MarketplaceStoreCaller, twin: DeviceTwin): Promise<void> {
    await this.upsert(TWINS, caller, twin, "", []);
  }

  async findTwin(caller: MarketplaceStoreCaller, deviceId: string): Promise<DeviceTwin | null> {
    return (await this.find(TWINS, caller, deviceId)) as DeviceTwin | null;
  }

  async listAllAssets(): Promise<readonly ManagedAssetRecord[]> {
    return (await this.listAll(ASSETS)) as ManagedAssetRecord[];
  }

  async listAllEnrollments(): Promise<readonly AssetEnrollmentRecord[]> {
    return (await this.listAll(ENROLLMENTS)) as AssetEnrollmentRecord[];
  }

  async listAllTwins(): Promise<readonly DeviceTwin[]> {
    return (await this.listAll(TWINS)) as DeviceTwin[];
  }

  // --- operational identity (not caller-scoped: the credential directory
  //     is the service's own operational state; lookups are by credentialId) ---

  async saveCredential(record: CredentialRecord): Promise<void> {
    await this.exec.query(
      `INSERT INTO credentials (credential_id, record) VALUES ($1, $2::jsonb)
       ON CONFLICT (credential_id) DO NOTHING`,
      [record.credentialId, canonicalJson(record)],
    );
  }

  async findCredential(credentialId: string): Promise<CredentialRecord | null> {
    const result = await this.exec.query(`SELECT record FROM credentials WHERE credential_id = $1`, [credentialId]);
    const row = result.rows[0];
    return row === undefined ? null : (parseRecord(row["record"]) as CredentialRecord);
  }

  // --- journals ---

  async appendAudit(caller: MarketplaceStoreCaller, entry: MarketplaceAuditEntry): Promise<void> {
    if (entry.tenantId !== caller.tenantId) throw new Error("cross-tenant write refused (A8): audit entry belongs to another tenant scope");
    await this.exec.query(`INSERT INTO audit (tenant_id, record) VALUES ($1, $2::jsonb)`, [caller.tenantId, canonicalJson(entry)]);
  }

  private async auditRows(where: string, params: unknown[]): Promise<MarketplaceAuditEntry[]> {
    const result = await this.exec.query(`SELECT record FROM audit ${where} ORDER BY seq ASC`, params);
    return result.rows.map((row) => parseRecord(row["record"]) as MarketplaceAuditEntry);
  }

  async listAudit(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceAuditEntry[]> {
    return this.auditRows("WHERE tenant_id = $1", [caller.tenantId]);
  }

  async listAllAudit(): Promise<readonly MarketplaceAuditEntry[]> {
    return this.auditRows("ORDER BY tenant_id ASC, seq ASC", []);
  }

  async appendRevocation(entry: RevocationJournalEntry): Promise<void> {
    await this.exec.query(`INSERT INTO revocations (record) VALUES ($1::jsonb)`, [canonicalJson(entry)]);
  }

  async listRevocations(): Promise<readonly RevocationJournalEntry[]> {
    const result = await this.exec.query(`SELECT record FROM revocations ORDER BY seq ASC`);
    return result.rows.map((row) => parseRecord(row["record"]) as RevocationJournalEntry);
  }

  async appendBackupJournal(entry: BackupJournalEntry): Promise<void> {
    await this.exec.query(`INSERT INTO backups (record) VALUES ($1::jsonb)`, [canonicalJson(entry)]);
  }

  async listBackupJournal(): Promise<readonly BackupJournalEntry[]> {
    const result = await this.exec.query(`SELECT record FROM backups ORDER BY seq ASC`);
    return result.rows.map((row) => parseRecord(row["record"]) as BackupJournalEntry);
  }

  // --- the proof surface ---

  private async digestRecordSets(): Promise<Record<string, readonly unknown[]>> {
    const sets: Record<string, readonly unknown[]> = {
      requests: await this.listAll(REQUESTS),
      offers: await this.listAll(OFFERS),
      comparisonSheets: await this.listAll(SHEETS),
      orders: await this.listAll(ORDERS),
      receipts: await this.listAll(RECEIPTS),
      enrollments: await this.listAll(ENROLLMENTS),
      approvals: await this.listAll(APPROVALS),
      evidence: await this.listAll(EVIDENCE),
      assets: await this.listAll(ASSETS),
      twins: await this.listAll(TWINS),
      providerAcks: (await this.exec.query(`SELECT record FROM provider_acks ORDER BY tenant_id ASC, seq ASC`)).rows.map((r) => parseRecord(r["record"])),
      audit: (await this.exec.query(`SELECT record FROM audit ORDER BY tenant_id ASC, seq ASC`)).rows.map((r) => parseRecord(r["record"])),
      revocations: (await this.exec.query(`SELECT record FROM revocations ORDER BY seq ASC`)).rows.map((r) => parseRecord(r["record"])),
    };
    return sets;
  }

  async digestReport(): Promise<{ readonly digests: MarketplaceStoreDigests; readonly counts: MarketplaceStoreCounts }> {
    const sets = await this.digestRecordSets();
    const digests = digestsOfRecordSets(sets);
    const counts: Record<string, number> = {};
    for (const name of DIGEST_RECORD_SETS) counts[name] = (sets[name] ?? []).length;
    const credentials = await this.exec.query(`SELECT count(*)::int AS n FROM credentials`);
    counts["credentials"] = Number(credentials.rows[0]?.["n"] ?? 0);
    const backups = await this.exec.query(`SELECT count(*)::int AS n FROM backups`);
    counts["backups"] = Number(backups.rows[0]?.["n"] ?? 0);
    return { digests, counts };
  }

  // --- backup/restore (the runbook's recorded path — never ad-hoc SQL) ---

  async dumpStore(): Promise<string> {
    const sets = await this.digestRecordSets();
    const envelope: StoreDumpEnvelope = {
      counts: Object.fromEntries(DIGEST_RECORD_SETS.map((name) => [name, (sets[name] ?? []).length])),
      digests: digestsOfRecordSets(sets),
    };
    const credentials = (await this.exec.query(`SELECT record FROM credentials ORDER BY credential_id ASC`)).rows.map((r) => parseRecord(r["record"]));
    const backups = (await this.exec.query(`SELECT record FROM backups ORDER BY seq ASC`)).rows.map((r) => parseRecord(r["record"]));
    return canonicalJson({
      format: DUMP_FORMAT,
      recordSets: sets,
      operational: { credentials, backups },
      envelope,
    });
  }

  async restoreStore(dump: string): Promise<RestoreResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(dump);
    } catch {
      return { ok: false, reason: "malformed-dump", detail: "dump file is not valid JSON" };
    }
    const root = asRecord(parsed);
    if (root["format"] !== DUMP_FORMAT) {
      return { ok: false, reason: "malformed-dump", detail: "dump file format marker mismatch" };
    }
    const recordSetsRaw = root["recordSets"];
    const envelopeRaw = root["envelope"];
    if (recordSetsRaw === undefined || envelopeRaw === undefined) {
      return { ok: false, reason: "malformed-dump", detail: "dump file is missing recordSets/envelope" };
    }
    const recordSets = asRecord(recordSetsRaw);
    const envelope = asRecord(envelopeRaw);
    // (1) The file's envelope must match the file's own contents (tamper evidence).
    const sets: Record<string, readonly unknown[]> = {};
    for (const name of DIGEST_RECORD_SETS) sets[name] = (recordSets[name] as unknown[] | undefined) ?? [];
    const fileDigests = digestsOfRecordSets(sets);
    const envelopeDigests = asRecord(envelope["digests"]);
    for (const name of [...DIGEST_RECORD_SETS, "total"]) {
      if (envelopeDigests[name] !== fileDigests[name]) {
        return { ok: false, reason: "envelope-mismatch", detail: `dump envelope digest mismatch for ${name} — refusing to serve mutated history` };
      }
    }
    // (2) Wipe + import in ONE transaction (all-or-nothing). The dump's
    // record sets are already in natural-key / journal order — re-inserting
    // in that order regenerates the identical digest ordering.
    const SET_KEY_BY_TABLE: Readonly<Record<string, string>> = {
      requests: "requests", offers: "offers", comparison_sheets: "comparisonSheets", orders: "orders",
      receipts: "receipts", enrollments: "enrollments", approvals: "approvals", evidence: "evidence",
      assets: "assets", twins: "twins",
    };
    const importSpecs: readonly TableSpec[] = [REQUESTS, OFFERS, SHEETS, ORDERS, RECEIPTS, ENROLLMENTS, APPROVALS, EVIDENCE, ASSETS, TWINS];
    await this.db.transaction(async (tx) => {
      await tx.exec(
        `TRUNCATE requests, offers, comparison_sheets, orders, provider_acks, receipts, enrollments,
         approvals, evidence, assets, twins, credentials, audit, revocations, backups RESTART IDENTITY`,
      );
      for (const spec of importSpecs) {
        for (const record of sets[SET_KEY_BY_TABLE[spec.table] ?? spec.table] ?? []) {
          const parsedRecord = asRecord(record);
          const tenantId = spec.tenantOf(parsedRecord);
          const nk = spec.nkOf(parsedRecord);
          const body = canonicalJson(parsedRecord);
          if (spec.table === "requests") {
            // The natural_key column (the F361C idempotency law, structural).
            await tx.query(
              `INSERT INTO requests (tenant_id, request_id, natural_key, record) VALUES ($1, $2, $3, $4::jsonb)
               ON CONFLICT (tenant_id, request_id) DO UPDATE SET record = EXCLUDED.record, natural_key = EXCLUDED.natural_key`,
              [tenantId, nk, String(parsedRecord["naturalKey"]), body],
            );
          } else if (spec.table === "evidence") {
            // The provider_event_id column (the F361B dedup law, structural).
            await tx.query(
              `INSERT INTO evidence (tenant_id, evidence_id, provider_event_id, record) VALUES ($1, $2, $3, $4::jsonb)
               ON CONFLICT (tenant_id, evidence_id) DO UPDATE SET record = EXCLUDED.record, provider_event_id = EXCLUDED.provider_event_id`,
              [tenantId, nk, String(parsedRecord["providerEventId"]), body],
            );
          } else {
            await tx.query(
              `INSERT INTO ${spec.table} (tenant_id, ${spec.nkColumn}, record) VALUES ($1, $2, $3::jsonb)
               ON CONFLICT (tenant_id, ${spec.nkColumn}) DO UPDATE SET record = EXCLUDED.record`,
              [tenantId, nk, body],
            );
          }
        }
      }
      for (const entry of sets["providerAcks"] ?? []) {
        await tx.query(`INSERT INTO provider_acks (tenant_id, record) VALUES ($1, $2::jsonb)`, [String(asRecord(entry)["tenantId"]), canonicalJson(entry)]);
      }
      for (const entry of sets["audit"] ?? []) {
        await tx.query(`INSERT INTO audit (tenant_id, record) VALUES ($1, $2::jsonb)`, [String(asRecord(entry)["tenantId"]), canonicalJson(entry)]);
      }
      for (const entry of sets["revocations"] ?? []) {
        await tx.query(`INSERT INTO revocations (record) VALUES ($1::jsonb)`, [canonicalJson(entry)]);
      }
      const operational = asRecord(root["operational"] ?? {});
      for (const record of (operational["credentials"] as unknown[] | undefined) ?? []) {
        await tx.query(
          `INSERT INTO credentials (credential_id, record) VALUES ($1, $2::jsonb) ON CONFLICT (credential_id) DO NOTHING`,
          [String(asRecord(record)["credentialId"]), canonicalJson(record)],
        );
      }
      for (const entry of (operational["backups"] as unknown[] | undefined) ?? []) {
        await tx.query(`INSERT INTO backups (record) VALUES ($1::jsonb)`, [canonicalJson(entry)]);
      }
    });
    // (3) Re-verify: the digests recomputed from the RESTORED store must
    // equal the file's envelope (the import was faithful).
    const report = await this.digestReport();
    for (const name of [...DIGEST_RECORD_SETS, "total"]) {
      if (report.digests[name] !== fileDigests[name]) {
        return { ok: false, reason: "record-set-mismatch", detail: `restored store digest mismatch for ${name}` };
      }
    }
    return { ok: true, report: { ok: true, digests: report.digests, counts: report.counts } };
  }
}

/** A convenience re-export for the service's boot path. */
export function receiptEvidenceOf(record: PersistedReceipt): ReceiptEvidence {
  return record.evidence;
}

/** Deterministic comparison-sheet id (content-addressed, `mcs-` prefix). */
export function comparisonSheetId(sheet: Omit<RetainedComparisonSheet, "sheetId">): string {
  return `mcs-${sha256Hex(canonicalJson(sheet)).slice(0, 12)}`;
}
