import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { LocalStore } from '@yeongdu/shared/src/local-store';
import { transactionalDatabase } from '@yeongdu/shared/src/sql-transactions';
import { readSecret, writeSecret } from './secure';
import { fileUriFromPath } from './file-uri';
import { attachmentDigest } from './digest';
import type { CategoryAuthenticator } from '@yeongdu/shared/src/category-access';

export async function openVault(
  assertAccess: () => void,
  authenticateCategory?: CategoryAuthenticator,
  onCategoryAccessRevoked?: () => void,
): Promise<LocalStore> {
  assertAccess();
  const filename = 'yeongdu-vault.db';
  const databaseFile = new File(fileUriFromPath(SQLite.defaultDatabaseDirectory), filename);
  let key = await readSecret('database-key');
  if (!key) {
    if (databaseFile.exists)
      throw new Error(
        '기존 DB의 암호화 키를 찾을 수 없습니다. 데이터를 삭제하지 말고 원래 기기 백업 또는 서버에서 복구하세요.',
      );
    key = Array.from(await Crypto.getRandomBytesAsync(32), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    await writeSecret('database-key', key);
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('암호화 키가 손상되었습니다.');
  const db = await SQLite.openDatabaseAsync(filename);
  let writer: SQLite.SQLiteDatabase | undefined;
  try {
    const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
    if (!cipher?.cipher_version)
      throw new Error('SQLCipher 미지원 빌드입니다. Expo Go 대신 Development Build를 설치하세요.');
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master');
    await db.execAsync(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;',
    );
    // Every SQLCipher connection needs its own key before BEGIN or schema access.
    writer = await SQLite.openDatabaseAsync(filename, { useNewConnection: true });
    await writer.execAsync(`PRAGMA key = "x'${key}'";`);
    await writer.getFirstAsync('SELECT count(*) FROM sqlite_master');
    await writer.execAsync('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    let clientId = await readSecret('client-id');
    if (!clientId) {
      clientId = Crypto.randomUUID();
      await writeSecret('client-id', clientId);
    }
    const store = new LocalStore(
      transactionalDatabase(db, writer),
      Crypto.randomUUID,
      clientId,
      assertAccess,
      authenticateCategory,
      onCategoryAccessRevoked,
      attachmentDigest,
    );
    await store.migrate();
    return store;
  } catch (error) {
    await writer?.closeAsync();
    await db.closeAsync();
    throw error;
  }
}
