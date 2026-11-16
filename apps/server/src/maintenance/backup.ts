import Database from 'better-sqlite3';
import { closeSync, openSync } from 'node:fs';
import { resolve } from 'node:path';

/** Reserve a new destination; never overwrite a previous backup or the source DB. */
export async function backupConnection(database: Database.Database, destination: string) {
  if (database.name !== ':memory:' && resolve(database.name) === resolve(destination)) {
    throw new Error('백업 대상은 원본 DB와 달라야 합니다.');
  }
  const descriptor = openSync(destination, 'wx', 0o600);
  closeSync(descriptor);
  await database.backup(destination);
}

/** This path deliberately opens without running schema migrations. */
export async function backupDatabase(source: string, destination: string) {
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await backupConnection(database, destination);
  } finally {
    database.close();
  }
}
