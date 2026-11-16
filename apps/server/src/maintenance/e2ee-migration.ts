import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { noteSchema } from '@yeongdu/shared';
import { backupConnection } from './backup.js';
import { NoteEncryption, normalizeRecoveryKey, type AeadCipher } from '@yeongdu/shared/src/e2ee';
import type { ServerDatabase } from '../database/index.js';

// Used only by the offline migration CLI and tests. The HTTP server never imports this module.
export function migrationCipher(recoveryKey: string): AeadCipher {
  const key = Buffer.from(normalizeRecoveryKey(recoveryKey), 'hex');
  return {
    keyId: createHash('sha256').update(key).digest('hex'),
    randomUUID,
    async seal(plaintext, additionalData) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(additionalData);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
    },
    async open(ciphertext, additionalData) {
      const combined = Buffer.from(ciphertext, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, combined.subarray(0, 12));
      decipher.setAAD(additionalData);
      decipher.setAuthTag(combined.subarray(-16));
      return Buffer.concat([decipher.update(combined.subarray(12, -16)), decipher.final()]);
    },
  };
}

export async function migrateLegacyAccount(
  db: ServerDatabase,
  email: string,
  recoveryKey: string,
  databasePath: string,
): Promise<string> {
  const cipher = migrationCipher(recoveryKey);
  const user = db.sqlite
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email.trim().toLowerCase()) as { id: string } | undefined;
  if (!user) {
    throw new Error('계정을 찾을 수 없습니다.');
  }
  const registered = db.sqlite
    .prepare('SELECT 1 FROM encryption_keys WHERE user_id = ?')
    .get(user.id);
  if (registered) {
    throw new Error('이미 암호화된 계정입니다. 키 교체는 지원하지 않습니다.');
  }
  const backupPath = `${databasePath}.pre-e2ee-${Date.now()}-${randomUUID()}.db`;
  await backupConnection(db.sqlite, backupPath);
  const encryption = new NoteEncryption(cipher, user.id);
  db.sqlite.pragma('secure_delete = ON');
  db.sqlite.exec('BEGIN IMMEDIATE');
  try {
    // Preserve note IDs, revisions and cursors, including deleted/conflicting versions.
    const notes = db.sqlite
      .prepare('SELECT id, payload FROM notes WHERE user_id = ?')
      .all(user.id) as { id: string; payload: string }[];
    const changes = db.sqlite
      .prepare('SELECT seq, payload FROM changes WHERE user_id = ?')
      .all(user.id) as { seq: number; payload: string }[];
    for (const row of notes) {
      const encrypted = await encryption.encrypt(noteSchema.parse(JSON.parse(row.payload)));
      db.sqlite
        .prepare('UPDATE notes SET payload = ? WHERE user_id = ? AND id = ?')
        .run(JSON.stringify(encrypted), user.id, row.id);
    }
    for (const row of changes) {
      const encrypted = await encryption.encrypt(noteSchema.parse(JSON.parse(row.payload)));
      db.sqlite
        .prepare('UPDATE changes SET payload = ? WHERE user_id = ? AND seq = ?')
        .run(JSON.stringify(encrypted), user.id, row.seq);
    }
    // Legacy receipts hash plaintext requests and cannot acknowledge v2 ciphertext requests.
    // Pending operations may become conflict copies on their first v2 retry; no edits are discarded.
    db.sqlite.prepare('DELETE FROM receipts WHERE user_id = ?').run(user.id);
    db.sqlite.prepare('INSERT INTO encryption_keys VALUES (?, ?)').run(user.id, cipher.keyId);
    db.sqlite.exec('COMMIT');
  } catch {
    db.sqlite.exec('ROLLBACK');
    throw new Error(
      '암호화 전환에 실패하여 DB 변경을 취소했습니다. 원본과 전환 전 백업을 보관하세요.',
    );
  }
  // Remove free pages and truncate WAL. External snapshots/backups still need separate handling.
  db.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  db.sqlite.exec('VACUUM');
  db.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  return backupPath;
}
