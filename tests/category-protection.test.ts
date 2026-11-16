import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { blankNote, noteContentSchema, noteSchema } from '@yeongdu/shared';
import { CategoryAccess, CategoryAccessError } from '@yeongdu/shared/src/category-access';
import { LocalStore } from '@yeongdu/shared/src/local-store';
import { SyncService } from '@yeongdu/shared/src/sync';
import { createApp } from '../apps/server/src/app';
import { localDevice, transport } from './helpers';

let device: ReturnType<typeof localDevice>;
const authenticate = vi.fn(async () => true);
beforeEach(async () => {
  authenticate.mockReset().mockResolvedValue(true);
  device = localDevice(':memory:', undefined, authenticate);
  await device.store.migrate();
});
afterEach(() => device.sqlite.close());

async function protect(name: string, locked: boolean, hidden: boolean) {
  expect(await device.store.authorizeCategoryManagement()).toBe(true);
  await device.store.setCategoryProtection(name, { locked, hidden });
}

describe('category protection boundaries', () => {
  it('fails closed on malformed protection instead of treating it as a legacy public note', async () => {
    const note = await device.store.save({ ...blankNote(randomUUID()), category: '손상 확인' });
    device.sqlite
      .prepare(
        "UPDATE notes SET payload = json_set(payload, '$.categoryProtection', NULL) WHERE id = ?",
      )
      .run(note.id);
    await expect(device.store.get(note.id)).rejects.toThrow();
    await expect(device.store.list('notes')).rejects.toThrow();
    await expect(device.store.categories()).rejects.toThrow();
  });

  it('revokes an existing grant when a public note moves into an already protected category remotely', async () => {
    await device.store.save({ ...blankNote(randomUUID()), category: '기존 보호' });
    const publicNote = await device.store.save({
      ...blankNote(randomUUID()),
      body: '분류 이동 전',
    });
    await protect('기존 보호', true, false);
    await device.store.unlockCategory('기존 보호');
    const before = device.store.categoryAccessVersion();
    device.sqlite.prepare('DELETE FROM outbox WHERE note_id = ?').run(publicNote.id);
    await device.store.applyRemote([{ ...publicNote, category: '기존 보호', revision: 1 }], 1);
    expect(device.store.categoryAccessVersion()).toBeGreaterThan(before);
    expect(await device.store.canAccessCategory('기존 보호')).toBe(false);
    await expect(device.store.get(publicNote.id)).rejects.toBeInstanceOf(CategoryAccessError);
  });

  it('keeps legacy notes public and ignores forged protection in a UI draft', async () => {
    const legacy = noteContentSchema
      .omit({ categoryProtection: true })
      .parse(blankNote(randomUUID()));
    expect(noteSchema.parse({ ...legacy, revision: 0 }).categoryProtection).toEqual({
      locked: false,
      hidden: false,
    });
    const note = await device.store.save({
      ...blankNote(randomUUID()),
      category: '업무',
      categoryProtection: { locked: true, hidden: true },
    });
    expect(note.categoryProtection).toEqual({ locked: false, hidden: false });
    expect((await device.store.list('notes'))[0]?.id).toBe(note.id);
  });

  it('excludes hidden and locked content from every listing and blocks direct ID, move, purge, outbox and export bypasses', async () => {
    const secret = await device.store.save({
      ...blankNote(randomUUID()),
      category: '비밀 분류',
      title: '숨길 제목',
      body: 'needle',
      favorite: true,
    });
    const locked = await device.store.save({
      ...blankNote(randomUUID()),
      category: '잠긴 분류',
      body: 'needle',
    });
    const normal = await device.store.save({ ...blankNote(randomUUID()), body: '공개' });
    await protect('비밀 분류', false, true);
    await protect('잠긴 분류', true, false);

    expect(await device.store.categories()).toEqual(['잠긴 분류']);
    expect(await device.store.categoryStatuses()).toEqual([
      { name: '잠긴 분류', locked: true, hidden: false, unlocked: false },
    ]);
    expect((await device.store.list('notes')).map((note) => note.id)).toEqual([normal.id]);
    for (const filter of ['notes', 'favorites', 'archive', 'trash'] as const) {
      expect(await device.store.list(filter, 'needle')).toEqual([]);
      expect(await device.store.list(filter, '', '비밀 분류')).toEqual([]);
    }
    await expect(device.store.get(secret.id)).rejects.toBeInstanceOf(CategoryAccessError);
    await expect(device.store.get(locked.id)).rejects.toBeInstanceOf(CategoryAccessError);
    await expect(device.store.save({ ...secret, category: null })).rejects.toBeInstanceOf(
      CategoryAccessError,
    );
    await expect(device.store.save({ ...secret, purged: true })).rejects.toBeInstanceOf(
      CategoryAccessError,
    );
    await expect(
      device.store.save({ ...blankNote(randomUUID()), category: '잠긴 분류' }),
    ).rejects.toBeInstanceOf(CategoryAccessError);
    await expect(device.store.pending()).rejects.toBeInstanceOf(CategoryAccessError);
    await expect(device.store.exportNotes()).rejects.toBeInstanceOf(CategoryAccessError);
    device.store.endCategoryManagement();
    await expect(device.store.categorySettings()).rejects.toBeInstanceOf(CategoryAccessError);
  });

  it('opens only the authenticated hidden category, inherits its protection and relocks a new repository instance', async () => {
    const one = await device.store.save({
      ...blankNote(randomUUID()),
      category: '비밀 하나',
      favorite: true,
    });
    const two = await device.store.save({ ...blankNote(randomUUID()), category: '비밀 둘' });
    await protect('비밀 하나', true, true);
    await protect('비밀 둘', false, true);
    expect(await device.store.unlockNoteCategory(one.id)).toBe(true);
    expect((await device.store.get(one.id))?.id).toBe(one.id);
    await expect(device.store.get(two.id)).rejects.toBeInstanceOf(CategoryAccessError);
    expect(await device.store.categories()).toEqual(['비밀 하나']);
    expect(await device.store.list('notes')).toEqual([]);
    expect((await device.store.list('favorites', '', '비밀 하나')).map((note) => note.id)).toEqual([
      one.id,
    ]);
    const added = await device.store.save({ ...blankNote(randomUUID()), category: '비밀 하나' });
    expect(added.categoryProtection).toEqual({ locked: true, hidden: true });

    const restarted = new LocalStore(
      device.adapter,
      randomUUID,
      randomUUID(),
      () => undefined,
      authenticate,
    );
    await expect(restarted.get(one.id)).rejects.toBeInstanceOf(CategoryAccessError);
    device.store.relockCategories();
    expect(await device.store.categories()).toEqual([]);
    await expect(device.store.get(one.id)).rejects.toBeInstanceOf(CategoryAccessError);
  });

  it('does not grant access on cancellation, unavailable authentication, or a late authentication result', async () => {
    const note = await device.store.save({ ...blankNote(randomUUID()), category: '보호' });
    await protect('보호', true, false);
    device.store.relockCategories();
    authenticate.mockResolvedValue(false);
    expect(await device.store.unlockCategory('보호')).toBe(false);
    expect(await device.store.authorizeCategoryManagement()).toBe(false);
    await expect(
      device.store.setCategoryProtection('보호', { locked: false, hidden: false }),
    ).rejects.toBeInstanceOf(CategoryAccessError);
    await expect(device.store.get(note.id)).rejects.toBeInstanceOf(CategoryAccessError);
    authenticate.mockRejectedValueOnce(new Error('기기 암호 없음'));
    await expect(device.store.unlockCategory('보호')).rejects.toThrow('기기 암호 없음');

    let resolve!: (success: boolean) => void;
    const access = new CategoryAccess(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
      () => undefined,
    );
    const pending = access.unlock('보호');
    access.reset();
    resolve(true);
    await expect(pending).rejects.toBeInstanceOf(CategoryAccessError);
    expect(access.canRead('보호', new Map([['보호', { locked: true, hidden: false }]]))).toBe(
      false,
    );
  });

  it('requires a separate export authentication without leaving categories unlocked', async () => {
    const note = await device.store.save({ ...blankNote(randomUUID()), category: '내보내기 보호' });
    await protect('내보내기 보호', true, true);
    authenticate.mockResolvedValue(false);
    expect(await device.store.exportAllNotes()).toBeNull();
    authenticate.mockResolvedValue(true);
    expect((await device.store.exportAllNotes())?.map((item) => item.id)).toEqual([note.id]);
    await expect(device.store.get(note.id)).rejects.toBeInstanceOf(CategoryAccessError);
    expect(await device.store.categories()).toEqual([]);
  });

  it('commits all member protection and outbox changes atomically and handles reserved object names', async () => {
    const first = await device.store.save({
      ...blankNote(randomUUID()),
      category: '__proto__',
      body: 'A',
    });
    const second = await device.store.save({
      ...blankNote(randomUUID()),
      category: '__proto__',
      body: 'B',
    });
    const before = await device.store.pending();
    await device.store.authorizeCategoryManagement();
    device.sqlite.exec(`CREATE TRIGGER reject_protection BEFORE INSERT ON outbox
      WHEN NEW.note_id = '${second.id}' BEGIN SELECT RAISE(ABORT, 'queue failed'); END;`);
    await expect(
      device.store.setCategoryProtection('__proto__', { locked: true, hidden: true }),
    ).rejects.toThrow('queue failed');
    expect(await device.store.get(first.id)).toEqual(first);
    expect(await device.store.get(second.id)).toEqual(second);
    expect(await device.store.pending()).toEqual(before);
    device.sqlite.exec('DROP TRIGGER reject_protection');
    await protect('__proto__', true, true);
    expect(await device.store.categories()).toEqual([]);
    await expect(device.store.get(first.id)).rejects.toBeInstanceOf(CategoryAccessError);
    const operations = await device.store.synchronization.pending();
    expect(operations).toHaveLength(2);
    expect(operations.every((operation) => operation.note.categoryProtection.hidden)).toBe(true);
  });

  it('does not return an in-flight private read after permissions are revoked', async () => {
    const note = await device.store.save({ ...blankNote(randomUUID()), category: '비공개' });
    await protect('비공개', true, false);
    await device.store.unlockCategory('비공개');
    const original = device.adapter.getFirstAsync.bind(device.adapter);
    let entered!: () => void;
    let release!: () => void;
    const reading = new Promise<void>((done) => {
      entered = done;
    });
    const blocked = new Promise<void>((done) => {
      release = done;
    });
    device.adapter.getFirstAsync = async <T>(
      sql: string,
      ...params: (string | number | null)[]
    ) => {
      const result = await original<T>(sql, ...params);
      if (sql.includes('SELECT payload FROM notes WHERE id')) {
        entered();
        await blocked;
      }
      return result;
    };
    const pending = device.store.get(note.id);
    await reading;
    device.store.relockCategories();
    release();
    await expect(pending).rejects.toBeInstanceOf(CategoryAccessError);
  });
});

describe('encrypted category protection synchronization', () => {
  it('syncs protection, requires each device to authenticate, and syncs disabling protection', async () => {
    const server = await createApp();
    const other = localDevice(':memory:', undefined, async () => true);
    try {
      await other.store.migrate();
      const userId = await server.auth.createUser('protection@example.com', 'test-password-123');
      const tokens = (await server.auth.login('protection@example.com', 'test-password-123'))!;
      const syncA = new SyncService(
        device.store.synchronization,
        transport(server, tokens.accessToken, device.store),
      );
      const syncB = new SyncService(
        other.store.synchronization,
        transport(server, tokens.accessToken, other.store),
      );
      const note = await device.store.save({
        ...blankNote(randomUUID()),
        title: '숨길 제목',
        category: '비밀 분류',
        body: '보존할 내용',
      });
      await protect('비밀 분류', true, true);
      await syncA.sync();
      await syncB.sync();
      expect(await other.store.categories()).toEqual([]);
      expect(await other.store.list('notes')).toEqual([]);
      await expect(other.store.get(note.id)).rejects.toBeInstanceOf(CategoryAccessError);
      await other.store.authorizeCategoryManagement();
      expect((await other.store.categorySettings())[0]).toMatchObject({
        name: '비밀 분류',
        locked: true,
        hidden: true,
      });
      expect(await other.store.unlockCategory('비밀 분류')).toBe(true);
      expect((await other.store.get(note.id))?.body).toBe('보존할 내용');
      const raw = JSON.stringify(server.notes.list(userId));
      expect(raw).not.toContain('비밀 분류');
      expect(raw).not.toContain('categoryProtection');
      expect(raw).not.toContain('숨길 제목');
      await other.store.setCategoryProtection('비밀 분류', { locked: false, hidden: false });
      await syncB.sync();
      await syncA.sync();
      expect((await device.store.get(note.id))?.categoryProtection).toEqual({
        locked: false,
        hidden: false,
      });
    } finally {
      other.sqlite.close();
      await server.app.close();
    }
  });

  it('retains restrictive protection and both contents when an older offline edit conflicts', async () => {
    const server = await createApp();
    const other = localDevice(':memory:', undefined, async () => true);
    try {
      await other.store.migrate();
      await server.auth.createUser('conflict-protection@example.com', 'test-password-123');
      const tokens = (await server.auth.login(
        'conflict-protection@example.com',
        'test-password-123',
      ))!;
      const syncA = new SyncService(
        device.store.synchronization,
        transport(server, tokens.accessToken, device.store),
      );
      const syncB = new SyncService(
        other.store.synchronization,
        transport(server, tokens.accessToken, other.store),
      );
      const note = await device.store.save({
        ...blankNote(randomUUID()),
        category: '충돌 분류',
        body: '원본',
      });
      await syncA.sync();
      await syncB.sync();
      const stale = (await other.store.get(note.id))!;
      await protect('충돌 분류', true, true);
      await syncA.sync();
      await other.store.save({ ...stale, body: '오프라인 편집' });
      await syncB.sync();
      expect(await other.store.categories()).toEqual([]);
      expect(await other.store.list('notes')).toEqual([]);
      await other.store.unlockCategory('충돌 분류');
      const notes = await other.store.list('notes', '', '충돌 분류');
      expect(notes.map((item) => item.body).sort()).toEqual(['오프라인 편집', '원본'].sort());
      expect(notes.filter((item) => item.conflictOf === note.id)).toHaveLength(1);
      await other.store.authorizeCategoryManagement();
      expect((await other.store.categorySettings())[0]).toMatchObject({
        locked: true,
        hidden: true,
      });
    } finally {
      other.sqlite.close();
      await server.app.close();
    }
  });
});
