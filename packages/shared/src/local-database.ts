export interface SqlExecutor {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
}

export interface LocalDatabase extends SqlExecutor {
  withExclusiveTransactionAsync(task: (tx: SqlExecutor) => Promise<void>): Promise<void>;
}

export async function migrateLocalDatabase(db: LocalDatabase) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const version = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if ((version?.user_version ?? 0) > 3) {
      throw new Error('지원하지 않는 로컬 DB 버전입니다.');
    }
    if (version?.user_version === 3) {
      return;
    }
    if (!version?.user_version) {
      await tx.execAsync(`
        CREATE TABLE notes (id TEXT PRIMARY KEY, payload TEXT NOT NULL,
          updated_at TEXT NOT NULL, pinned INTEGER NOT NULL, archived INTEGER NOT NULL,
          favorite INTEGER NOT NULL, deleted_at TEXT, purged INTEGER NOT NULL);
        CREATE INDEX notes_listing ON notes(purged, deleted_at, archived, pinned, updated_at DESC);
        CREATE TABLE outbox (note_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
    }
    if ((version?.user_version ?? 0) < 2) {
      await tx.execAsync(`
        CREATE TABLE encrypted_outbox (operation_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      `);
    }
    await tx.execAsync(`
        CREATE TABLE local_attachments (id TEXT PRIMARY KEY, descriptor TEXT NOT NULL);
        CREATE TABLE attachment_chunks (attachment_id TEXT NOT NULL REFERENCES local_attachments(id), chunk_index INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(attachment_id, chunk_index));
        CREATE TABLE attachment_uploads (attachment_id TEXT PRIMARY KEY REFERENCES local_attachments(id), key_id TEXT NOT NULL, payload TEXT NOT NULL);
        PRAGMA user_version = 3;
      `);
  });
}
