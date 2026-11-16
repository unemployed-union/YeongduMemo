import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { blankNote, type Note } from '@yeongdu/shared';
import { parseBackupText } from '@yeongdu/shared/src/backup';
import { CategoryAccessError } from '@yeongdu/shared/src/category-access';
import { SyncService } from '@yeongdu/shared/src/sync';
import { createApp } from '../apps/server/src/app';
import { decryptedServerNotes, localDevice, transport } from './helpers';

let device: ReturnType<typeof localDevice>;
const authenticate = vi.fn(async () => true);
const backup = (notes: unknown[]) =>
  JSON.stringify({
    format: 'yeongdu-memo',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes,
  });
beforeEach(async () => {
  authenticate.mockReset().mockResolvedValue(true);
  device = localDevice(':memory:', undefined, authenticate);
  await device.store.migrate();
});
afterEach(() => device.sqlite.close());
function rawNotes(): Note[] {
  return (device.sqlite.prepare('SELECT payload FROM notes').all() as { payload: string }[]).map(
    (row) => JSON.parse(row.payload),
  );
}

describe('JSON backup recovery', () => {
  it('validates the entire legacy export and preserves raw Markdown, trash and conflict relationships as fresh copies', async () => {
    const original = await device.store.save({ ...blankNote(randomUUID()), body: '기존 메모' });
    const oldPending = await device.store.pending();
    const source = {
      ...original,
      title: '  * 제목\r\n',
      body: '* 항목\r\n\r\n**원문**  \n',
      revision: 900,
      pinned: true,
      favorite: true,
    };
    const copy = {
      ...blankNote(randomUUID()),
      conflictOf: source.id,
      deletedAt: '2026-10-01T00:00:00.000Z',
      archived: true,
    };
    const purged = {
      ...blankNote(randomUUID()),
      purged: true,
      deletedAt: '2026-10-01T00:00:00.000Z',
    };
    const legacy = { ...source } as Partial<Note>;
    delete legacy.category;
    delete legacy.categoryProtection;
    const plan = await device.store.prepareBackupImport(backup([legacy, copy, purged]));
    expect(plan).toMatchObject({ imported: 2, trash: 1, existingIds: 1, skippedPurged: 1 });
    expect(rawNotes()).toHaveLength(1);
    await device.store.importBackup(plan);
    expect(await device.store.get(original.id)).toEqual(original);
    const imported = rawNotes().filter((note) => note.id !== original.id);
    const restored = imported.find((note) => note.title === source.title)!;
    expect(restored).toMatchObject({
      body: source.body,
      revision: 0,
      pinned: true,
      favorite: true,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    });
    expect(restored.id).not.toBe(source.id);
    expect(imported.find((note) => note.deletedAt)).toMatchObject({
      conflictOf: restored.id,
      archived: true,
    });
    const pending = await device.store.pending();
    expect(pending).toHaveLength(3);
    expect(pending.find((operation) => operation.note.id === original.id)).toEqual(oldPending[0]);
    expect(
      pending
        .filter((operation) => operation.note.id !== original.id)
        .every((operation) => operation.baseRevision === 0),
    ).toBe(true);
    await expect(device.store.importBackup(plan)).rejects.toThrow('만료');
  });

  it('rejects duplicate source IDs, malformed notes and unsupported formats without leaking contents or partial writes', async () => {
    const note = { ...blankNote(randomUUID()), body: 'sensitive-plaintext' };
    const invalid = [
      backup([note, note]),
      backup([note, { ...note, id: randomUUID(), body: 3 }]),
      backup([{ ...note, categoryProtection: { locked: true, hidden: false } }]),
      '{"body":"sensitive-plaintext"}',
      backup([note]).replace('"version":1', '"version":2'),
    ];
    for (const text of invalid) {
      await expect(device.store.prepareBackupImport(text)).rejects.toThrow();
      try {
        parseBackupText(text);
      } catch (error) {
        expect(String(error)).not.toContain('sensitive-plaintext');
      }
      expect(rawNotes()).toEqual([]);
      expect(await device.store.pending()).toEqual([]);
    }
  });

  it('authenticates protected imports, renames colliding categories and never weakens existing protection', async () => {
    const existing = await device.store.save({ ...blankNote(randomUUID()), category: '비밀' });
    await device.store.authorizeCategoryManagement();
    await device.store.setCategoryProtection('비밀', { locked: true, hidden: true });
    const originalPayload = device.sqlite
      .prepare('SELECT payload FROM notes WHERE id = ?')
      .get(existing.id);
    authenticate.mockClear();
    const source = { ...blankNote(randomUUID()), category: '비밀', body: '보호할 복원 사본' };
    const plan = await device.store.prepareBackupImport(
      backup([
        source,
        { ...source, id: randomUUID(), categoryProtection: { locked: true, hidden: false } },
      ]),
    );
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(plan).toMatchObject({ imported: 2, protected: 2, renamedCategories: 1 });
    await device.store.importBackup(plan);
    expect(
      device.sqlite.prepare('SELECT payload FROM notes WHERE id = ?').get(existing.id),
    ).toEqual(originalPayload);
    const restored = rawNotes().filter((note) => note.id !== existing.id);
    expect(
      restored.every(
        (note) =>
          note.category === '비밀 (복원)' &&
          note.categoryProtection.hidden &&
          note.categoryProtection.locked,
      ),
    ).toBe(true);
    await expect(device.store.get(restored[0]!.id)).rejects.toBeInstanceOf(CategoryAccessError);
    expect(await device.store.list('notes')).toEqual([]);
  });

  it('requires authentication for a new protected category and cancels without granting read access', async () => {
    const note = {
      ...blankNote(randomUUID()),
      category: '새 보호',
      categoryProtection: { locked: false, hidden: true },
    };
    authenticate.mockResolvedValueOnce(false);
    await expect(device.store.prepareBackupImport(backup([note]))).rejects.toThrow('인증을 취소');
    expect(rawNotes()).toEqual([]);
    const plan = await device.store.prepareBackupImport(backup([note]));
    device.store.relockCategories();
    await expect(device.store.importBackup(plan)).rejects.toThrow('만료');
    expect(rawNotes()).toEqual([]);
  });

  it('expires a preview when local IDs or category metadata change, and consumes canceled previews', async () => {
    const plan = await device.store.prepareBackupImport(backup([blankNote(randomUUID())]));
    await device.store.save(blankNote(randomUUID()));
    await expect(device.store.importBackup(plan)).rejects.toThrow('변경');
    expect(rawNotes()).toHaveLength(1);
    const next = await device.store.prepareBackupImport(backup([blankNote(randomUUID())]));
    device.store.discardBackupImport(next);
    await expect(device.store.importBackup(next)).rejects.toThrow('만료');
  });

  it('rolls back all notes and outbox changes if one queued write fails', async () => {
    await device.store.save(blankNote(randomUUID()));
    const beforeNotes = rawNotes();
    const beforePending = await device.store.pending();
    const plan = await device.store.prepareBackupImport(
      backup([blankNote(randomUUID()), blankNote(randomUUID())]),
    );
    device.sqlite.exec(
      `CREATE TRIGGER fail_import BEFORE INSERT ON outbox WHEN (SELECT COUNT(*) FROM outbox) >= 2 BEGIN SELECT RAISE(ABORT, 'test failure'); END;`,
    );
    await expect(device.store.importBackup(plan)).rejects.toThrow();
    expect(rawNotes()).toEqual(beforeNotes);
    expect(await device.store.pending()).toEqual(beforePending);
  });

  it('allows local recovery while rollback-blocked without clearing the cursor, block or old outbox', async () => {
    const note = { ...blankNote(randomUUID()), revision: 8 };
    await device.store.applyRemote([note], 8);
    await device.store.save({ ...note, body: '미전송 보존' });
    await device.store.blockSync('server_regressed');
    const metadata = device.sqlite.prepare('SELECT * FROM metadata ORDER BY key').all();
    const pending = await device.store.pending();
    const plan = await device.store.prepareBackupImport(backup([note]));
    await device.store.importBackup(plan);
    expect(device.sqlite.prepare('SELECT * FROM metadata ORDER BY key').all()).toEqual(metadata);
    expect(
      (await device.store.pending()).find((operation) => operation.note.id === note.id),
    ).toEqual(pending[0]);
    expect(await device.store.syncIssue()).toBe('server_regressed');
  });

  it('uses the regular encrypted synchronization path for restored copies', async () => {
    const server = await createApp();
    try {
      const userId = await server.auth.createUser('import@example.com', 'import-test-password');
      const tokens = (await server.auth.login('import@example.com', 'import-test-password'))!;
      const source = { ...blankNote(randomUUID()), body: '# 원문\r\n* 목록', revision: 456 };
      await device.store.importBackup(await device.store.prepareBackupImport(backup([source])));
      await new SyncService(
        device.store.synchronization,
        transport(server, tokens.accessToken, device.store),
      ).sync();
      const notes = await decryptedServerNotes(server, userId);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ body: source.body, revision: 1 });
      expect(notes[0]!.id).not.toBe(source.id);
      expect(await device.store.pending()).toEqual([]);
      expect(JSON.stringify(server.notes.list(userId))).not.toContain(source.body);
    } finally {
      await server.app.close();
    }
  });
});
