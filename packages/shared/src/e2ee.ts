import { z } from 'zod';
import { noteContentSchema, noteSchema, type Note, type Operation } from './index';
import type { LocalStore } from './local-store';
import type { SyncTransport } from './sync';
import { attachmentStorageId } from './attachments';
import {
  assertCheckpointProgress,
  checkpointSchema,
  type SyncCheckpoint,
  type SyncContext,
} from './sync-safety';

export const keyIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const encryptionKeySchema = z.strictObject({ version: z.literal(1), keyId: keyIdSchema });
export const encryptedContentSchema = z.strictObject({
  id: z.uuid(),
  sourceId: z.uuid(),
  conflictId: z.uuid(),
  conflictOf: z.uuid().nullable(),
  version: z.literal(1),
  keyId: keyIdSchema,
  purged: z.boolean(),
  attachmentIds: z.array(z.uuid()).max(64).optional(),
  // Combined 12-byte nonce, UTF-8 JSON ciphertext and 16-byte GCM tag.
  ciphertext: z
    .string()
    .min(40)
    .max(8_100_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .refine((value) => value.length % 4 === 0),
});
export const encryptedNoteSchema = encryptedContentSchema.extend({
  revision: z.number().int().nonnegative(),
});
export const encryptedOperationSchema = z.strictObject({
  operationId: z.uuid(),
  clientId: z.uuid(),
  baseRevision: z.number().int().nonnegative(),
  note: encryptedContentSchema,
});
export const encryptedPushRequestSchema = z.strictObject({
  operations: z.array(encryptedOperationSchema).min(1).max(50),
});
export const encryptedPushResultSchema = z.strictObject({
  operationId: z.uuid(),
  canonical: encryptedNoteSchema,
  conflict: encryptedNoteSchema.nullable(),
});
export const encryptedPushResponseSchema = z.strictObject({
  results: z.array(encryptedPushResultSchema),
});
export const encryptedPullResponseSchema = z.strictObject({
  notes: z.array(encryptedNoteSchema),
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export const guardedPushResponseSchema = encryptedPushResponseSchema.extend({
  checkpoint: checkpointSchema,
});
export const guardedPullResponseSchema = encryptedPullResponseSchema.extend({
  checkpoint: checkpointSchema,
});
export type EncryptedNote = z.infer<typeof encryptedNoteSchema>;
export type EncryptedOperation = z.infer<typeof encryptedOperationSchema>;
export type EncryptedPushResult = z.infer<typeof encryptedPushResultSchema>;

export interface AeadCipher {
  readonly keyId: string;
  randomUUID(): string;
  seal(plaintext: Uint8Array, additionalData: Uint8Array): Promise<string>;
  open(ciphertext: string, additionalData: Uint8Array): Promise<Uint8Array>;
}

export function normalizeRecoveryKey(input: string): string {
  const key = input.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(key)) {
    throw new Error('복구 키는 앱에서 생성한 64자리 영문·숫자 키여야 합니다.');
  }
  return key;
}

export class NoteEncryption {
  constructor(
    private cipher: AeadCipher,
    private userId: string,
  ) {}

  private context(sourceId: string, purged: boolean, conflictId: string, attachmentIds?: string[]) {
    return new TextEncoder().encode(
      JSON.stringify([
        'yeongdu-memo',
        1,
        this.userId,
        this.cipher.keyId,
        sourceId,
        purged,
        conflictId,
        ...(attachmentIds ? [attachmentIds] : []),
      ]),
    );
  }

  async encrypt(note: Note): Promise<EncryptedNote> {
    const content = noteContentSchema.parse(note);
    const conflictId = this.cipher.randomUUID();
    const attachmentIds = content.attachments.length
      ? content.attachments.map(attachmentStorageId)
      : undefined;
    return encryptedNoteSchema.parse({
      id: note.id,
      sourceId: note.id,
      conflictId,
      conflictOf: note.conflictOf,
      version: 1,
      keyId: this.cipher.keyId,
      purged: note.purged,
      ...(attachmentIds ? { attachmentIds } : {}),
      revision: note.revision,
      ciphertext: await this.cipher.seal(
        new TextEncoder().encode(JSON.stringify(content)),
        this.context(note.id, note.purged, conflictId, attachmentIds),
      ),
    });
  }

  async decrypt(input: EncryptedNote): Promise<Note> {
    try {
      const note = encryptedNoteSchema.parse(input);
      if (note.keyId !== this.cipher.keyId) {
        throw new Error('key mismatch');
      }
      const bytes = await this.cipher.open(
        note.ciphertext,
        this.context(note.sourceId, note.purged, note.conflictId, note.attachmentIds),
      );
      const content = noteContentSchema.parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      const isConflictCopy = note.id !== note.sourceId;
      if (
        JSON.stringify(content.attachments.map(attachmentStorageId)) !==
        JSON.stringify(note.attachmentIds ?? [])
      ) {
        throw new Error('attachment identity');
      }
      if (
        content.id !== note.sourceId ||
        content.purged !== note.purged ||
        (isConflictCopy
          ? note.id !== note.conflictId || note.conflictOf !== note.sourceId
          : note.conflictOf !== content.conflictOf)
      ) {
        throw new Error('identity mismatch');
      }
      return noteSchema.parse({
        ...content,
        id: note.id,
        revision: note.revision,
        ...(isConflictCopy
          ? {
              conflictOf: note.sourceId,
              title: `${(content.title || '제목 없음').slice(0, 990)} (충돌 사본)`,
              deletedAt: content.purged ? content.deletedAt : null,
              archived: false,
            }
          : {}),
      });
    } catch {
      // Do not surface native/parser errors containing decrypted data.
      throw new Error(
        '메모 복호화에 실패했습니다. 복구 키 또는 서버 데이터의 무결성을 확인하세요.',
      );
    }
  }
}

export interface EncryptedSyncTransport {
  checkpoint(context: SyncContext): Promise<unknown>;
  push(operations: EncryptedOperation[], witness: SyncCheckpoint): Promise<unknown>;
  pull(cursor: number, witness: SyncCheckpoint): Promise<unknown>;
}

export class EncryptedTransport implements SyncTransport {
  constructor(
    private local: LocalStore,
    private transport: EncryptedSyncTransport,
    private encryption: NoteEncryption,
    private uploadAttachments?: (operation: Operation, witness: SyncCheckpoint) => Promise<void>,
  ) {}

  async checkpoint(context: SyncContext) {
    return this.transport.checkpoint(context);
  }

  async push(operations: Operation[], witness: SyncCheckpoint) {
    const results = [];
    let checkpoint = witness;
    // Individual requests also bound the HTTP body size for maximum-length notes.
    for (const operation of operations) {
      if (operation.note.attachments.length > 0) {
        if (!this.uploadAttachments) {
          throw new Error('첨부파일 전송을 지원하는 앱이 필요합니다.');
        }
        await this.uploadAttachments(operation, checkpoint);
      }
      const encrypted = await this.local.encryptedOperation(operation, async () => {
        const encryptedNote = await this.encryption.encrypt({
          ...operation.note,
          revision: operation.baseRevision,
        });
        const note = encryptedContentSchema.parse({
          id: encryptedNote.id,
          sourceId: encryptedNote.sourceId,
          conflictId: encryptedNote.conflictId,
          conflictOf: encryptedNote.conflictOf,
          version: encryptedNote.version,
          keyId: encryptedNote.keyId,
          purged: encryptedNote.purged,
          ciphertext: encryptedNote.ciphertext,
          ...(encryptedNote.attachmentIds ? { attachmentIds: encryptedNote.attachmentIds } : {}),
        });
        return encryptedOperationSchema.parse({ ...operation, note });
      });
      const response = guardedPushResponseSchema.parse(
        await this.transport.push([encrypted], checkpoint),
      );
      assertCheckpointProgress(checkpoint, response.checkpoint);
      for (const result of response.results) {
        results.push({
          operationId: result.operationId,
          canonical: await this.encryption.decrypt(result.canonical),
          conflict: result.conflict ? await this.encryption.decrypt(result.conflict) : null,
        });
      }
      await this.local.recordSyncCheckpoint(response.checkpoint);
      checkpoint = response.checkpoint;
    }
    return { results, checkpoint };
  }

  async pull(cursor: number, witness: SyncCheckpoint) {
    const page = guardedPullResponseSchema.parse(await this.transport.pull(cursor, witness));
    // Decode the whole page before committing any notes or advancing the cursor.
    const notes = [];
    for (const note of page.notes) {
      notes.push(await this.encryption.decrypt(note));
    }
    return { ...page, notes };
  }
}
