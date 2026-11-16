import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankNote, type Operation, type Tokens } from '@yeongdu/shared';
import { createApp } from '../apps/server/src/app';
import {
  encryptedContentSchema,
  NoteEncryption,
  type EncryptedOperation,
} from '@yeongdu/shared/src/e2ee';
import { migrationCipher } from '../apps/server/src/maintenance/e2ee-migration';
import { testRecoveryKey } from './helpers';

let server: Awaited<ReturnType<typeof createApp>>;
let time: number;
let tokens: Tokens;
let encryption: NoteEncryption;
beforeEach(async () => {
  time = Date.now();
  server = await createApp({ now: () => time });
  await server.auth.createUser('owner@example.com', 'test-password-only-123');
  tokens = (await server.auth.login('owner@example.com', 'test-password-only-123'))!;
  const cipher = migrationCipher(testRecoveryKey);
  encryption = new NoteEncryption(cipher, tokens.userId);
  server.notes.registerKey(tokens.userId, cipher.keyId);
});
afterEach(async () => {
  await server.app.close();
});
const headers = () => ({ authorization: `Bearer ${tokens.accessToken}` });
const operation = (): Operation => ({
  operationId: randomUUID(),
  clientId: randomUUID(),
  baseRevision: 0,
  note: { ...blankNote(randomUUID()), title: '비공개', body: '원문 보존' },
});
async function encryptOperation(op: Operation, codec = encryption): Promise<EncryptedOperation> {
  const encrypted = await codec.encrypt({ ...op.note, revision: op.baseRevision });
  const note = encryptedContentSchema.parse({
    id: encrypted.id,
    sourceId: encrypted.sourceId,
    conflictId: encrypted.conflictId,
    conflictOf: encrypted.conflictOf,
    version: encrypted.version,
    keyId: encrypted.keyId,
    purged: encrypted.purged,
    ciphertext: encrypted.ciphertext,
  });
  return { ...op, note };
}

describe('authentication and API boundaries', () => {
  it('validates login, denies unauthenticated requests and public signup, and hashes passwords', async () => {
    expect((await server.app.inject('/health')).statusCode).toBe(200);
    expect((await server.app.inject('/notes')).statusCode).toBe(401);
    expect((await server.app.inject({ url: '/auth/register', method: 'POST' })).statusCode).toBe(
      404,
    );
    expect(
      (
        await server.app.inject({
          url: '/auth/login',
          method: 'POST',
          payload: { email: 'bad', password: '' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await server.app.inject({
          url: '/auth/login',
          method: 'POST',
          payload: { email: 'owner@example.com', password: 'wrong' },
        })
      ).statusCode,
    ).toBe(401);
    const row = server.db.sqlite.prepare('SELECT password_hash FROM users').get() as {
      password_hash: string;
    };
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    const login = await server.app.inject({
      url: '/auth/login',
      method: 'POST',
      payload: { email: 'owner@example.com', password: 'test-password-only-123' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['cache-control']).toBe('no-store');
  });
  it('expires access, rotates refresh tokens, detects replay, and revokes the session family', async () => {
    time += 16 * 60_000;
    expect((await server.app.inject({ url: '/notes', headers: headers() })).statusCode).toBe(401);
    const rotated = server.auth.refresh(tokens.refreshToken)!;
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    expect(server.auth.authenticate(rotated.accessToken)).toBe(tokens.userId);
    expect(server.auth.refresh(tokens.refreshToken)).toBeNull();
    expect(server.auth.authenticate(rotated.accessToken)).toBeNull();
    expect(server.auth.refresh(rotated.refreshToken)).toBeNull();
  });
  it('logs out, bounds login attempts, rejects malformed operations', async () => {
    expect(
      (
        await server.app.inject({
          url: '/sync/v4/push',
          method: 'POST',
          headers: headers(),
          payload: { operations: [{}] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await server.app.inject({
          url: '/sync/v4/pull',
          method: 'POST',
          payload: { cursor: -1, witness: server.notes.checkpoint(tokens.userId) },
          headers: headers(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await server.app.inject({ url: '/auth/logout', method: 'POST', headers: headers() }))
        .statusCode,
    ).toBe(204);
    expect(server.auth.authenticate(tokens.accessToken)).toBeNull();
    for (let index = 0; index < 8; index++)
      await server.app.inject({
        url: '/auth/login',
        method: 'POST',
        payload: { email: 'nobody@example.com', password: 'wrong' },
      });
    expect(
      (
        await server.app.inject({
          url: '/auth/login',
          method: 'POST',
          payload: { email: 'nobody@example.com', password: 'wrong' },
        })
      ).statusCode,
    ).toBe(429);
  });
});

describe('revision protocol', () => {
  it('isolates accounts, replays identical operations, rejects ID reuse and preserves conflict versions', async () => {
    const plain = operation();
    const op = await encryptOperation(plain);
    const first = server.notes.push(tokens.userId, [op])[0]!;
    expect(server.notes.push(tokens.userId, [op])[0]).toEqual(first);
    const conflicting = await encryptOperation({
      ...plain,
      operationId: randomUUID(),
      note: { ...plain.note, body: '오프라인 변경', updatedAt: '2099-01-01T00:00:00.000Z' },
    });
    const conflict = server.notes.push(tokens.userId, [conflicting])[0]!;
    expect((await encryption.decrypt(conflict.canonical)).body).toBe('원문 보존');
    expect((await encryption.decrypt(conflict.conflict!)).body).toBe('오프라인 변경');
    expect(conflict.conflict!.revision).toBeGreaterThan(conflict.canonical.revision);
    expect(conflict.conflict).not.toHaveProperty('updatedAt');
    expect(server.notes.list(tokens.userId)).toHaveLength(2);
    const userB = await server.auth.createUser('other@example.com', 'other-test-password-123');
    expect(server.notes.list(userB)).toEqual([]);
    expect(server.notes.pull(userB, 0).notes).toEqual([]);
    const invalid = await server.app.inject({
      url: '/sync/v4/push',
      method: 'POST',
      headers: headers(),
      payload: {
        witness: server.notes.checkpoint(tokens.userId),
        operations: [await encryptOperation({ ...plain, note: { ...plain.note, body: 'reused' } })],
      },
    });
    expect(invalid.statusCode).toBe(409);
  });
  it('paginates change cursors and keeps deletion tombstones', async () => {
    const ops = await Promise.all(
      Array.from({ length: 102 }, operation).map((op) => encryptOperation(op)),
    );
    server.notes.push(tokens.userId, ops);
    const page = server.notes.pull(tokens.userId, 0);
    expect(page.notes).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    const end = server.notes.pull(tokens.userId, page.cursor);
    expect(end.notes).toHaveLength(2);
    expect(end.hasMore).toBe(false);
    const current = server.notes.list(tokens.userId)[0]!;
    server.notes.push(tokens.userId, [
      await encryptOperation({
        operationId: randomUUID(),
        clientId: randomUUID(),
        baseRevision: current.revision,
        note: {
          ...(await encryption.decrypt(current)),
          title: '',
          body: '',
          deletedAt: new Date().toISOString(),
          purged: true,
        },
      }),
    ]);
    const tombstone = server.notes.pull(tokens.userId, end.cursor).notes[0]!;
    expect(tombstone.purged).toBe(true);
    expect((await encryption.decrypt(tombstone)).body).toBe('');
    const historical = server.notes
      .pull(tokens.userId, 0, 200)
      .notes.filter((note) => note.id === current.id);
    const decrypted = await Promise.all(historical.map((note) => encryption.decrypt(note)));
    expect(decrypted.every((note) => note.body === '' && note.title === '')).toBe(true);
  });
  it('preserves users, sessions, and notes across server restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yeongdu-server-'));
    const path = join(dir, 'memo.db');
    let persistent = await createApp({ databasePath: path });
    try {
      const id = await persistent.auth.createUser(
        'persist@example.com',
        'persist-test-password-123',
      );
      const session = (await persistent.auth.login(
        'persist@example.com',
        'persist-test-password-123',
      ))!;
      const cipher = migrationCipher(testRecoveryKey);
      const codec = new NoteEncryption(cipher, id);
      persistent.notes.registerKey(id, cipher.keyId);
      const op = await encryptOperation(operation(), codec);
      persistent.notes.push(id, [op]);
      await persistent.app.close();
      persistent = await createApp({ databasePath: path });
      expect(persistent.auth.authenticate(session.accessToken)).toBe(id);
      expect((await codec.decrypt(persistent.notes.list(id)[0]!)).body).toBe('원문 보존');
      expect(persistent.notes.push(id, [op])).toHaveLength(1);
    } finally {
      await persistent.app.close();
      rmSync(dir, { recursive: true });
    }
  });
});
