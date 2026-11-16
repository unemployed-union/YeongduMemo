import { z } from 'zod';
import type { AeadCipher } from './e2ee';

export const ATTACHMENT_CHUNK_BYTES = 256 * 1024;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_NOTE_ATTACHMENTS = 64;
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const attachmentSchema = z.strictObject({
  id: z.uuid(),
  blobId: z.uuid().optional(),
  name: z.string().min(1).max(255),
  mime: z
    .string()
    .max(127)
    .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
  size: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
  sha256: sha256Schema,
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export function attachmentStorageId(file: Attachment) {
  return file.blobId ?? file.id;
}
export const blobManifestSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  keyId: sha256Schema,
  chunks: z
    .array(
      z.strictObject({
        sha256: sha256Schema,
        size: z
          .number()
          .int()
          .min(28)
          .max(ATTACHMENT_CHUNK_BYTES + 28),
      }),
    )
    .min(1)
    .max(MAX_ATTACHMENT_BYTES / ATTACHMENT_CHUNK_BYTES),
});
export type BlobManifest = z.infer<typeof blobManifestSchema>;
export type Digest = (bytes: Uint8Array) => Promise<string>;
export const attachmentDataSchema = z
  .string()
  .max(Math.ceil(ATTACHMENT_CHUNK_BYTES / 3) * 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const attachmentBackupSchema = z.strictObject({
  id: z.uuid(),
  chunks: z.array(attachmentDataSchema).min(1).max(80),
});
export type AttachmentBackup = z.infer<typeof attachmentBackupSchema>;

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function encodeBytes(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    parts.push(
      alphabet[(value >>> 18) & 63]! +
        alphabet[(value >>> 12) & 63]! +
        (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63]! : '=') +
        (i + 2 < bytes.length ? alphabet[value & 63]! : '='),
    );
  }
  return parts.join('');
}
export function decodeBytes(text: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('첨부파일 인코딩이 올바르지 않습니다.');
  }
  const bytes = new Uint8Array(
    (text.length / 4) * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0),
  );
  let offset = 0;
  for (let i = 0; i < text.length; i += 4) {
    const value =
      (alphabet.indexOf(text[i]!) << 18) |
      (alphabet.indexOf(text[i + 1]!) << 12) |
      (Math.max(0, alphabet.indexOf(text[i + 2]!)) << 6) |
      Math.max(0, alphabet.indexOf(text[i + 3]!));
    bytes[offset++] = value >>> 16;
    if (offset < bytes.length) {
      bytes[offset++] = value >>> 8;
    }
    if (offset < bytes.length) {
      bytes[offset++] = value;
    }
  }
  if (encodeBytes(bytes) !== text) {
    throw new Error('첨부파일 인코딩이 올바르지 않습니다.');
  }
  return bytes;
}
export function splitAttachment(bytes: Uint8Array): string[] {
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error('첨부파일은 20MiB까지 지원합니다.');
  }
  const chunks: string[] = [];
  for (let i = 0; i < Math.max(1, bytes.length); i += ATTACHMENT_CHUNK_BYTES) {
    chunks.push(encodeBytes(bytes.subarray(i, i + ATTACHMENT_CHUNK_BYTES)));
  }
  return chunks;
}
export function joinAttachment(chunks: string[], size: number): Uint8Array {
  if (
    size < 0 ||
    size > MAX_ATTACHMENT_BYTES ||
    chunks.length !== Math.max(1, Math.ceil(size / ATTACHMENT_CHUNK_BYTES))
  ) {
    throw new Error('첨부파일 조각이 누락되었거나 크기가 다릅니다.');
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = decodeBytes(attachmentDataSchema.parse(chunks[index]));
    const expected = Math.min(ATTACHMENT_CHUNK_BYTES, size - offset);
    if (chunk.length !== expected) {
      throw new Error('첨부파일 조각 크기가 다릅니다.');
    }
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export function attachmentMarkup(file: Attachment): string {
  const name = file.name.replace(/[[\]\\\r\n]/g, '_');
  return `${file.mime.startsWith('image/') ? '!' : ''}[${name}](attachment:${file.id})`;
}
export function attachmentLink(text: string): { id: string; image: boolean } | null {
  const match = /^(!?)\[[^\]\r\n]*\]\(attachment:([a-f0-9-]+)\)$/.exec(text.trim());
  if (!match || !z.uuid().safeParse(match[2]).success) {
    return null;
  }
  return { id: match[2]!, image: match[1] === '!' };
}
export function removeAttachmentMarkup(source: string, id: string) {
  z.uuid().parse(id);
  return source.replace(
    new RegExp(`^!?\\[[^\\]\\r\\n]*\\]\\(attachment:${id}\\)[\\t ]*(?:\\r\\n|\\r|\\n|$)`, 'gm'),
    '',
  );
}
export function resizedDimensions(width: number, height: number, maxEdge: number | null) {
  const scale = maxEdge === null ? 1 : Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export class AttachmentEncryption {
  constructor(
    private cipher: AeadCipher,
    private userId: string,
    private digest: Digest,
  ) {}
  private context(id: string, index: number, count: number) {
    return new TextEncoder().encode(
      JSON.stringify([
        'yeongdu-memo-attachment',
        1,
        this.userId,
        this.cipher.keyId,
        id,
        index,
        count,
      ]),
    );
  }
  async encrypt(file: Attachment, chunks: string[]) {
    const bytes = joinAttachment(chunks, file.size);
    if ((await this.digest(bytes)) !== file.sha256) {
      throw new Error('첨부파일 무결성을 확인하지 못했습니다.');
    }
    const encrypted: string[] = [];
    const manifest: BlobManifest = {
      version: 1,
      id: attachmentStorageId(file),
      keyId: this.cipher.keyId,
      chunks: [],
    };
    for (let index = 0; index < chunks.length; index++) {
      const sealed = await this.cipher.seal(
        decodeBytes(chunks[index]!),
        this.context(attachmentStorageId(file), index, chunks.length),
      );
      const raw = decodeBytes(sealed);
      encrypted.push(sealed);
      manifest.chunks.push({ sha256: await this.digest(raw), size: raw.length });
    }
    return { manifest: blobManifestSchema.parse(manifest), chunks: encrypted };
  }
  async decrypt(file: Attachment, input: BlobManifest, chunks: string[]) {
    try {
      const manifest = blobManifestSchema.parse(input);
      if (
        manifest.id !== attachmentStorageId(file) ||
        manifest.keyId !== this.cipher.keyId ||
        manifest.chunks.length !== chunks.length
      ) {
        throw new Error('identity');
      }
      const opened: string[] = [];
      for (let index = 0; index < chunks.length; index++) {
        const raw = decodeBytes(chunks[index]!);
        const expected = manifest.chunks[index]!;
        if (raw.length !== expected.size || (await this.digest(raw)) !== expected.sha256) {
          throw new Error('digest');
        }
        opened.push(
          encodeBytes(
            await this.cipher.open(
              chunks[index]!,
              this.context(attachmentStorageId(file), index, chunks.length),
            ),
          ),
        );
      }
      const bytes = joinAttachment(opened, file.size);
      if ((await this.digest(bytes)) !== file.sha256) {
        throw new Error('digest');
      }
      return opened;
    } catch {
      throw new Error('첨부파일 복호화 또는 무결성 검사에 실패했습니다. 원본을 삭제하지 마세요.');
    }
  }
}
