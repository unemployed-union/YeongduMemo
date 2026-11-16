import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import Database from 'better-sqlite3';
import { blankNote, type Note } from '@yeongdu/shared';
import {
  ATTACHMENT_CHUNK_BYTES,
  AttachmentEncryption,
  attachmentLink,
  attachmentMarkup,
  joinAttachment,
  removeAttachmentMarkup,
  resizedDimensions,
  splitAttachment,
  type Attachment,
} from '@yeongdu/shared/src/attachments';
import { AttachmentSync, type AttachmentTransport } from '@yeongdu/shared/src/attachment-sync';
import { EncryptedTransport, NoteEncryption } from '@yeongdu/shared/src/e2ee';
import { SyncService } from '@yeongdu/shared/src/sync';
import { SyncSafetyError, syncIssueSchema } from '@yeongdu/shared/src/sync-safety';
import { CategoryAccessError } from '@yeongdu/shared/src/category-access';
import { createApp } from '../apps/server/src/app';
import { migrationCipher } from '../apps/server/src/maintenance/e2ee-migration';
import {
  backupServerDatabase,
  verifyAttachmentBackup,
} from '../apps/server/src/maintenance/attachment-backup';
import { FileBlobStore, S3BlobStore, blobKey } from '../apps/server/src/storage/blobs';
import { localDevice, testRecoveryKey } from './helpers';

const digest = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const devices: ReturnType<typeof localDevice>[] = [];
const servers: Awaited<ReturnType<typeof createApp>>[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.app.close();
  }
  for (const device of devices.splice(0)) {
    device.sqlite.close();
  }
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});
function folder() {
  const path = mkdtempSync(join(tmpdir(), 'memo-attachments-'));
  directories.push(path);
  return path;
}
async function device(path = ':memory:') {
  const result = localDevice(path, undefined, async () => true);
  devices.push(result);
  await result.store.migrate();
  return result;
}
async function file(
  bytes = randomBytes(ATTACHMENT_CHUNK_BYTES + 7),
): Promise<{ file: Attachment; chunks: string[]; bytes: Uint8Array }> {
  return {
    file: {
      id: randomUUID(),
      name: '민감한 파일.png',
      mime: 'image/png',
      size: bytes.length,
      sha256: await digest(bytes),
      width: 6000,
      height: 4000,
    },
    chunks: splitAttachment(bytes),
    bytes: new Uint8Array(bytes),
  };
}
async function setup(quota?: number) {
  const directory = folder();
  const blobs = new FileBlobStore(join(directory, 'blobs'));
  const server = await createApp({
    databasePath: join(directory, 'server.db'),
    blobStore: blobs,
    ...(quota ? { attachmentQuotaBytes: quota } : {}),
  });
  servers.push(server);
  const userId = await server.auth.createUser('attachment@example.com', 'test-attachment-password');
  const tokens = (await server.auth.login('attachment@example.com', 'test-attachment-password'))!;
  server.notes.registerKey(userId, migrationCipher(testRecoveryKey).keyId);
  return { server, userId, tokens, blobs, directory };
}
function connection(
  server: Awaited<ReturnType<typeof createApp>>,
  access: string,
  local: ReturnType<typeof localDevice>,
) {
  const userId = server.auth.authenticate(access)!;
  const cipher = migrationCipher(testRecoveryKey);
  const encryption = new AttachmentEncryption(cipher, userId, digest);
  async function request(path: string, method = 'GET', payload?: unknown) {
    const response = await server.app.inject({
      url: path,
      method: method as 'GET' | 'POST' | 'PUT',
      headers: { authorization: `Bearer ${access}` },
      ...(payload ? { payload } : {}),
    });
    if (response.statusCode !== 200) {
      const code = syncIssueSchema.safeParse(response.json().code);
      if (code.success) {
        throw new SyncSafetyError(code.data);
      }
      throw new Error(`HTTP ${response.statusCode}`);
    }
    return response.json();
  }
  const api: AttachmentTransport = {
    stageAttachment: (manifest, witness) =>
      request('/attachments/v1/stage', 'POST', { manifest, witness }),
    async putAttachmentChunk(id, index, data, witness) {
      await request(`/attachments/v1/${id}/chunks/${index}`, 'PUT', { data, witness });
    },
    async commitAttachment(id, witness) {
      await request(`/attachments/v1/${id}/commit`, 'POST', { witness });
    },
    async attachmentManifest(id) {
      const response = await server.app.inject({
        url: `/attachments/v1/${id}`,
        headers: { authorization: `Bearer ${access}` },
      });
      return response.statusCode === 404 ? null : response.json();
    },
    async attachmentChunk(id, index) {
      return (await request(`/attachments/v1/${id}/chunks/${index}`)).data;
    },
  };
  const transfer = new AttachmentSync(local.store, api, encryption, cipher.keyId);
  const transport = new EncryptedTransport(
    local.store,
    {
      checkpoint: (context) => request('/sync/v4/checkpoint', 'POST', context),
      push: (operations, witness) => request('/sync/v4/push', 'POST', { operations, witness }),
      pull: (cursor, witness) => request('/sync/v4/pull', 'POST', { cursor, witness }),
    },
    new NoteEncryption(cipher, userId),
    async (operation, witness) => {
      for (const attachment of operation.note.attachments) {
        await transfer.upload(attachment, witness);
      }
    },
  );
  return {
    api,
    transfer,
    encryption,
    request,
    sync: new SyncService(local.store.synchronization, transport),
  };
}

describe('encrypted attachments', () => {
  it('resumes the same file ciphertext and operation UUID after a lost chunk response and DB reopen', async () => {
    const { server, tokens } = await setup();
    const path = join(folder(), 'device.db');
    const first = await device(path);
    const upload = await file();
    await first.store.attachFile(
      await first.store.save(blankNote(randomUUID())),
      upload.file,
      upload.chunks,
      0,
    );
    const client = connection(server, tokens.accessToken, first);
    const put = client.api.putAttachmentChunk;
    client.api.putAttachmentChunk = async (...args) => {
      await put(...args);
      throw new Error('lost response');
    };
    const pending = await first.store.pending();
    await expect(client.sync.sync()).rejects.toThrow('lost response');
    const retry = first.sqlite.prepare('SELECT * FROM attachment_uploads').all();
    first.sqlite.close();
    devices.splice(devices.indexOf(first), 1);
    const reopened = await device(path);
    expect(await reopened.store.pending()).toEqual(pending);
    expect(reopened.sqlite.prepare('SELECT * FROM attachment_uploads').all()).toEqual(retry);
    const resumed = connection(server, tokens.accessToken, reopened);
    const encrypt = vi.spyOn(resumed.encryption, 'encrypt');
    await resumed.sync.sync();
    expect(encrypt).not.toHaveBeenCalled();
    expect(await reopened.store.pending()).toEqual([]);
    expect(reopened.sqlite.prepare('SELECT * FROM attachment_uploads').all()).toEqual(retry);
    const peer = await device();
    await connection(server, tokens.accessToken, peer).transfer.download(upload.file);
    expect(
      joinAttachment((await peer.store.transportAttachment(upload.file))!, upload.file.size),
    ).toEqual(upload.bytes);
  });

  it('restores multiple files and shared blob references without altering Markdown or mixing file bytes', async () => {
    const source = await device();
    const files = await Promise.all([
      file(randomBytes(7)),
      file(randomBytes(11)),
      file(randomBytes(17)),
    ]);
    let first = await source.store.save({ ...blankNote(randomUUID()), body: '# original\r\n' });
    first = await source.store.attachFile(
      first,
      files[0]!.file,
      files[0]!.chunks,
      first.body.length,
    );
    first = await source.store.attachFile(
      first,
      files[1]!.file,
      files[1]!.chunks,
      first.body.length,
    );
    let second = await source.store.save({
      ...blankNote(randomUUID()),
      body: attachmentMarkup(files[0]!.file) + '\n',
      attachments: [files[0]!.file],
    });
    second = await source.store.attachFile(
      second,
      files[2]!.file,
      files[2]!.chunks,
      second.body.length,
    );
    const backup = (await source.store.exportBackup())!;
    expect(backup.attachments).toHaveLength(3);
    const restored = await device();
    await restored.store.importBackup(
      await restored.store.prepareBackupImport(JSON.stringify(backup)),
    );
    const notes = await restored.store.list('notes');
    expect(notes.map((note) => note.body).sort()).toEqual([first.body, second.body].sort());
    const shared = notes.map((note) =>
      note.attachments.find((item) => item.id === files[0]!.file.id)!,
    );
    expect(shared[0]!.blobId).toBe(shared[1]!.blobId);
    expect(shared[0]!.blobId).not.toBe(files[0]!.file.id);
    for (const note of notes) {
      for (const attachment of note.attachments) {
        const expected = files.find((item) => item.file.id === attachment.id)!;
        const restoredData = await restored.store.attachmentData(note.id, attachment.id);
        expect(joinAttachment(restoredData.chunks!, attachment.size)).toEqual(expected.bytes);
      }
    }
  });
  it('upgrades v3 server and v2 local schemas without changing checkpoint lineage, old payloads or pending UUIDs', async () => {
    const { server, tokens, userId, directory, blobs } = await setup();
    const local = await device();
    const note = await local.store.save({ ...blankNote(randomUUID()), body: '이전 메모\r\n원문' });
    await connection(server, tokens.accessToken, local).sync.sync();
    const checkpoint = server.notes.checkpoint(userId);
    const tables = ['notes', 'sessions', 'receipts', 'changes'];
    const original = tables.map((table) =>
      server.db.sqlite.prepare(`SELECT * FROM ${table}`).all(),
    );
    await server.app.close();
    const path = join(directory, 'server.db');
    const previous = new Database(path);
    previous.exec('DROP TABLE attachments; PRAGMA user_version = 3;');
    previous.close();
    const upgraded = await createApp({ databasePath: path, blobStore: blobs });
    servers.push(upgraded);
    expect(upgraded.notes.checkpoint(userId)).toEqual(checkpoint);
    tables.forEach((table, index) =>
      expect(upgraded.db.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual(original[index]),
    );
    await local.store.save({ ...(await local.store.get(note.id))!, body: '오프라인 수정 보존' });
    const before = ['notes', 'outbox', 'metadata', 'encrypted_outbox'].map((table) =>
      local.sqlite.prepare(`SELECT * FROM ${table}`).all(),
    );
    local.sqlite.exec(
      'DROP TABLE attachment_uploads; DROP TABLE attachment_chunks; DROP TABLE local_attachments; PRAGMA user_version = 2;',
    );
    await local.store.migrate();
    ['notes', 'outbox', 'metadata', 'encrypted_outbox'].forEach((table, index) =>
      expect(local.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[index]),
    );
    expect(local.sqlite.pragma('user_version', { simple: true })).toBe(3);
  });
  it('preserves Markdown, inserts real attachment blocks, and rolls back file + note + outbox together', async () => {
    const local = await device();
    const note = await local.store.save({ ...blankNote(randomUUID()), body: '# 원문\r\n' });
    const upload = await file(randomBytes(23));
    const saved = await local.store.attachFile(note, upload.file, upload.chunks, note.body.length);
    expect(saved.body).toBe(note.body + attachmentMarkup(upload.file) + '\n');
    expect(
      joinAttachment(
        (await local.store.attachmentData(note.id, upload.file.id)).chunks!,
        upload.file.size,
      ),
    ).toEqual(upload.bytes);
    const pending = await local.store.pending();
    const invalid = await file(randomBytes(7));
    await expect(
      local.store.attachFile(saved, { ...invalid.file, sha256: '0'.repeat(64) }, invalid.chunks, 0),
    ).rejects.toThrow('무결성');
    expect(await local.store.get(note.id)).toEqual(saved);
    expect(await local.store.pending()).toEqual(pending);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS count FROM local_attachments').get()).toEqual({
      count: 1,
    });
    expect(attachmentLink(attachmentMarkup(upload.file))).toEqual({
      id: upload.file.id,
      image: true,
    });
    expect(attachmentLink('![x](https://example.com/tracker.png)')).toBeNull();
    expect(removeAttachmentMarkup(saved.body, upload.file.id)).toBe(note.body);
  });

  it('authenticates each chunk with account, file, order and count and rejects tampering without plaintext errors', async () => {
    const upload = await file();
    const cipher = migrationCipher(testRecoveryKey);
    const userId = randomUUID();
    const encryption = new AttachmentEncryption(cipher, userId, digest);
    const sealed = await encryption.encrypt(upload.file, upload.chunks);
    expect(
      joinAttachment(
        await encryption.decrypt(upload.file, sealed.manifest, sealed.chunks),
        upload.file.size,
      ),
    ).toEqual(upload.bytes);
    await expect(
      new AttachmentEncryption(cipher, randomUUID(), digest).decrypt(
        upload.file,
        sealed.manifest,
        sealed.chunks,
      ),
    ).rejects.toThrow('무결성');
    await expect(
      encryption.decrypt({ ...upload.file, id: randomUUID() }, sealed.manifest, sealed.chunks),
    ).rejects.toThrow('무결성');
    await expect(
      encryption.decrypt(upload.file, sealed.manifest, [...sealed.chunks].reverse()),
    ).rejects.toThrow('무결성');
    const tampered = [...sealed.chunks];
    tampered[0] = 'AAAA' + tampered[0]!.slice(4);
    await expect(encryption.decrypt(upload.file, sealed.manifest, tampered)).rejects.toThrow(
      '무결성',
    );
  });

  it('retries lost chunk responses with identical ciphertext, publishes after upload, and downloads on a second device', async () => {
    const { server, tokens, userId } = await setup();
    const local = await device();
    const upload = await file();
    const note = await local.store.attachFile(
      await local.store.save(blankNote(randomUUID())),
      upload.file,
      upload.chunks,
      0,
    );
    const client = connection(server, tokens.accessToken, local);
    const originalPut = client.api.putAttachmentChunk;
    const sent: string[] = [];
    let lose = true;
    client.api.putAttachmentChunk = async (...args) => {
      sent.push(args[2]);
      await originalPut(...args);
      if (lose) {
        lose = false;
        throw new Error('lost response');
      }
    };
    const pending = await local.store.pending();
    await expect(client.sync.sync()).rejects.toThrow('lost response');
    expect(server.notes.list(userId)).toEqual([]);
    expect(await local.store.pending()).toEqual(pending);
    await client.sync.sync();
    expect(sent[0]).toBe(sent[1]);
    const stored =
      JSON.stringify(server.db.sqlite.prepare('SELECT * FROM attachments').all()) +
      JSON.stringify(server.notes.list(userId));
    expect(stored).not.toContain(upload.file.name);
    expect(stored).not.toContain(upload.file.mime);
    const peer = await device();
    const peerClient = connection(server, tokens.accessToken, peer);
    await peerClient.sync.sync();
    expect((await peer.store.attachmentData(note.id, upload.file.id)).chunks).toBeNull();
    await peerClient.transfer.download(upload.file);
    expect(
      joinAttachment(
        (await peer.store.attachmentData(note.id, upload.file.id)).chunks!,
        upload.file.size,
      ),
    ).toEqual(upload.bytes);
    await peer.store.save({ ...(await peer.store.get(note.id))!, title: '다른 기기 수정' });
    await peerClient.sync.sync();
    expect(await peer.store.pending()).toEqual([]);
  });

  it('preserves file references and both versions in offline editing conflicts and enforces category access', async () => {
    const { server, tokens } = await setup();
    const local = await device();
    const peer = await device();
    const first = await file(randomBytes(10));
    const note = await local.store.attachFile(
      await local.store.save({ ...blankNote(randomUUID()), category: '보호' }),
      first.file,
      first.chunks,
      0,
    );
    const a = connection(server, tokens.accessToken, local);
    const b = connection(server, tokens.accessToken, peer);
    await a.sync.sync();
    await b.sync.sync();
    const second = await file(randomBytes(15));
    await local.store.attachFile((await local.store.get(note.id))!, second.file, second.chunks, 0);
    await peer.store.save({ ...(await peer.store.get(note.id))!, title: '오프라인 다른 수정' });
    await a.sync.sync();
    await b.sync.sync();
    const versions = await peer.store.list('notes');
    expect(versions).toHaveLength(2);
    expect(versions.some((value) => value.conflictOf === note.id)).toBe(true);
    expect(
      versions.flatMap((value) => value.attachments).some((value) => value.id === second.file.id),
    ).toBe(true);
    await local.store.authorizeCategoryManagement();
    await local.store.setCategoryProtection('보호', { locked: true, hidden: true });
    await expect(local.store.attachmentData(note.id, first.file.id)).rejects.toBeInstanceOf(
      CategoryAccessError,
    );
  });

  it('exports and imports complete attachments without rewriting Markdown and synchronizes independent blob copies safely', async () => {
    const { server, tokens } = await setup();
    const local = await device();
    const upload = await file(randomBytes(32));
    await local.store.attachFile(
      await local.store.save(blankNote(randomUUID())),
      upload.file,
      upload.chunks,
      0,
    );
    await connection(server, tokens.accessToken, local).sync.sync();
    const backup = (await local.store.exportBackup())!;
    const restored = await device();
    const plan = await restored.store.prepareBackupImport(JSON.stringify(backup));
    expect(plan.attachments).toBe(1);
    await restored.store.importBackup(plan);
    const notes = await restored.store.list('notes');
    expect(notes[0]!.body).toBe(backup.notes[0]!.body);
    expect(
      joinAttachment(
        (await restored.store.attachmentData(notes[0]!.id, upload.file.id)).chunks!,
        upload.file.size,
      ),
    ).toEqual(upload.bytes);
    await connection(server, tokens.accessToken, restored).sync.sync();
    expect(await restored.store.pending()).toEqual([]);
    const broken = { ...backup, attachments: [] };
    await expect(restored.store.prepareBackupImport(JSON.stringify(broken))).rejects.toThrow(
      '첨부파일 내용',
    );
  });

  it('restores a JSON backup after an interrupted staged upload without changing Markdown or original pending work', async () => {
    const { server, tokens } = await setup();
    const original = await device();
    const upload = await file();
    const note = await original.store.attachFile(
      await original.store.save(blankNote(randomUUID())),
      upload.file,
      upload.chunks,
      0,
    );
    const client = connection(server, tokens.accessToken, original);
    const put = client.api.putAttachmentChunk;
    client.api.putAttachmentChunk = async (...args) => {
      await put(...args);
      throw new Error('interrupted upload');
    };
    const pending = await original.store.pending();
    await expect(client.sync.sync()).rejects.toThrow('interrupted');
    const backup = (await original.store.exportBackup())!;
    const restored = await device();
    await restored.store.importBackup(
      await restored.store.prepareBackupImport(JSON.stringify(backup)),
    );
    const copy = (await restored.store.list('notes'))[0]!;
    expect(copy.body).toBe(note.body);
    expect(copy.attachments[0]!.id).toBe(upload.file.id);
    expect(copy.attachments[0]!.blobId).not.toBe(upload.file.id);
    await connection(server, tokens.accessToken, restored).sync.sync();
    expect(await restored.store.pending()).toEqual([]);
    expect(await original.store.pending()).toEqual(pending);
    expect(server.db.sqlite.prepare('SELECT COUNT(*) AS count FROM attachments').get()).toEqual({
      count: 2,
    });
    const secondBackup = (await restored.store.exportBackup())!;
    const again = await device();
    await again.store.importBackup(
      await again.store.prepareBackupImport(JSON.stringify(secondBackup)),
    );
    expect((await again.store.list('notes'))[0]!.body).toBe(note.body);
  });

  it('blocks other users, unfinished upload references, old v3 apps and quota overflow', async () => {
    const { server, tokens, userId } = await setup(100);
    const local = await device();
    const client = connection(server, tokens.accessToken, local);
    const upload = await file(randomBytes(50));
    const sealed = await client.encryption.encrypt(upload.file, upload.chunks);
    const witness = server.notes.checkpoint(userId);
    await client.api.stageAttachment(sealed.manifest, witness);
    await expect(client.api.commitAttachment(upload.file.id, witness)).rejects.toThrow('409');
    const note: Note = { ...blankNote(randomUUID()), attachments: [upload.file] };
    const encrypted = await new NoteEncryption(migrationCipher(testRecoveryKey), userId).encrypt(
      note,
    );
    const { revision: _revision, ...content } = encrypted;
    expect(_revision).toBe(0);
    await expect(
      client.request('/sync/v4/push', 'POST', {
        witness,
        operations: [
          { operationId: randomUUID(), clientId: randomUUID(), baseRevision: 0, note: content },
        ],
      }),
    ).rejects.toThrow('404');
    const otherFile = await file(randomBytes(50));
    await expect(
      client.api.stageAttachment(
        (await client.encryption.encrypt(otherFile.file, otherFile.chunks)).manifest,
        witness,
      ),
    ).rejects.toThrow('413');
    const otherId = await server.auth.createUser(
      'other-attachment@example.com',
      'test-other-attachment-password',
    );
    const other = (await server.auth.login(
      'other-attachment@example.com',
      'test-other-attachment-password',
    ))!;
    expect(other.userId).toBe(otherId);
    const response = await server.app.inject({
      url: `/attachments/v1/${upload.file.id}`,
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(response.statusCode).toBe(404);
    expect(
      (
        await server.app.inject({
          url: '/sync/v3/push',
          method: 'POST',
          headers: { authorization: `Bearer ${tokens.accessToken}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(426);
  });

  it('backs up ciphertext alongside a consistent DB snapshot and refuses incomplete ready blobs', async () => {
    const { server, tokens, directory, blobs, userId } = await setup();
    const local = await device();
    const upload = await file(randomBytes(64));
    await local.store.attachFile(
      await local.store.save(blankNote(randomUUID())),
      upload.file,
      upload.chunks,
      0,
    );
    await connection(server, tokens.accessToken, local).sync.sync();
    const target = join(directory, 'backup.db');
    await backupServerDatabase(join(directory, 'server.db'), target, blobs);
    expect(await verifyAttachmentBackup(target)).toEqual({ files: 1, legacy: false });
    const marker = JSON.parse(readFileSync(`${target}.attachments/complete.json`, 'utf8'));
    expect(marker.files).toHaveLength(1);
    const backed = readFileSync(join(`${target}.attachments`, marker.files[0].key));
    expect(await digest(backed)).toBe(marker.files[0].sha256);
    expect(backed.includes(Buffer.from(upload.bytes))).toBe(false);
    const manifest = server.attachments.getManifest(userId, upload.file.id);
    rmSync(join(directory, 'blobs', blobKey(userId, manifest, 0)));
    const failed = join(directory, 'incomplete.db');
    await expect(backupServerDatabase(join(directory, 'server.db'), failed, blobs)).rejects.toThrow(
      '완료',
    );
    expect(existsSync(`${failed}.attachments/complete.json`)).toBe(false);
  });

  it('uses conditional private S3 objects with owner-scoped keys and detects conflicts (mock SDK)', async () => {
    const objects = new Map<string, Uint8Array>();
    const send = vi.fn(async (command: PutObjectCommand | GetObjectCommand) => {
      const key = command.input.Key!;
      if (command instanceof PutObjectCommand) {
        expect(command.input.IfNoneMatch).toBe('*');
        expect(command.input.ContentType).toBe('application/octet-stream');
        expect(command.input).not.toHaveProperty('ACL');
        if (objects.has(key)) {
          throw { $metadata: { httpStatusCode: 412 } };
        }
        objects.set(key, new Uint8Array(command.input.Body as Uint8Array));
        return {};
      }
      if (!objects.has(key)) {
        throw { $metadata: { httpStatusCode: 404 } };
      }
      return { Body: { transformToByteArray: async () => objects.get(key)! } };
    });
    const store = new S3BlobStore(
      {
        bucket: 'private-test',
        region: 'us-east-1',
        endpoint: 'https://s3.example.com',
        prefix: 'memo',
      },
      { send } as unknown as S3Client,
    );
    const key = `${randomUUID()}/${randomUUID()}/0-${'a'.repeat(64)}.bin`;
    await store.put(key, new Uint8Array([1, 2]));
    await store.put(key, new Uint8Array([1, 2]));
    await expect(store.put(key, new Uint8Array([2, 3]))).rejects.toThrow('덮어쓸');
    expect(await store.get(key)).toEqual(new Uint8Array([1, 2]));
    expect([...objects.keys()][0]).toBe(`memo/${key}`);
    await expect(store.get('../outside')).rejects.toThrow('저장 키');
  });

  it('resizes without upscaling and retains image aspect ratio for the picker options', () => {
    expect(resizedDimensions(8000, 6000, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(resizedDimensions(3000, 9000, 1280)).toEqual({ width: 427, height: 1280 });
    expect(resizedDimensions(800, 600, 2560)).toEqual({ width: 800, height: 600 });
    expect(resizedDimensions(8000, 6000, null)).toEqual({ width: 8000, height: 6000 });
  });
});
