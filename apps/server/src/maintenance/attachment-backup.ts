import Database from 'better-sqlite3';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ATTACHMENT_CHUNK_BYTES, blobManifestSchema } from '@yeongdu/shared/src/attachments';
import { blobKey, verifyBlob, type BlobStore } from '../storage/blobs.js';
import { backupDatabase } from './backup.js';

export async function verifyAttachmentBackup(snapshotPath: string) {
  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = snapshot.pragma('integrity_check', { simple: true });
    const foreignKeys = snapshot.pragma('foreign_key_check') as unknown[];
    if (integrity !== 'ok' || foreignKeys.length > 0) {
      throw new Error('DB 무결성 검사에 실패했습니다.');
    }
    const version = snapshot.pragma('user_version', { simple: true }) as number;
    if (version >= 1 && version < 4) {
      return { files: 0, legacy: true };
    }
    if (version !== 4) {
      throw new Error('지원하지 않는 백업 DB 버전입니다.');
    }
    const marker = z
      .strictObject({
        format: z.literal('yeongdu-memo-blobs'),
        version: z.literal(1),
        storage: z.string(),
        files: z.array(
          z.strictObject({
            key: z.string(),
            size: z
              .number()
              .int()
              .min(28)
              .max(ATTACHMENT_CHUNK_BYTES + 28),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        ),
      })
      .parse(
        JSON.parse(await readFile(join(`${snapshotPath}.attachments`, 'complete.json'), 'utf8')),
      );
    const listed = new Map(marker.files.map((file) => [file.key, file]));
    if (listed.size !== marker.files.length) {
      throw new Error('백업 파일 목록이 중복되었습니다.');
    }
    const rows = snapshot
      .prepare('SELECT user_id, manifest, ready, storage FROM attachments')
      .all() as { user_id: string; manifest: string; ready: number; storage: string }[];
    for (const row of rows) {
      if (row.storage !== marker.storage) {
        throw new Error('백업 저장소 식별자가 다릅니다.');
      }
      const manifest = blobManifestSchema.parse(JSON.parse(row.manifest));
      const userId = z.uuid().parse(row.user_id);
      for (let index = 0; index < manifest.chunks.length; index++) {
        const key = blobKey(userId, manifest, index);
        const file = listed.get(key);
        if (!file) {
          if (row.ready) {
            throw new Error('백업의 완료된 첨부파일이 누락되었습니다.');
          }
          continue;
        }
        const expected = manifest.chunks[index]!;
        if (file.sha256 !== expected.sha256 || file.size !== expected.size) {
          throw new Error('백업 파일 정보가 다릅니다.');
        }
        const path = join(`${snapshotPath}.attachments`, key);
        if ((await stat(path)).size !== expected.size) {
          throw new Error('백업 파일 크기가 다릅니다.');
        }
        verifyBlob(await readFile(path), expected);
        listed.delete(key);
      }
    }
    if (listed.size > 0) {
      throw new Error('백업에 알 수 없는 파일 참조가 있습니다.');
    }
    return { files: marker.files.length, legacy: false };
  } finally {
    snapshot.close();
  }
}

/** The DB snapshot pins immutable blob keys; no GC is performed during normal operation. */
export async function backupSnapshotBlobs(snapshotPath: string, store: BlobStore) {
  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    const version = snapshot.pragma('user_version', { simple: true }) as number;
    if (version < 4) {
      return;
    }
    const rows = snapshot
      .prepare('SELECT user_id, manifest, ready, storage FROM attachments')
      .all() as { user_id: string; manifest: string; ready: number; storage: string }[];
    const directory = `${snapshotPath}.attachments`;
    await mkdir(directory, { mode: 0o700 });
    const files: { key: string; size: number; sha256: string }[] = [];
    for (const row of rows) {
      if (row.storage !== store.identity) {
        throw new Error('백업 대상 첨부 저장소가 DB 설정과 다릅니다.');
      }
      const userId = z.uuid().parse(row.user_id);
      const manifest = blobManifestSchema.parse(JSON.parse(row.manifest));
      for (let index = 0; index < manifest.chunks.length; index++) {
        const key = blobKey(userId, manifest, index);
        const bytes = await store.get(key);
        if (!bytes) {
          if (row.ready) {
            throw new Error('완료된 첨부파일이 저장소에 없습니다. 백업을 완료할 수 없습니다.');
          }
          continue;
        }
        const chunk = manifest.chunks[index]!;
        verifyBlob(bytes, chunk);
        const destination = join(directory, key);
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
        files.push({ key, ...chunk });
      }
    }
    // Written last. A missing marker means the DB + sidecar backup is incomplete.
    await writeFile(
      join(directory, 'complete.json'),
      JSON.stringify(
        { format: 'yeongdu-memo-blobs', version: 1, storage: store.identity, files },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
  } finally {
    snapshot.close();
  }
}
export async function backupServerDatabase(source: string, destination: string, store: BlobStore) {
  await backupDatabase(source, destination);
  await backupSnapshotBlobs(destination, store);
}
