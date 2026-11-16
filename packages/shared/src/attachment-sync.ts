import { z } from 'zod';
import {
  attachmentStorageId,
  blobManifestSchema,
  AttachmentEncryption,
  type Attachment,
  type BlobManifest,
} from './attachments';
import type { LocalStore } from './local-store';
import type { SyncCheckpoint } from './sync-safety';

export interface AttachmentTransport {
  stageAttachment(manifest: BlobManifest, witness: SyncCheckpoint): Promise<unknown>;
  putAttachmentChunk(
    id: string,
    index: number,
    data: string,
    witness: SyncCheckpoint,
  ): Promise<void>;
  commitAttachment(id: string, witness: SyncCheckpoint): Promise<void>;
  attachmentManifest(id: string): Promise<unknown>;
  attachmentChunk(id: string, index: number): Promise<string>;
}
const cachedUploadSchema = z.strictObject({
  manifest: blobManifestSchema,
  chunks: z.array(z.string()).min(1).max(80),
});

export class AttachmentSync {
  constructor(
    private local: LocalStore,
    private transport: AttachmentTransport,
    private encryption: AttachmentEncryption,
    private keyId: string,
  ) {}
  async upload(file: Attachment, witness: SyncCheckpoint) {
    if (!(await this.local.hasAttachmentUpload(attachmentStorageId(file)))) {
      const remote = await this.transport.attachmentManifest(attachmentStorageId(file));
      if (remote) {
        await this.download(file, remote);
      }
    }
    if (!(await this.local.transportAttachment(file))) {
      await this.download(file);
    }
    const cached = cachedUploadSchema.parse(
      await this.local.attachmentUpload(file, this.keyId, async () => {
        const chunks = await this.local.transportAttachment(file);
        if (!chunks) {
          throw new Error('전송할 첨부파일이 기기에 없습니다. 원본을 보존하고 복구하세요.');
        }
        return this.encryption.encrypt(file, chunks);
      }),
    );
    const state = z
      .strictObject({ ready: z.boolean() })
      .parse(await this.transport.stageAttachment(cached.manifest, witness));
    if (!state.ready) {
      for (let index = 0; index < cached.chunks.length; index++) {
        await this.transport.putAttachmentChunk(
          attachmentStorageId(file),
          index,
          cached.chunks[index]!,
          witness,
        );
      }
      await this.transport.commitAttachment(attachmentStorageId(file), witness);
    }
  }
  async download(file: Attachment, remote?: unknown) {
    const existing = await this.local.transportAttachment(file);
    if (existing && !remote) {
      return;
    }
    const manifest = blobManifestSchema.parse(
      remote ?? (await this.transport.attachmentManifest(attachmentStorageId(file))),
    );
    const chunks: string[] = [];
    for (let index = 0; index < manifest.chunks.length; index++) {
      chunks.push(await this.transport.attachmentChunk(attachmentStorageId(file), index));
    }
    const opened = await this.encryption.decrypt(file, manifest, chunks);
    await this.local.receiveAttachment(file, opened, { manifest, chunks });
  }
}
