/**
 * infrastructure/fleetos-marketplace/pg-store.ts — the MarketplaceStore
 * adapter over the `pg` (node-postgres) driver at the REAL host boundary
 * (F372, Wave 19 lane A).
 *
 * REAL PostgreSQL as a SEPARATE SERVER PROCESS, reached over TCP through a
 * `postgres://` connection string (law A1: this store IS the authoritative
 * business truth — now across a real process and network boundary). The
 * PORT (store.ts) stays swappable: the pglite adapter (pglite-store.ts)
 * remains the in-process mode; this adapter is the production shape. The
 * F351A JSONL segments are NOT used for marketplace transaction state.
 *
 * Schema parity is STRUCTURAL, not by copy: the DDL is expressed ONCE in
 * schema.ts (MARKETPLACE_SCHEMA_DDL) and the tenant-scoped table shapes
 * (TableSpec natural keys, the A8 leading tenant_id) come from the shared
 * pglite-tables.ts — both adapters consume the same source, so the table
 * shapes are IDENTICAL by construction (the pglite adapter's behavior is
 * unchanged by a byte; its tests stay green UNCHANGED).
 *
 * Write-before-ack: every mutating statement is a committed PostgreSQL
 * transaction (BEGIN … COMMIT through the pool client) before the promise
 * resolves — REAL PostgreSQL's WAL on the SERVER side, so a SIGKILL of the
 * SERVER PROCESS mid-journey loses nothing; the machine assertion is the
 * F372 server-crash-restart journey (digests byte-identical after WAL
 * recovery).
 *
 * transact(): one request's multi-record writes (the business record + its
 * journal entries) commit in ONE transaction — the atomic boundary. The
 * service's single-writer chain serializes requests; the pool's small max
 * keeps the deployment's connection footprint explicit.
 *
 * Server-loss behavior: the pool attaches an 'error' handler (idle-client
 * loss is swallowed, never an unhandled crash) and later queries create
 * FRESH connections — so a killed-and-restarted postgres SERVER is
 * reconnected transparently at the next store operation (the journey's
 * reconnect proof).
 */

import { Pool, type PoolClient } from "pg";
import type {
  AssetEnrollmentRecord,
  DeviceTwin,
  ManagedAssetRecord,
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

/** The pool / a checked-out client both satisfy the executor shape. */
function executorOf(handle: Pool | PoolClient): PgExecutor {
  return handle as unknown as PgExecutor;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export class NetworkedPgMarketplaceStore implements MarketplaceStore {
  private readonly pool: Pool;
  /** The executor this view writes through (the pool, or a transaction client). */
  private readonly exec: PgExecutor;

  private constructor(pool: Pool, exec: PgExecutor) {
    this.pool = pool;
    this.exec = exec;
  }

  /** Open over a REAL postgres server: `postgres://user[:pass]@host:port/db`
   *  (the server lifecycle harness — pg-server.ts — provisions one for the
   *  test/journey class; production hosts are operator deployment class). */
  static async open(connectionString: string): Promise<NetworkedPgMarketplaceStore> {
    const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 10_000 });
    // Idle-client loss (e.g. the SERVER process was SIGKILLed) must never
    // surface as an unhandled 'error' event — the pool discards the dead
    // client and later queries open FRESH connections (the transparent
    // reconnect after a server crash-restart).
    pool.on("error", () => {
      // connection discarded; the next query reconnects
    });
    const store = new NetworkedPgMarketplaceStore(pool, executorOf(pool));
    // The schema DDL is expressed once (schema.ts) — CREATE TABLE IF NOT
    // EXISTS makes re-opens idempotent; multi-statement simple query.
    await store.exec.query(MARKETPLACE_SCHEMA_DDL);
    return store;
  }

  /** One atomic boundary for a request's multi-record writes. */
  async transact<T>(fn: (tx: MarketplaceStore) => Promise<T>): Promise<T> {
    if (this.exec !== executorOf(this.pool)) {
      // Already inside a transaction scope — run inline (the service's flat
      // usage never nests deeper; savepoints are not needed).
      return fn(this);
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scoped = new NetworkedPgMarketplaceStore(this.pool, executorOf(client));
      const result = await fn(scoped);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
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
      `INSERT INTO ${spec.table} (tenant_id, ${spec.nkColumn}, record) VALUES ($1, $2, $3::jsonb) ON CONFLICT (tenant_id, ${spec.nkColumn}) DO UPDATE SET record = EXCLUDED.record ${extraSql}`,
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
    // F361C idempotent create/submit law structural — identical to the
    // pglite adapter's column shape (the shared TableSpec set).
    await this.exec.query(
      `INSERT INTO requests (tenant_id, request_id, natural_key, record) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (tenant_id, request_id) DO UPDATE SET record = EXCLUDED.record, natural_key = EXCLUDED.natural_key`,
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
      `INSERT INTO comparison_sheets (tenant_id, sheet_id, record) VALUES ($1, $2, $3::jsonb) ON CONFLICT (tenant_id, sheet_id) DO NOTHING RETURNING sheet_id`,
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
    // Idempotent by the deterministic approval request id (the kernel's
    // stable-id law — the shared TableSpec key, identical to pglite).
    await this.upsert(APPROVALS, caller, approval, "", []);
  }

  async listApprovals(caller: MarketplaceStoreCaller): Promise<readonly MarketplaceOrderApproval[]> {
    return (await this.list(APPROVALS, caller)) as MarketplaceOrderApproval[];
  }

  // --- marketplace evidence ---

  async insertEvidenceIfAbsent(caller: MarketplaceStoreCaller, record: MarketplaceEvidenceRecord): Promise<{ readonly inserted: boolean }> {
    if (record.tenantId !== caller.tenantId) throw new Error("cross-tenant write refused (A8): evidence belongs to another tenant scope");
    const result = await this.exec.query(
      `INSERT INTO evidence (tenant_id, evidence_id, provider_event_id, record) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (tenant_id, evidence_id) DO NOTHING RETURNING evidence_id`,
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

  // --- operational identity (the service's own directory; by credentialId) ---

  async saveCredential(record: CredentialRecord): Promise<void> {
    await this.exec.query(
      `INSERT INTO credentials (credential_id, record) VALUES ($1, $2::jsonb) ON CONFLICT (credential_id) DO NOTHING`,
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

  private async journalSet(table: string, order: string): Promise<readonly unknown[]> {
    const result = await this.exec.query(`SELECT record FROM ${table} ORDER BY ${order}`);
    return result.rows.map((r) => parseRecord(r["record"]));
  }

  private async digestRecordSets(): Promise<Record<string, readonly unknown[]>> {
    return {
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
      providerAcks: await this.journalSet("provider_acks", "tenant_id ASC, seq ASC"),
      audit: await this.journalSet("audit", "tenant_id ASC, seq ASC"),
      revocations: await this.journalSet("revocations", "seq ASC"),
    };
  }

  async digestReport(): Promise<{ readonly digests: MarketplaceStoreDigests; readonly counts: MarketplaceStoreCounts }> {
    const sets = await this.digestRecordSets();
    const digests = digestsOfRecordSets(sets);
    const counts: Record<string, number> = {};
    for (const name of DIGEST_RECORD_SETS) counts[name] = (sets[name] ?? []).length;
    counts["credentials"] = Number((await this.exec.query(`SELECT count(*)::int AS n FROM credentials`)).rows[0]?.["n"] ?? 0);
    counts["backups"] = Number((await this.exec.query(`SELECT count(*)::int AS n FROM backups`)).rows[0]?.["n"] ?? 0);
    return { digests, counts };
  }

  // --- backup/restore (the runbook's recorded path — never ad-hoc SQL) ---

  async dumpStore(): Promise<string> {
    const sets = await this.digestRecordSets();
    const envelope: StoreDumpEnvelope = {
      counts: Object.fromEntries(DIGEST_RECORD_SETS.map((name) => [name, (sets[name] ?? []).length])),
      digests: digestsOfRecordSets(sets),
    };
    const credentials = await this.journalSet("credentials", "credential_id ASC");
    const backups = await this.journalSet("backups", "seq ASC");
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
    await this.transact(async (tx) => {
      const scoped = tx as NetworkedPgMarketplaceStore;
      await scoped.exec.query(
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
            await scoped.exec.query(
              `INSERT INTO requests (tenant_id, request_id, natural_key, record) VALUES ($1, $2, $3, $4::jsonb)
               ON CONFLICT (tenant_id, request_id) DO UPDATE SET record = EXCLUDED.record, natural_key = EXCLUDED.natural_key`,
              [tenantId, nk, String(parsedRecord["naturalKey"]), body],
            );
          } else if (spec.table === "evidence") {
            // The provider_event_id column (the F361B dedup law, structural).
            await scoped.exec.query(
              `INSERT INTO evidence (tenant_id, evidence_id, provider_event_id, record) VALUES ($1, $2, $3, $4::jsonb)
               ON CONFLICT (tenant_id, evidence_id) DO UPDATE SET record = EXCLUDED.record, provider_event_id = EXCLUDED.provider_event_id`,
              [tenantId, nk, String(parsedRecord["providerEventId"]), body],
            );
          } else {
            await scoped.exec.query(
              `INSERT INTO ${spec.table} (tenant_id, ${spec.nkColumn}, record) VALUES ($1, $2, $3::jsonb)
               ON CONFLICT (tenant_id, ${spec.nkColumn}) DO UPDATE SET record = EXCLUDED.record`,
              [tenantId, nk, body],
            );
          }
        }
      }
      for (const entry of sets["providerAcks"] ?? []) {
        await scoped.exec.query(`INSERT INTO provider_acks (tenant_id, record) VALUES ($1, $2::jsonb)`, [String(asRecord(entry)["tenantId"]), canonicalJson(entry)]);
      }
      for (const entry of sets["audit"] ?? []) {
        await scoped.exec.query(`INSERT INTO audit (tenant_id, record) VALUES ($1, $2::jsonb)`, [String(asRecord(entry)["tenantId"]), canonicalJson(entry)]);
      }
      for (const entry of sets["revocations"] ?? []) {
        await scoped.exec.query(`INSERT INTO revocations (record) VALUES ($1::jsonb)`, [canonicalJson(entry)]);
      }
      const operational = asRecord(root["operational"] ?? {});
      for (const record of (operational["credentials"] as unknown[] | undefined) ?? []) {
        await scoped.exec.query(
          `INSERT INTO credentials (credential_id, record) VALUES ($1, $2::jsonb) ON CONFLICT (credential_id) DO NOTHING`,
          [String(asRecord(record)["credentialId"]), canonicalJson(record)],
        );
      }
      for (const entry of (operational["backups"] as unknown[] | undefined) ?? []) {
        await scoped.exec.query(`INSERT INTO backups (record) VALUES ($1::jsonb)`, [canonicalJson(entry)]);
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
