import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID, webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankNote } from '@yeongdu/shared';
import {
  encryptedOperationSchema,
  EncryptedTransport,
  NoteEncryption,
  type EncryptedOperation,
} from '@yeongdu/shared/src/e2ee';
import { SyncService } from '@yeongdu/shared/src/sync';
import { createApp } from '../apps/server/src/app';
import {
  migrateLegacyAccount,
  migrationCipher,
} from '../apps/server/src/maintenance/e2ee-migration';
import { localDevice, testRecoveryKey, transport } from './helpers';

let server: Awaited<ReturnType<typeof createApp>>;
let device: ReturnType<typeof localDevice>;
let userId: string;
let accessToken: string;
let encryption: NoteEncryption;
beforeEach(async () => {
  server = await createApp();
  userId = await server.auth.createUser('e2ee@example.com', 'test-e2ee-password-123');
  accessToken = (await server.auth.login('e2ee@example.com', 'test-e2ee-password-123'))!
    .accessToken;
  device = localDevice();
  await device.store.migrate();
  encryption = new NoteEncryption(migrationCipher(testRecoveryKey), userId);
});
afterEach(async () => {
  device.sqlite.close();
  await server.app.close();
});

describe('end-to-end encrypted synchronization', () => {
  it('upgrades a v1 local database without changing notes or pending operation IDs', async () => {
    const note = await device.store.save({ ...blankNote(randomUUID()), body: '기존 로컬 메모' });
    const pending = await device.store.pending();
    device.sqlite.exec(
      'DROP TABLE attachment_uploads; DROP TABLE attachment_chunks; DROP TABLE local_attachments; DROP TABLE encrypted_outbox; PRAGMA user_version = 1;',
    );
    await device.store.migrate();
    expect(await device.store.get(note.id)).toEqual(note);
    expect(await device.store.pending()).toEqual(pending);
    await new SyncService(device.store, transport(server, accessToken, device.store)).sync();
    expect((await encryption.decrypt(server.notes.list(userId)[0]!)).body).toBe(note.body);
  });

  it('keeps plaintext and keys out of HTTP responses, notes, changes, and receipts', async () => {
    const note = await device.store.save({
      ...blankNote(randomUUID()),
      title: '비공개 제목',
      body: 'TOP SECRET 원문\r\n**보존**',
      category: '비공개 카테고리',
      favorite: true,
    });
    await new SyncService(device.store, transport(server, accessToken, device.store)).sync();
    const response = await server.app.inject({
      url: '/notes',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const stored = [response.body];
    for (const table of ['notes', 'changes', 'receipts']) {
      stored.push(JSON.stringify(server.db.sqlite.prepare(`SELECT * FROM ${table}`).all()));
    }
    for (const text of stored) {
      expect(text).not.toContain(note.title);
      expect(text).not.toContain('TOP SECRET');
      expect(text).not.toContain(testRecoveryKey);
      expect(text).not.toContain('"favorite"');
      expect(text).not.toContain('비공개 카테고리');
      expect(text).not.toContain('"category"');
    }
    expect((await encryption.decrypt(response.json()[0])).body).toBe(note.body);
    expect((await encryption.decrypt(response.json()[0])).category).toBe(note.category);
  });

  it('rejects wrong keys, account/note substitution, tampering and forged conflict IDs', async () => {
    const note = await encryption.encrypt({ ...blankNote(randomUUID()), body: 'secret' });
    await expect(
      new NoteEncryption(migrationCipher('b8'.repeat(32)), userId).decrypt(note),
    ).rejects.toThrow('복호화');
    await expect(
      new NoteEncryption(migrationCipher(testRecoveryKey), randomUUID()).decrypt(note),
    ).rejects.toThrow('복호화');
    for (const changed of [
      {
        ...note,
        ciphertext: `${note.ciphertext[0] === 'A' ? 'B' : 'A'}${note.ciphertext.slice(1)}`,
      },
      { ...note, sourceId: randomUUID() },
      { ...note, purged: true },
      { ...note, id: randomUUID(), conflictOf: note.sourceId },
      { ...note, conflictId: randomUUID() },
    ]) {
      await expect(encryption.decrypt(changed)).rejects.toThrow('복호화');
    }
    const conflict = { ...note, id: note.conflictId, conflictOf: note.id };
    expect((await encryption.decrypt(conflict)).body).toBe('secret');
  });

  it('uses fresh nonces and interoperates with WebCrypto AES-GCM', async () => {
    const plain = { ...blankNote(randomUUID()), body: '한글 😀\u0000\r\n' };
    const one = await encryption.encrypt(plain);
    const two = await encryption.encrypt(plain);
    expect(one.ciphertext).not.toBe(two.ciphertext);
    const combined = Buffer.from(one.ciphertext, 'base64');
    const key = await webcrypto.subtle.importKey(
      'raw',
      Buffer.from(testRecoveryKey, 'hex'),
      'AES-GCM',
      false,
      ['decrypt'],
    );
    const additionalData = Buffer.from(
      JSON.stringify(['yeongdu-memo', 1, userId, one.keyId, plain.id, false, one.conflictId]),
    );
    const decoded = await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: combined.subarray(0, 12), additionalData, tagLength: 128 },
      key,
      combined.subarray(12),
    );
    expect(JSON.parse(Buffer.from(decoded).toString('utf8')).body).toBe(plain.body);
  });

  it('retains the outbox and cursor when a remote page fails authentication', async () => {
    const note = await encryption.encrypt(blankNote(randomUUID()));
    const connection = new EncryptedTransport(
      device.store,
      {
        checkpoint: (context) => Promise.resolve(server.notes.verifyCheckpoint(userId, context)),
        async push() {
          throw new Error('unexpected push');
        },
        async pull() {
          return {
            notes: [note, { ...note, purged: true }],
            cursor: 42,
            hasMore: false,
            checkpoint: server.notes.checkpoint(userId),
          };
        },
      },
      encryption,
    );
    await expect(new SyncService(device.store, connection).sync()).rejects.toThrow('복호화');
    expect(await device.store.cursor()).toBe(0);
    expect(await device.store.get(note.id)).toBeNull();
  });

  it('reuses persisted ciphertext after a lost response and local DB reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'yeongdu-e2ee-retry-'));
    const path = join(directory, 'local.db');
    let persistent = localDevice(path);
    let sent: EncryptedOperation | undefined;
    try {
      await persistent.store.migrate();
      await persistent.store.save({ ...blankNote(randomUUID()), body: 'restart retry' });
      const cipher = migrationCipher(testRecoveryKey);
      server.notes.registerKey(userId, cipher.keyId);
      const lost = new EncryptedTransport(
        persistent.store,
        {
          checkpoint: (context) => Promise.resolve(server.notes.verifyCheckpoint(userId, context)),
          async push(operations, witness) {
            sent = operations[0]!;
            server.notes.guardedPush(userId, operations, witness);
            throw new Error('lost');
          },
          async pull(cursor, witness) {
            return server.notes.guardedPull(userId, cursor, witness);
          },
        },
        encryption,
      );
      await expect(new SyncService(persistent.store, lost).sync()).rejects.toThrow('lost');
      persistent.sqlite.close();
      persistent = localDevice(path);
      await persistent.store.migrate();
      const cached = persistent.sqlite.prepare('SELECT payload FROM encrypted_outbox').get() as {
        payload: string;
      };
      expect(encryptedOperationSchema.parse(JSON.parse(cached.payload))).toEqual(sent);
      await new SyncService(
        persistent.store,
        transport(server, accessToken, persistent.store),
      ).sync();
      expect(server.notes.list(userId)).toHaveLength(1);
      expect(await persistent.store.pending()).toHaveLength(0);
      expect(persistent.sqlite.prepare('SELECT * FROM encrypted_outbox').all()).toEqual([]);
    } finally {
      persistent.sqlite.close();
      rmSync(directory, { recursive: true });
    }
  });

  it('rejects legacy uploads and plaintext fields, and makes account key registration immutable', async () => {
    const headers = { authorization: `Bearer ${accessToken}` };
    expect(
      (
        await server.app.inject({
          url: '/sync/push',
          method: 'POST',
          headers,
          payload: { operations: [] },
        })
      ).statusCode,
    ).toBe(426);
    const cipher = migrationCipher(testRecoveryKey);
    const register = (keyId: string) =>
      server.app.inject({
        url: '/e2ee/key',
        method: 'PUT',
        headers,
        payload: { version: 1, keyId },
      });
    expect((await register(cipher.keyId)).statusCode).toBe(200);
    expect((await register(cipher.keyId)).statusCode).toBe(200);
    expect((await register(migrationCipher('b8'.repeat(32)).keyId)).statusCode).toBe(409);
    await device.store.save(blankNote(randomUUID()));
    let payload: EncryptedOperation | undefined;
    const capture = new EncryptedTransport(
      device.store,
      {
        checkpoint: (context) => Promise.resolve(server.notes.verifyCheckpoint(userId, context)),
        async push(operations) {
          payload = operations[0];
          throw new Error('captured');
        },
        async pull() {
          throw new Error('unexpected');
        },
      },
      encryption,
    );
    await expect(new SyncService(device.store, capture).sync()).rejects.toThrow('captured');
    const response = await server.app.inject({
      url: '/sync/v4/push',
      method: 'POST',
      headers,
      payload: {
        witness: server.notes.checkpoint(userId),
        operations: [{ ...payload!, note: { ...payload!.note, body: 'plaintext' } }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(server.notes.list(userId)).toEqual([]);
  });

  it('encrypts maximum-sized escaped content without losing the original string', async () => {
    const note = { ...blankNote(randomUUID()), body: '\u0000'.repeat(1_000_000) };
    await device.store.save(note);
    await new SyncService(device.store, transport(server, accessToken, device.store)).sync();
    expect((await encryption.decrypt(server.notes.list(userId)[0]!)).body).toBe(note.body);
  });
});

describe('legacy database conversion', () => {
  it('backs up plaintext first, preserves revisions and history, and removes legacy receipts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'yeongdu-e2ee-migration-'));
    const path = join(directory, 'memo.db');
    const persistent = await createApp({ databasePath: path });
    let backup: Database.Database | undefined;
    try {
      const id = await persistent.auth.createUser('legacy@example.com', 'legacy-password-123');
      const note = { ...blankNote(randomUUID()), body: 'legacy plaintext marker', revision: 7 };
      persistent.db.sqlite
        .prepare('INSERT INTO notes VALUES (?, ?, ?, ?)')
        .run(id, note.id, 7, JSON.stringify(note));
      persistent.db.sqlite
        .prepare('INSERT INTO changes(seq, user_id, payload) VALUES (?, ?, ?)')
        .run(7, id, JSON.stringify(note));
      persistent.db.sqlite
        .prepare('INSERT INTO receipts VALUES (?, ?, ?, ?)')
        .run(id, randomUUID(), 'old-hash', JSON.stringify({ canonical: note }));
      expect(() => persistent.notes.list(id)).toThrow('평문');
      expect(() =>
        persistent.notes.registerKey(id, migrationCipher(testRecoveryKey).keyId),
      ).toThrow('평문');
      const backupPath = await migrateLegacyAccount(
        persistent.db,
        'legacy@example.com',
        testRecoveryKey,
        path,
      );
      backup = new Database(backupPath, { readonly: true });
      expect(JSON.stringify(backup.prepare('SELECT * FROM notes').all())).toContain(note.body);
      const codec = new NoteEncryption(migrationCipher(testRecoveryKey), id);
      expect(await codec.decrypt(persistent.notes.list(id)[0]!)).toEqual(note);
      expect(persistent.notes.pull(id, 0).cursor).toBe(7);
      expect(persistent.db.sqlite.prepare('SELECT * FROM receipts').all()).toEqual([]);
      expect(readFileSync(path).includes(Buffer.from(note.body))).toBe(false);
      await expect(
        migrateLegacyAccount(persistent.db, 'legacy@example.com', 'b8'.repeat(32), path),
      ).rejects.toThrow('이미');
    } finally {
      backup?.close();
      await persistent.app.close();
      rmSync(directory, { recursive: true });
    }
  });

  it('rolls back partially converted records when legacy data is invalid', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'yeongdu-e2ee-rollback-'));
    try {
      const note = { ...blankNote(randomUUID()), body: 'keep me', revision: 1 };
      server.db.sqlite
        .prepare('INSERT INTO notes VALUES (?, ?, ?, ?)')
        .run(userId, note.id, 1, JSON.stringify(note));
      server.db.sqlite
        .prepare('INSERT INTO changes(user_id, payload) VALUES (?, ?)')
        .run(userId, '{}');
      await expect(
        migrateLegacyAccount(
          server.db,
          'e2ee@example.com',
          testRecoveryKey,
          join(directory, 'backup'),
        ),
      ).rejects.toThrow('취소');
      expect(server.notes.key(userId)).toBeNull();
      const row = server.db.sqlite
        .prepare('SELECT payload FROM notes WHERE user_id = ?')
        .get(userId) as { payload: string };
      expect(JSON.parse(row.payload)).toEqual(note);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
