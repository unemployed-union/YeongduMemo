import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  LocalStore,
  type LocalDatabase,
  type SqlExecutor,
} from '../packages/shared/src/local-store';
import { SyncService, type SyncTransport } from '../packages/shared/src/sync';
import { createApp } from '../apps/server/src/app';
import { EncryptedTransport, NoteEncryption } from '@yeongdu/shared/src/e2ee';
import { migrationCipher } from '../apps/server/src/maintenance/e2ee-migration';
import { transactionalDatabase } from '../packages/shared/src/sql-transactions';
import type { CategoryAuthenticator } from '@yeongdu/shared/src/category-access';
import { SyncSafetyError, syncIssueSchema } from '@yeongdu/shared/src/sync-safety';

export function localDevice(
  filename = ':memory:',
  assertAccess?: () => void,
  authenticateCategory?: CategoryAuthenticator,
) {
  const sqlite = new Database(filename);
  const executor: SqlExecutor = {
    async execAsync(sql) {
      sqlite.exec(sql);
    },
    async runAsync(sql, ...params) {
      return sqlite.prepare(sql).run(...params);
    },
    async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]) {
      return (sqlite.prepare(sql).get(...params) ?? null) as T | null;
    },
    async getAllAsync<T>(sql: string, ...params: (string | number | null)[]) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
  };
  const adapter: LocalDatabase = transactionalDatabase(executor, executor);
  const store = new LocalStore(
    adapter,
    randomUUID,
    randomUUID(),
    assertAccess,
    authenticateCategory,
    undefined,
    async (bytes) => createHash('sha256').update(bytes).digest('hex'),
  );
  return { sqlite, store, adapter };
}

export function transport(
  server: Awaited<ReturnType<typeof createApp>>,
  access: string,
  store: LocalStore,
): SyncTransport {
  const userId = server.auth.authenticate(access)!;
  const cipher = migrationCipher(testRecoveryKey);
  server.notes.registerKey(userId, cipher.keyId);
  async function request(url: string, payload: unknown) {
    const response = await server.app.inject({
      url,
      method: payload ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${access}` },
      ...(payload ? { payload } : {}),
    });
    if (response.statusCode !== 200) {
      const issue = syncIssueSchema.safeParse(response.json().code);
      if (issue.success) {
        throw new SyncSafetyError(issue.data);
      }
      throw new Error(`HTTP ${response.statusCode}`);
    }
    return response.json();
  }
  return new EncryptedTransport(
    store,
    {
      checkpoint: (context) => request('/sync/v4/checkpoint', context),
      push: (operations, witness) => request('/sync/v4/push', { operations, witness }),
      pull: (cursor, witness) => request('/sync/v4/pull', { cursor, witness }),
    },
    new NoteEncryption(cipher, userId),
  );
}
export const testRecoveryKey = 'a7'.repeat(32);
export async function decryptedServerNotes(
  server: Awaited<ReturnType<typeof createApp>>,
  userId: string,
) {
  const encryption = new NoteEncryption(migrationCipher(testRecoveryKey), userId);
  return Promise.all(server.notes.list(userId).map((note) => encryption.decrypt(note)));
}
export const synchronizer = (store: LocalStore, connection: SyncTransport) =>
  new SyncService(store, connection);
