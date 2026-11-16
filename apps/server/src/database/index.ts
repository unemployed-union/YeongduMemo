import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { backupConnection } from '../maintenance/backup.js';
import * as schema from './schema.js';

export async function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  try {
    const previous = sqlite.pragma('user_version', { simple: true }) as number;
    if (previous > 4) {
      throw new Error('지원하지 않는 DB 버전입니다. 서버를 업그레이드하세요.');
    }
    if (previous > 0 && previous < 4 && filename !== ':memory:') {
      await backupConnection(sqlite, `${filename}.before-v4-${randomUUID()}.db`);
    }
    sqlite.transaction(() => {
      const version = sqlite.pragma('user_version', { simple: true }) as number;
      if (version === 4) {
        return;
      }
      if (version === 0) {
        sqlite.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        access_hash TEXT NOT NULL UNIQUE, refresh_hash TEXT NOT NULL UNIQUE,
        access_expires INTEGER NOT NULL, refresh_expires INTEGER NOT NULL);
      CREATE TABLE used_refresh (hash TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        expires INTEGER NOT NULL);
      CREATE TABLE notes (user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL,
        revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(user_id, id));
      CREATE TABLE changes (seq INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL);
      CREATE INDEX changes_user_seq ON changes(user_id, seq);
      CREATE TABLE receipts (user_id TEXT NOT NULL REFERENCES users(id), operation_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(user_id, operation_id));
    `);
      }
      if (version < 2) {
        sqlite.exec(`
      CREATE TABLE encryption_keys (user_id TEXT PRIMARY KEY REFERENCES users(id), key_id TEXT NOT NULL);
    `);
      }
      if (version < 3) {
        sqlite.exec(`
      CREATE TABLE sync_identity (id INTEGER PRIMARY KEY CHECK(id = 1), server_id TEXT NOT NULL, generation TEXT NOT NULL);
      ALTER TABLE changes ADD COLUMN checkpoint TEXT;
    `);
        sqlite
          .prepare('INSERT INTO sync_identity VALUES (1, ?, ?)')
          .run(randomUUID(), randomUUID());
        const rows = sqlite.prepare('SELECT seq FROM changes').all() as { seq: number }[];
        const update = sqlite.prepare('UPDATE changes SET checkpoint = ? WHERE seq = ?');
        for (const row of rows) {
          update.run(randomUUID(), row.seq);
        }
      }
      sqlite.exec(`CREATE TABLE attachments (
        user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL,
        manifest TEXT NOT NULL, storage TEXT NOT NULL, bytes INTEGER NOT NULL,
        ready INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, id)
      ); PRAGMA user_version = 4;`);
    })();
  } catch (error) {
    sqlite.close();
    throw error;
  }
  return { sqlite, orm: drizzle(sqlite, { schema }) };
}
export type ServerDatabase = Awaited<ReturnType<typeof openDatabase>>;
