import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { blankNote } from '@yeongdu/shared';
import { CategoryAccessError } from '@yeongdu/shared/src/category-access';
import { localDevice } from './helpers';

const devices: ReturnType<typeof localDevice>[] = [];
afterEach(() => {
  for (const device of devices.splice(0)) {
    device.sqlite.close();
  }
});
async function device() {
  const result = localDevice();
  devices.push(result);
  await result.store.migrate();
  return result;
}

describe('shared store composition boundaries', () => {
  it('rolls back an import revoked during its outbox write and drains later writes through the same queue', async () => {
    const { store, sqlite, adapter } = await device();
    const original = await store.save({ ...blankNote(randomUUID()), body: 'original' });
    const pending = await store.pending();
    const plan = await store.prepareBackupImport(
      JSON.stringify({
        format: 'yeongdu-memo',
        version: 1,
        exportedAt: new Date().toISOString(),
        notes: [{ ...blankNote(randomUUID()), body: 'imported' }],
      }),
    );
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = adapter.withExclusiveTransactionAsync.bind(adapter);
    let paused = false;
    adapter.withExclusiveTransactionAsync = (task) =>
      transaction((tx) =>
        task({
          ...tx,
          async runAsync(sql, ...params) {
            if (!paused && sql.startsWith('INSERT INTO outbox')) {
              paused = true;
              entered();
              await resume;
            }
            return tx.runAsync(sql, ...params);
          },
        }),
      );
    const importing = store.importBackup(plan);
    const failure = expect(importing).rejects.toBeInstanceOf(CategoryAccessError);
    await writing;
    store.relockCategories();
    const queued = store.save({ ...blankNote(randomUUID()), body: 'later edit' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM outbox').get()).toEqual({ count: 1 });
    release();
    await failure;
    await queued;
    expect((await store.list('notes')).map((note) => note.body).sort()).toEqual([
      'later edit',
      'original',
    ]);
    expect(await store.get(original.id)).toEqual(original);
    expect((await store.pending()).find((operation) => operation.note.id === original.id)).toEqual(
      pending[0],
    );
    await expect(store.importBackup(plan)).rejects.toThrow('만료');
  });

  it('rolls back notes and cursor when checkpoint persistence rejects the same remote transaction', async () => {
    const { store } = await device();
    const checkpoint = {
      serverId: randomUUID(),
      generation: randomUUID(),
      head: 5,
      token: randomUUID(),
    };
    await store.recordSyncCheckpoint(checkpoint);
    const before = await store.syncContext();
    const remote = { ...blankNote(randomUUID()), body: 'uncommitted remote', revision: 6 };
    await expect(
      store.applyRemote([remote], 6, {
        ...checkpoint,
        head: 6,
        generation: randomUUID(),
        token: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'generation_changed' });
    expect(await store.get(remote.id)).toBeNull();
    expect(await store.syncContext()).toEqual(before);
    expect(await store.cursor()).toBe(0);
    const local = await store.save({ ...blankNote(randomUUID()), body: 'queue still works' });
    expect(await store.get(local.id)).toEqual(local);
  });
});
