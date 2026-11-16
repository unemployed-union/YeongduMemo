import {
  attachmentStorageId,
  attachmentSchema,
  joinAttachment,
  type Attachment,
  type AttachmentBackup,
  type Digest,
} from './attachments';
import type { SqlExecutor } from './local-database';

/** Payloads and upload retry ciphertext live inside SQLCipher, never in plaintext files. */
export class LocalAttachments {
  constructor(
    private db: SqlExecutor,
    private assertAccess: () => void,
    private digest: Digest,
  ) {}

  async validate(file: Attachment, chunks: string[]) {
    attachmentSchema.parse(file);
    if ((await this.digest(joinAttachment(chunks, file.size))) !== file.sha256) {
      throw new Error('첨부파일 무결성을 확인하지 못했습니다.');
    }
    this.assertAccess();
  }

  async write(tx: SqlExecutor, file: Attachment, chunks: string[]) {
    file = attachmentSchema.parse(file);
    await this.validate(file, chunks);
    const existing = await tx.getFirstAsync<{ descriptor: string }>(
      'SELECT descriptor FROM local_attachments WHERE id = ?',
      attachmentStorageId(file),
    );
    if (existing) {
      if (existing.descriptor !== JSON.stringify(file)) {
        throw new Error('첨부파일 ID의 내용이 다릅니다.');
      }
      const previous = await this.read(file, tx);
      if (JSON.stringify(previous) !== JSON.stringify(chunks)) {
        throw new Error('첨부파일 ID를 덮어쓸 수 없습니다.');
      }
      return;
    }
    await tx.runAsync(
      'INSERT INTO local_attachments VALUES (?, ?)',
      attachmentStorageId(file),
      JSON.stringify(file),
    );
    for (let index = 0; index < chunks.length; index++) {
      await tx.runAsync(
        'INSERT INTO attachment_chunks VALUES (?, ?, ?)',
        attachmentStorageId(file),
        index,
        chunks[index]!,
      );
    }
  }

  async read(file: Attachment, tx: SqlExecutor = this.db): Promise<string[] | null> {
    file = attachmentSchema.parse(file);
    this.assertAccess();
    const row = await tx.getFirstAsync<{ descriptor: string }>(
      'SELECT descriptor FROM local_attachments WHERE id = ?',
      attachmentStorageId(file),
    );
    if (!row) {
      return null;
    }
    if (row.descriptor !== JSON.stringify(file)) {
      throw new Error('첨부파일 ID의 내용이 다릅니다.');
    }
    const rows = await tx.getAllAsync<{ data: string }>(
      'SELECT data FROM attachment_chunks WHERE attachment_id = ? ORDER BY chunk_index',
      attachmentStorageId(file),
    );
    const chunks = rows.map((value) => value.data);
    joinAttachment(chunks, file.size);
    this.assertAccess();
    return chunks;
  }

  async backup(files: Attachment[]): Promise<AttachmentBackup[]> {
    const result: AttachmentBackup[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      if (seen.has(attachmentStorageId(file))) {
        continue;
      }
      const chunks = await this.read(file);
      if (!chunks) {
        throw new Error(
          '아직 다운로드하지 않은 첨부파일이 있습니다. 온라인에서 첨부파일을 연 후 다시 백업하세요.',
        );
      }
      await this.validate(file, chunks);
      result.push({ id: attachmentStorageId(file), chunks });
      seen.add(attachmentStorageId(file));
    }
    return result;
  }

  async receive(
    tx: SqlExecutor,
    file: Attachment,
    chunks: string[],
    upload?: { manifest: { keyId: string }; chunks: string[] },
  ) {
    await this.write(tx, file, chunks);
    if (upload) {
      const previous = await tx.getFirstAsync<{ payload: string }>(
        'SELECT payload FROM attachment_uploads WHERE attachment_id = ?',
        attachmentStorageId(file),
      );
      const payload = JSON.stringify(upload);
      if (previous && previous.payload !== payload) {
        throw new Error('첨부파일 재전송 데이터가 다릅니다.');
      }
      await tx.runAsync(
        'INSERT OR IGNORE INTO attachment_uploads VALUES (?, ?, ?)',
        attachmentStorageId(file),
        upload.manifest.keyId,
        payload,
      );
    }
    this.assertAccess();
  }
  async upload(
    tx: SqlExecutor,
    file: Attachment,
    keyId: string,
    prepare: () => Promise<unknown>,
  ): Promise<unknown> {
    const row = await tx.getFirstAsync<{ key_id: string; payload: string }>(
      'SELECT key_id, payload FROM attachment_uploads WHERE attachment_id = ?',
      attachmentStorageId(file),
    );
    if (row) {
      if (row.key_id !== keyId) {
        throw new Error('첨부파일의 암호화 키가 다릅니다. 키 교체는 지원하지 않습니다.');
      }
      return JSON.parse(row.payload);
    }
    const payload = await prepare();
    this.assertAccess();
    await tx.runAsync(
      'INSERT INTO attachment_uploads VALUES (?, ?, ?)',
      attachmentStorageId(file),
      keyId,
      JSON.stringify(payload),
    );
    return payload;
  }
  async hasUpload(id: string) {
    this.assertAccess();
    return !!(await this.db.getFirstAsync(
      'SELECT attachment_id FROM attachment_uploads WHERE attachment_id = ?',
      id,
    ));
  }
}
