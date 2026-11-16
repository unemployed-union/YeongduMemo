import {
  assertCheckpointProgress,
  checkpointSchema,
  syncIssueSchema,
  SyncSafetyError,
  type SyncCheckpoint,
  type SyncContext,
  type SyncIssue,
} from './sync-safety';
import type { SqlExecutor } from './local-database';
/** Stores rollback evidence; it never owns a separate write queue or transaction. */
export class LocalSyncState {
  constructor(
    private db: SqlExecutor,
    private assertAccess: () => void,
    private settleWrites: () => Promise<unknown>,
  ) {}
  async syncIssue(): Promise<SyncIssue | null> {
    this.assertAccess();
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM metadata WHERE key = 'sync-block'",
    );
    this.assertAccess();
    return row ? syncIssueSchema.parse(row.value) : null;
  }

  async syncContext(): Promise<SyncContext> {
    this.assertAccess();
    await this.settleWrites().catch(() => undefined);
    const issue = await this.syncIssue();
    if (issue) {
      throw new SyncSafetyError(issue);
    }
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM metadata WHERE key = 'sync-checkpoint'",
    );
    const revisions = await this.db.getFirstAsync<{
      revision: number;
    }>(`SELECT MAX(value) AS revision FROM (
      SELECT COALESCE(MAX(json_extract(payload, '$.revision')), 0) AS value FROM notes
      UNION ALL SELECT COALESCE(MAX(json_extract(payload, '$.baseRevision')), 0) FROM outbox)`);
    const cursor = await this.cursor();
    this.assertAccess();
    return {
      witness: row ? checkpointSchema.parse(JSON.parse(row.value)) : null,
      cursor,
      knownRevision: revisions?.revision ?? 0,
    };
  }

  async writeCheckpoint(tx: SqlExecutor, checkpoint: SyncCheckpoint) {
    const blocked = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM metadata WHERE key = 'sync-block'",
    );
    if (blocked) {
      throw new SyncSafetyError(syncIssueSchema.parse(blocked.value));
    }
    const previous = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM metadata WHERE key = 'sync-checkpoint'",
    );
    const next = checkpointSchema.parse(checkpoint);
    assertCheckpointProgress(
      previous ? checkpointSchema.parse(JSON.parse(previous.value)) : null,
      next,
    );
    await tx.runAsync(
      "INSERT INTO metadata VALUES ('sync-checkpoint', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(next),
    );
  }

  async cursor() {
    this.assertAccess();
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM metadata WHERE key='cursor'",
    );
    return Number(row?.value ?? 0);
  }
  async blockSync(tx: SqlExecutor, issue: SyncIssue) {
    await tx.runAsync(
      "INSERT OR IGNORE INTO metadata VALUES ('sync-block', ?)",
      syncIssueSchema.parse(issue),
    );
  }
}
