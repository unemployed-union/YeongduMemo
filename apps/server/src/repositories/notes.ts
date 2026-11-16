import { SyncCheckpoints } from './sync-checkpoints.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  SyncSafetyError,
  type SyncCheckpoint,
  type SyncContext,
} from '@yeongdu/shared/src/sync-safety';
import {
  encryptedNoteSchema,
  encryptedOperationSchema,
  encryptedPushResultSchema,
  type EncryptedNote,
  type EncryptedOperation,
  type EncryptedPushResult,
} from '@yeongdu/shared/src/e2ee';
import type { ServerDatabase } from '../database/index.js';

export class OperationReuseError extends Error {}
export class EncryptionRequiredError extends Error {
  readonly statusCode = 409;
}

export class NotesRepository {
  private checkpoints: SyncCheckpoints;
  constructor(
    private db: ServerDatabase,
    private assertAttachmentsReady: (userId: string, ids: string[], keyId: string) => void = () => {
      throw new Error('첨부파일 저장소가 필요합니다.');
    },
  ) {
    this.checkpoints = new SyncCheckpoints(db);
  }

  checkpoint(userId: string): SyncCheckpoint {
    return this.checkpoints.checkpoint(userId);
  }

  verifyCheckpoint(userId: string, context: SyncContext) {
    return this.checkpoints.verifyCheckpoint(userId, context);
  }

  guardedPush(userId: string, operations: EncryptedOperation[], witness: SyncCheckpoint) {
    return this.db.sqlite.transaction(() => {
      this.verifyCheckpoint(userId, { witness, cursor: 0, knownRevision: 0 });
      for (const operation of operations) {
        if (operation.note.attachmentIds?.length) {
          this.assertAttachmentsReady(userId, operation.note.attachmentIds, operation.note.keyId);
        }
        const existing = this.find(userId, operation.note.id);
        if ((existing?.revision ?? 0) < operation.baseRevision) {
          throw new SyncSafetyError('server_regressed');
        }
      }
      return { results: this.push(userId, operations), checkpoint: this.checkpoint(userId) };
    })();
  }

  guardedPull(userId: string, cursor: number, witness: SyncCheckpoint, limit = 100) {
    return this.db.sqlite.transaction(() => {
      this.verifyCheckpoint(userId, { witness, cursor, knownRevision: 0 });
      return { ...this.pull(userId, cursor, limit), checkpoint: this.checkpoint(userId) };
    })();
  }

  key(userId: string): string | null {
    const row = this.db.sqlite
      .prepare('SELECT key_id FROM encryption_keys WHERE user_id = ?')
      .get(userId) as { key_id: string } | undefined;
    return row?.key_id ?? null;
  }

  registerKey(userId: string, keyId: string) {
    this.db.sqlite.transaction(() => {
      this.assertEncrypted(userId);
      const current = this.key(userId);
      if (current && current !== keyId) {
        throw new EncryptionRequiredError('다른 복구 키가 이미 등록되어 있습니다.');
      }
      this.db.sqlite
        .prepare('INSERT OR IGNORE INTO encryption_keys VALUES (?, ?)')
        .run(userId, keyId);
    })();
  }

  assertEncrypted(userId: string) {
    // Registration is committed only after legacy conversion. Avoid parsing every large
    // ciphertext on each request just to rediscover the account's migration state.
    if (this.key(userId)) {
      return;
    }
    const legacy = this.db.sqlite
      .prepare(
        `
      SELECT 1 FROM notes WHERE user_id = ?
      UNION ALL SELECT 1 FROM changes WHERE user_id = ?
      UNION ALL SELECT 1 FROM receipts WHERE user_id = ? LIMIT 1
    `,
      )
      .get(userId, userId, userId);
    if (legacy) {
      throw new EncryptionRequiredError('기존 평문 DB를 백업하고 e2ee:migrate를 실행하세요.');
    }
  }

  private find(userId: string, id: string): EncryptedNote | undefined {
    const row = this.db.sqlite
      .prepare('SELECT payload FROM notes WHERE user_id = ? AND id = ?')
      .get(userId, id) as { payload: string } | undefined;
    return row ? encryptedNoteSchema.parse(JSON.parse(row.payload)) : undefined;
  }

  private write(userId: string, note: EncryptedNote): EncryptedNote {
    const change = this.db.sqlite
      .prepare('INSERT INTO changes(user_id, payload, checkpoint) VALUES (?, ?, ?)')
      .run(userId, '{}', randomUUID());
    const saved = { ...note, revision: Number(change.lastInsertRowid) };
    const payload = JSON.stringify(saved);
    this.db.sqlite
      .prepare('UPDATE changes SET payload = ? WHERE user_id = ? AND seq = ?')
      .run(payload, userId, saved.revision);
    this.db.sqlite
      .prepare(
        `INSERT INTO notes VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload`,
      )
      .run(userId, saved.id, saved.revision, payload);
    if (saved.purged) {
      this.scrubHistory(userId, saved);
    }
    return saved;
  }

  private scrubHistory(userId: string, tombstone: EncryptedNote) {
    this.db.sqlite
      .prepare(
        `UPDATE changes SET payload = ?
      WHERE user_id = ? AND json_extract(payload, '$.id') = ?`,
      )
      .run(JSON.stringify(tombstone), userId, tombstone.id);
    const rows = this.db.sqlite
      .prepare('SELECT operation_id, result FROM receipts WHERE user_id = ?')
      .all(userId) as { operation_id: string; result: string }[];
    for (const row of rows) {
      const result = encryptedPushResultSchema.parse(JSON.parse(row.result));
      let changed = false;
      if (result.canonical.id === tombstone.id) {
        result.canonical = tombstone;
        changed = true;
      }
      if (result.conflict?.id === tombstone.id) {
        result.conflict = tombstone;
        changed = true;
      }
      if (changed) {
        this.db.sqlite
          .prepare('UPDATE receipts SET result = ? WHERE user_id = ? AND operation_id = ?')
          .run(JSON.stringify(result), userId, row.operation_id);
      }
    }
  }

  push(userId: string, operations: EncryptedOperation[]): EncryptedPushResult[] {
    return this.db.sqlite.transaction(() => {
      this.assertEncrypted(userId);
      const keyId = this.key(userId);
      return operations.map((input) => {
        const operation = encryptedOperationSchema.parse(input);
        if (
          !keyId ||
          operation.note.keyId !== keyId ||
          operation.note.id !== operation.note.sourceId ||
          operation.note.conflictId === operation.note.id
        ) {
          throw new EncryptionRequiredError('등록한 복구 키로 암호화된 메모만 전송할 수 있습니다.');
        }
        const hash = createHash('sha256').update(JSON.stringify(operation)).digest('hex');
        const receipt = this.db.sqlite
          .prepare(
            'SELECT request_hash, result FROM receipts WHERE user_id = ? AND operation_id = ?',
          )
          .get(userId, operation.operationId) as
          { request_hash: string; result: string } | undefined;
        if (receipt) {
          if (receipt.request_hash !== hash) {
            throw new OperationReuseError('중복 작업 ID의 내용이 다릅니다.');
          }
          return encryptedPushResultSchema.parse(JSON.parse(receipt.result));
        }
        const existing = this.find(userId, operation.note.id);
        const incoming = { ...operation.note, revision: 0 };
        let canonical: EncryptedNote;
        let conflict: EncryptedNote | null = null;
        if (existing && (existing.revision !== operation.baseRevision || existing.purged)) {
          canonical = existing;
          // Conflict presentation is applied on the client after authenticated decryption.
          if (this.find(userId, incoming.conflictId)) {
            throw new OperationReuseError('충돌 사본 ID가 이미 사용되었습니다.');
          }
          conflict = this.write(userId, {
            ...incoming,
            id: incoming.conflictId,
            conflictOf: incoming.id,
          });
        } else if (!existing && operation.baseRevision !== 0) {
          throw new OperationReuseError('서버에 없는 revision입니다.');
        } else {
          canonical = this.write(userId, incoming);
        }
        const result = { operationId: operation.operationId, canonical, conflict };
        this.db.sqlite
          .prepare('INSERT INTO receipts VALUES (?, ?, ?, ?)')
          .run(userId, operation.operationId, hash, JSON.stringify(result));
        return result;
      });
    })();
  }

  pull(userId: string, cursor: number, limit = 100) {
    this.assertEncrypted(userId);
    const rows = this.db.sqlite
      .prepare(
        'SELECT seq, payload FROM changes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      )
      .all(userId, cursor, limit + 1) as { seq: number; payload: string }[];
    const page = rows.slice(0, limit);
    return {
      notes: page.map((row) => encryptedNoteSchema.parse(JSON.parse(row.payload))),
      cursor: page.at(-1)?.seq ?? cursor,
      hasMore: rows.length > limit,
    };
  }

  list(userId: string) {
    this.assertEncrypted(userId);
    const rows = this.db.sqlite
      .prepare('SELECT payload FROM notes WHERE user_id = ? ORDER BY revision DESC')
      .all(userId) as { payload: string }[];
    return rows
      .map((row) => encryptedNoteSchema.parse(JSON.parse(row.payload)))
      .filter((note) => !note.purged);
  }
}
