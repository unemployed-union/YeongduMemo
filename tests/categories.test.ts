import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { blankNote, categoryNameSchema, noteContentSchema, noteSchema } from '@yeongdu/shared';
import { NoteEncryption } from '@yeongdu/shared/src/e2ee';
import { AccessGate } from '@yeongdu/shared/src/lock';
import { migrationCipher } from '../apps/server/src/maintenance/e2ee-migration';
import { localDevice, testRecoveryKey } from './helpers';

let device: ReturnType<typeof localDevice>;
beforeEach(async () => {
  device = localDevice();
  await device.store.migrate();
});
afterEach(() => device.sqlite.close());

describe('note categories', () => {
  it('defaults legacy notes to uncategorized and normalizes names without changing Markdown', () => {
    const draft = { ...blankNote(randomUUID()), body: '# 원문\r\n\r\n* **보존**  ' };
    const legacy = noteContentSchema.omit({ category: true }).parse(draft);
    expect(noteSchema.parse({ ...legacy, revision: 0 }).category).toBeNull();
    expect(categoryNameSchema.parse('  업무  ')).toBe('업무');
    const parsed = noteSchema.parse({ ...draft, category: '  업무  ' });
    expect(parsed.category).toBe('업무');
    expect(parsed.body).toBe(draft.body);
    for (const invalid of ['', '   ', '가'.repeat(41), 123]) {
      expect(categoryNameSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('reads old database payloads and pending operations without rewriting their IDs', async () => {
    const note = await device.store.save({ ...blankNote(randomUUID()), title: '기존 메모' });
    const pending = (await device.store.pending())[0]!;
    device.sqlite.prepare("UPDATE notes SET payload = json_remove(payload, '$.category')").run();
    device.sqlite
      .prepare("UPDATE outbox SET payload = json_remove(payload, '$.note.category')")
      .run();

    expect((await device.store.get(note.id))?.category).toBeNull();
    expect(await device.store.list('notes', '', null)).toHaveLength(1);
    expect(await device.store.categories()).toEqual([]);
    const restored = (await device.store.pending())[0]!;
    expect(restored.operationId).toBe(pending.operationId);
    expect(restored.note.category).toBeNull();
    expect(device.sqlite.pragma('user_version', { simple: true })).toBe(3);
    const row = device.sqlite.prepare('SELECT payload FROM notes').get() as { payload: string };
    expect(JSON.parse(row.payload)).not.toHaveProperty('category');
  });

  it('combines categories with search, favorites, archive, trash and permanent deletion', async () => {
    const work = await device.store.save({
      ...blankNote(randomUUID()),
      title: '계획',
      category: ' 업무 ',
      favorite: true,
    });
    const personal = await device.store.save({
      ...blankNote(randomUUID()),
      title: '계획',
      category: '개인',
    });
    const uncategorized = await device.store.save({ ...blankNote(randomUUID()), title: '분류 전' });
    const archive = await device.store.save({
      ...blankNote(randomUUID()),
      category: '업무',
      archived: true,
    });
    const trash = await device.store.save({
      ...blankNote(randomUUID()),
      category: '휴지통 분류',
      deletedAt: new Date().toISOString(),
    });
    const purged = await device.store.save({
      ...blankNote(randomUUID()),
      category: '삭제된 분류',
      purged: true,
    });

    expect((await device.store.list('notes')).map((note) => note.id).sort()).toEqual(
      [work.id, personal.id, uncategorized.id].sort(),
    );
    expect((await device.store.list('notes', '계획', '업무')).map((note) => note.id)).toEqual([
      work.id,
    ]);
    expect(await device.store.list('notes', '분류 전', '업무')).toEqual([]);
    expect((await device.store.list('notes', '', null)).map((note) => note.id)).toEqual([
      uncategorized.id,
    ]);
    expect((await device.store.list('favorites', '', '업무')).map((note) => note.id)).toEqual([
      work.id,
    ]);
    expect((await device.store.list('archive', '', '업무')).map((note) => note.id)).toEqual([
      archive.id,
    ]);
    expect((await device.store.list('trash', '', '휴지통 분류')).map((note) => note.id)).toEqual([
      trash.id,
    ]);
    expect(await device.store.categories()).toEqual(['개인', '업무', '휴지통 분류']);
    expect((await device.store.get(purged.id))?.category).toBeNull();
    expect((await device.store.exportNotes()).find((note) => note.id === work.id)?.category).toBe(
      '업무',
    );
    await device.store.save({ ...personal, category: null });
    expect(await device.store.categories()).toEqual(['업무', '휴지통 분류']);
  });

  it('rolls back category changes with a failed outbox write and blocks locked category reads', async () => {
    const note = await device.store.save({
      ...blankNote(randomUUID()),
      category: '원래 분류',
      body: '본문 유지',
    });
    const pending = await device.store.pending();
    device.sqlite.exec(`CREATE TRIGGER reject_category_queue BEFORE INSERT ON outbox
      BEGIN SELECT RAISE(ABORT, 'category queue failed'); END;`);
    await expect(device.store.save({ ...note, category: '새 분류' })).rejects.toThrow(
      'category queue failed',
    );
    expect(await device.store.get(note.id)).toEqual(note);
    expect(await device.store.pending()).toEqual(pending);

    const gate = new AccessGate();
    const locked = localDevice(':memory:', gate.assertAccess);
    try {
      await locked.store.migrate();
      await expect(locked.store.categories()).rejects.toThrow('잠금');
      await expect(locked.store.list('notes', '', '원래 분류')).rejects.toThrow('잠금');
    } finally {
      locked.sqlite.close();
    }
  });

  it('decrypts pre-category ciphertext as uncategorized', async () => {
    const cipher = migrationCipher(testRecoveryKey);
    const userId = randomUUID();
    const encryption = new NoteEncryption(cipher, userId);
    const plain = blankNote(randomUUID());
    const encrypted = await encryption.encrypt(plain);
    const legacy = noteContentSchema.omit({ category: true }).parse(plain);
    const context = new TextEncoder().encode(
      JSON.stringify([
        'yeongdu-memo',
        1,
        userId,
        cipher.keyId,
        plain.id,
        false,
        encrypted.conflictId,
      ]),
    );
    const ciphertext = await cipher.seal(new TextEncoder().encode(JSON.stringify(legacy)), context);
    const decrypted = await encryption.decrypt({ ...encrypted, ciphertext });
    expect(decrypted.category).toBeNull();
    expect(decrypted.body).toBe(plain.body);
  });
});
