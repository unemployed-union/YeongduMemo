import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { blankNote, type Operation, type Tokens } from '@yeongdu/shared';
import { SyncService } from '../packages/shared/src/sync';
import { createApp } from '../apps/server/src/app';
import { decryptedServerNotes, localDevice, transport } from './helpers';

let server: Awaited<ReturnType<typeof createApp>>;
let a: ReturnType<typeof localDevice>;
let b: ReturnType<typeof localDevice>;
let tokens: Tokens;
beforeEach(async () => {
  server = await createApp();
  await server.auth.createUser('sync@example.com', 'sync-test-password-123');
  tokens = (await server.auth.login('sync@example.com', 'sync-test-password-123'))!;
  a = localDevice();
  b = localDevice();
  await a.store.migrate();
  await b.store.migrate();
});
afterEach(async () => {
  a.sqlite.close();
  b.sqlite.close();
  await server.app.close();
});

describe('two-device synchronization using real SQLite and HTTP injection', () => {
  it('synchronizes category assignment and removal between devices', async () => {
    const syncA = new SyncService(a.store, transport(server, tokens.accessToken, a.store));
    const syncB = new SyncService(b.store, transport(server, tokens.accessToken, b.store));
    const note = await a.store.save({
      ...blankNote(randomUUID()),
      body: '카테고리 메모',
      category: '업무',
    });
    await syncA.sync();
    await syncB.sync();
    const remote = (await b.store.get(note.id))!;
    expect(remote.category).toBe('업무');
    expect(await b.store.categories()).toEqual(['업무']);

    await b.store.save({ ...remote, category: null });
    await syncB.sync();
    await syncA.sync();
    expect((await a.store.get(note.id))?.category).toBeNull();
    expect(await a.store.categories()).toEqual([]);
    expect((await a.store.list('notes', '', null)).map((item) => item.id)).toEqual([note.id]);
  });

  it('queues offline changes and retries an accepted request after a lost response without duplicates', async () => {
    const note = await a.store.save({
      ...blankNote(randomUUID()),
      body: '# 오프라인\n\n- [ ] 할 일',
    });
    let connected = false;
    let loseResponse = true;
    const connection = transport(server, tokens.accessToken, a.store);
    const sync = new SyncService(a.store, {
      checkpoint: (context) => connection.checkpoint(context),
      async push(ops, witness) {
        if (!connected) throw new Error('offline');
        const result = await connection.push(ops, witness);
        if (loseResponse) {
          loseResponse = false;
          throw new Error('response lost');
        }
        return result;
      },
      pull: (cursor, witness) => connection.pull(cursor, witness),
    });
    await expect(sync.sync()).rejects.toThrow('offline');
    expect((await a.store.get(note.id))?.body).toBe(note.body);
    expect(await a.store.pending()).toHaveLength(1);
    connected = true;
    await expect(sync.sync()).rejects.toThrow('response lost');
    await sync.sync();
    expect(await a.store.pending()).toHaveLength(0);
    expect(server.notes.list(tokens.userId)).toHaveLength(1);
    await new SyncService(b.store, transport(server, tokens.accessToken, b.store)).sync();
    expect((await b.store.get(note.id))?.body).toBe(note.body);
  });

  it('preserves both offline edits, then synchronizes trash, restore, and permanent tombstones', async () => {
    const connection = transport(server, tokens.accessToken, a.store);
    const syncA = new SyncService(a.store, connection);
    const syncB = new SyncService(b.store, transport(server, tokens.accessToken, b.store));
    const note = await a.store.save({ ...blankNote(randomUUID()), title: '공통', body: '최초' });
    await syncA.sync();
    await syncB.sync();
    const aNote = (await a.store.get(note.id))!;
    const bNote = (await b.store.get(note.id))!;
    await a.store.save({ ...aNote, body: 'A의 오프라인 수정', category: '업무' });
    await b.store.save({ ...bNote, body: 'B의 오프라인 수정', category: '개인' });
    await syncA.sync();
    await syncB.sync();
    await syncA.sync();
    for (const device of [a, b]) {
      const notes = await device.store.list('notes');
      expect(notes.map((item) => item.body).sort()).toEqual(
        ['A의 오프라인 수정', 'B의 오프라인 수정'].sort(),
      );
      expect(notes.filter((item) => item.conflictOf === note.id)).toHaveLength(1);
      expect(notes.find((item) => item.body === 'A의 오프라인 수정')?.category).toBe('업무');
      expect(notes.find((item) => item.body === 'B의 오프라인 수정')?.category).toBe('개인');
    }
    let current = (await a.store.get(note.id))!;
    await a.store.save({ ...current, deletedAt: new Date().toISOString() });
    await syncA.sync();
    await syncB.sync();
    expect(await b.store.list('trash')).toHaveLength(1);
    current = (await b.store.get(note.id))!;
    await b.store.save({ ...current, deletedAt: null });
    await syncB.sync();
    await syncA.sync();
    expect((await a.store.get(note.id))?.deletedAt).toBeNull();
    current = (await a.store.get(note.id))!;
    await a.store.save({
      ...current,
      purged: true,
      title: '',
      body: '',
      deletedAt: new Date().toISOString(),
    });
    await syncA.sync();
    await syncB.sync();
    expect((await b.store.get(note.id))?.purged).toBe(true);
    expect((await b.store.get(note.id))?.body).toBe('');
  });

  it('rebases a newer local edit made while a push is in flight', async () => {
    const note = await a.store.save({ ...blankNote(randomUUID()), body: '전송 중' });
    const connection = transport(server, tokens.accessToken, a.store);
    let edit = true;
    const sync = new SyncService(a.store, {
      checkpoint: (context) => connection.checkpoint(context),
      async push(ops, witness) {
        const result = await connection.push(ops, witness);
        if (edit) {
          edit = false;
          await a.store.save({ ...note, body: '전송 후 추가 입력', category: '추가 분류' });
        }
        return result;
      },
      pull: (cursor, witness) => connection.pull(cursor, witness),
    });
    await Promise.all([sync.sync(), sync.sync()]);
    expect((await a.store.get(note.id))?.body).toBe('전송 후 추가 입력');
    expect((await decryptedServerNotes(server, tokens.userId))[0]?.body).toBe('전송 후 추가 입력');
    expect((await a.store.get(note.id))?.category).toBe('추가 분류');
    expect((await decryptedServerNotes(server, tokens.userId))[0]?.category).toBe('추가 분류');
    expect(await a.store.pending()).toHaveLength(0);
  });

  it('moves edits made during a conflicting push into the conflict copy', async () => {
    const note = await a.store.save({ ...blankNote(randomUUID()), title: '제목', body: '원본' });
    const connection = transport(server, tokens.accessToken, a.store);
    const connectionB = transport(server, tokens.accessToken, b.store);
    await new SyncService(a.store, connection).sync();
    await new SyncService(b.store, connectionB).sync();
    const stale = (await b.store.get(note.id))!;
    await a.store.save({ ...(await a.store.get(note.id))!, body: '서버 최신' });
    await new SyncService(a.store, connection).sync();
    await b.store.save({ ...stale, body: 'B 전송' });
    let edit = true;
    await new SyncService(b.store, {
      checkpoint: (context) => connectionB.checkpoint(context),
      async push(ops: Operation[], witness) {
        const result = await connectionB.push(ops, witness);
        if (edit) {
          edit = false;
          await b.store.save({ ...stale, body: 'B 추가 입력' });
        }
        return result;
      },
      pull: (cursor, witness) => connectionB.pull(cursor, witness),
    }).sync();
    const notes = await b.store.list('notes');
    expect(notes.find((item) => item.id === note.id)?.body).toBe('서버 최신');
    expect(notes.find((item) => item.conflictOf === note.id)?.body).toBe('B 추가 입력');
    expect(
      (await decryptedServerNotes(server, tokens.userId)).find(
        (item) => item.conflictOf === note.id,
      )?.body,
    ).toBe('B 추가 입력');
  });

  it('keeps pending edits when pulls arrive first and does not resurrect a purged original', async () => {
    const connection = transport(server, tokens.accessToken, a.store);
    const connectionB = transport(server, tokens.accessToken, b.store);
    const note = await a.store.save({ ...blankNote(randomUUID()), body: '원본' });
    await new SyncService(a.store, connection).sync();
    await new SyncService(b.store, connectionB).sync();
    const stale = (await b.store.get(note.id))!;
    await b.store.save({ ...stale, body: '보존할 오프라인 내용' });
    const latest = (await a.store.get(note.id))!;
    await a.store.save({
      ...latest,
      purged: true,
      title: '',
      body: '',
      deletedAt: new Date().toISOString(),
    });
    await new SyncService(a.store, connection).sync();
    const page = (await connectionB.pull(
      await b.store.cursor(),
      server.notes.checkpoint(tokens.userId),
    )) as {
      notes: import('@yeongdu/shared').Note[];
      cursor: number;
    };
    await b.store.applyRemote(page.notes, page.cursor);
    expect((await b.store.get(note.id))?.body).toBe('보존할 오프라인 내용');
    await new SyncService(b.store, connectionB).sync();
    expect((await b.store.get(note.id))?.purged).toBe(true);
    expect((await b.store.list('notes'))[0]?.body).toBe('보존할 오프라인 내용');
  });
});
