import { blobManifestSchema, type BlobManifest } from '@yeongdu/shared/src/attachments';
import type { ServerDatabase } from '../database/index.js';
import { blobKey, verifyBlob, type BlobStore } from '../storage/blobs.js';

export class AttachmentError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export class AttachmentsRepository {
  constructor(
    private db: ServerDatabase,
    private blobs: BlobStore,
    private quotaBytes = 1024 * 1024 * 1024,
  ) {
    const incompatible = db.sqlite
      .prepare('SELECT 1 FROM attachments WHERE storage <> ? LIMIT 1')
      .get(blobs.identity);
    if (incompatible) {
      throw new Error(
        '기존 첨부 저장소와 설정이 다릅니다. 원본을 보관하고 저장소 이전 절차를 먼저 준비하세요.',
      );
    }
  }
  private row(userId: string, id: string) {
    return this.db.sqlite
      .prepare('SELECT manifest, storage, ready FROM attachments WHERE user_id = ? AND id = ?')
      .get(userId, id) as { manifest: string; storage: string; ready: number } | undefined;
  }
  private manifest(userId: string, id: string, requireReady = false) {
    const row = this.row(userId, id);
    if (!row || (requireReady && !row.ready)) {
      throw new AttachmentError(404, '첨부파일을 찾을 수 없습니다.');
    }
    if (row.storage !== this.blobs.identity) {
      throw new AttachmentError(
        503,
        '첨부 저장소 설정이 기존 데이터와 다릅니다. 관리자 확인이 필요합니다.',
      );
    }
    return blobManifestSchema.parse(JSON.parse(row.manifest));
  }
  stage(userId: string, input: BlobManifest) {
    const manifest = blobManifestSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      const key = this.db.sqlite
        .prepare('SELECT key_id FROM encryption_keys WHERE user_id = ?')
        .get(userId) as { key_id: string } | undefined;
      if (key?.key_id !== manifest.keyId) {
        throw new AttachmentError(409, '등록된 암호화 키가 다릅니다.');
      }
      const previous = this.row(userId, manifest.id);
      if (previous) {
        if (
          previous.manifest !== JSON.stringify(manifest) ||
          previous.storage !== this.blobs.identity
        ) {
          throw new AttachmentError(409, '첨부파일 ID를 덮어쓸 수 없습니다.');
        }
        return { ready: !!previous.ready };
      }
      const total = this.db.sqlite
        .prepare('SELECT COALESCE(SUM(bytes), 0) AS total FROM attachments WHERE user_id = ?')
        .get(userId) as { total: number };
      const size = manifest.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
      if (total.total + size > this.quotaBytes) {
        throw new AttachmentError(413, '계정의 첨부파일 저장 용량을 초과했습니다.');
      }
      this.db.sqlite
        .prepare(
          'INSERT INTO attachments(user_id, id, manifest, storage, bytes) VALUES (?, ?, ?, ?, ?)',
        )
        .run(userId, manifest.id, JSON.stringify(manifest), this.blobs.identity, size);
      return { ready: false };
    })();
  }
  async put(userId: string, id: string, index: number, bytes: Uint8Array) {
    const manifest = this.manifest(userId, id);
    const chunk = manifest.chunks[index];
    if (!chunk) {
      throw new AttachmentError(400, '잘못된 조각 번호입니다.');
    }
    verifyBlob(bytes, chunk);
    await this.blobs.put(blobKey(userId, manifest, index), bytes);
  }
  async commit(userId: string, id: string) {
    const manifest = this.manifest(userId, id);
    for (let index = 0; index < manifest.chunks.length; index++) {
      const bytes = await this.blobs.get(blobKey(userId, manifest, index));
      if (!bytes) {
        throw new AttachmentError(409, '첨부파일 조각이 누락되었습니다. 다시 전송하세요.');
      }
      verifyBlob(bytes, manifest.chunks[index]!);
    }
    this.db.sqlite
      .prepare('UPDATE attachments SET ready = 1 WHERE user_id = ? AND id = ?')
      .run(userId, id);
  }
  getManifest(userId: string, id: string) {
    return this.manifest(userId, id, true);
  }
  async get(userId: string, id: string, index: number) {
    const manifest = this.manifest(userId, id, true);
    const expected = manifest.chunks[index];
    if (!expected) {
      throw new AttachmentError(404, '첨부파일을 찾을 수 없습니다.');
    }
    const bytes = await this.blobs.get(blobKey(userId, manifest, index));
    if (!bytes) {
      throw new AttachmentError(503, '첨부파일 저장소에 파일이 없습니다. 백업을 확인하세요.');
    }
    verifyBlob(bytes, expected);
    return bytes;
  }
  assertReady(userId: string, ids: string[], keyId: string) {
    for (const id of ids) {
      if (this.manifest(userId, id, true).keyId !== keyId) {
        throw new AttachmentError(409, '첨부파일 키가 다릅니다.');
      }
    }
  }
}
