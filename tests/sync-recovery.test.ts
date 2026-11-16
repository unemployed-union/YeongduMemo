import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankNote } from '@yeongdu/shared';
import { SyncService } from '@yeongdu/shared/src/sync';
import { SyncSafetyError } from '@yeongdu/shared/src/sync-safety';
import { createApp } from '../apps/server/src/app';
import { openDatabase } from '../apps/server/src/database';
import { backupConnection, backupDatabase } from '../apps/server/src/maintenance/backup';
import { localDevice, transport } from './helpers';

const servers: Awaited<ReturnType<typeof createApp>>[] = [];
const devices: ReturnType<typeof localDevice>[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.app.close();
  }
  for (const device of devices.splice(0)) {
    if (device.sqlite.open) {
      device.sqlite.close();
    }
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function folder() {
  const directory = mkdtempSync(join(tmpdir(), 'yeongdu-sync-recovery-'));
  directories.push(directory);
  return directory;
}
async function setup(databasePath?: string) {
  const server = await createApp(databasePath ? { databasePath } : {});
  servers.push(server);
  await server.auth.createUser('recover@example.com', 'recovery-test-password');
  const tokens = (await server.auth.login('recover@example.com', 'recovery-test-password'))!;
  const device = localDevice();
  devices.push(device);
  await device.store.migrate();
  const sync = new SyncService(
    device.store.synchronization,
    transport(server, tokens.accessToken, device.store),
  );
  return { server, tokens, device, sync };
}

describe('server backup and synchronization recovery', () => {
  it('backs up v2 before migration and preserves notes, sessions and receipts while adding stable anchors', async () => {
    const directory = folder();
    const path = join(directory, 'server.db');
    const { server, device, sync } = await setup(path);
    await device.store.save({ ...blankNote(randomUUID()), body: '원문\r\n보존' });
    await sync.sync();
    const originals = Object.fromEntries(
      ['notes', 'sessions', 'receipts'].map((table) => [
        table,
        server.db.sqlite.prepare(`SELECT * FROM ${table}`).all(),
      ]),
    );
    await server.app.close();
    const legacy = new Database(path);
    legacy.exec(
      'DROP TABLE attachments; DROP TABLE sync_identity; ALTER TABLE changes DROP COLUMN checkpoint; PRAGMA user_version = 2;',
    );
    legacy.close();
    const migrated = await openDatabase(path);
    try {
      expect(migrated.sqlite.pragma('user_version', { simple: true })).toBe(4);
      for (const table of ['notes', 'sessions', 'receipts']) {
        expect(migrated.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual(originals[table]);
      }
      expect(migrated.sqlite.prepare('SELECT checkpoint FROM changes').get()).toHaveProperty(
        'checkpoint',
        expect.any(String),
      );
      const backupName = readdirSync(directory).find((name) => name.includes('.before-v4-'))!;
      const backup = new Database(join(directory, backupName), { readonly: true });
      expect(backup.pragma('user_version', { simple: true })).toBe(2);
      expect(backup.prepare('SELECT * FROM notes').all()).toEqual(originals.notes);
      backup.close();
      const readOnlyCopyPath = join(directory, 'v2-readonly-copy.db');
      await backupDatabase(join(directory, backupName), readOnlyCopyPath);
      const readOnlyCopy = new Database(readOnlyCopyPath, { readonly: true });
      expect(readOnlyCopy.pragma('user_version', { simple: true })).toBe(2);
      expect(readOnlyCopy.prepare('SELECT * FROM receipts').all()).toEqual(originals.receipts);
      readOnlyCopy.close();
      const destination = join(directory, 'manual.db');
      await backupDatabase(path, destination);
      await expect(backupDatabase(path, destination)).rejects.toThrow();
      const preserved = new Database(destination, { readonly: true });
      expect(preserved.prepare('SELECT * FROM notes').all()).toEqual(originals.notes);
      preserved.close();
    } finally {
      migrated.sqlite.close();
    }
  });

  it('accepts a normal restart and an intact DB move with the same checkpoint lineage', async () => {
    const directory = folder();
    const path = join(directory, 'original.db');
    const { server, tokens, device, sync } = await setup(path);
    const note = await device.store.save({ ...blankNote(randomUUID()), body: '재시작 보존' });
    await sync.sync();
    const checkpoint = server.notes.checkpoint(tokens.userId);
    const movedPath = join(directory, 'moved.db');
    await backupConnection(server.db.sqlite, movedPath);
    await server.app.close();
    const restarted = await createApp({ databasePath: path });
    servers.push(restarted);
    expect(restarted.notes.checkpoint(tokens.userId)).toEqual(checkpoint);
    await new SyncService(
      device.store.synchronization,
      transport(restarted, tokens.accessToken, device.store),
    ).sync();
    const moved = await createApp({ databasePath: movedPath });
    servers.push(moved);
    await new SyncService(
      device.store.synchronization,
      transport(moved, tokens.accessToken, device.store),
    ).sync();
    expect((await device.store.get(note.id))?.body).toBe('재시작 보존');
  });

  it('latches a restored older backup before upload and preserves offline edits, operation IDs, cursor and witness', async () => {
    const directory = folder();
    const { server, tokens, device, sync } = await setup();
    const first = await device.store.save({ ...blankNote(randomUUID()), body: '최초' });
    await sync.sync();
    const snapshot = join(directory, 'old.db');
    await backupConnection(server.db.sqlite, snapshot);
    await device.store.save({ ...blankNote(randomUUID()), body: '백업 이후 추가' });
    await sync.sync();
    await device.store.save({
      ...(await device.store.get(first.id))!,
      body: '미전송 오프라인 수정',
    });
    const pending = await device.store.synchronization.pending();
    const cursor = await device.store.cursor();
    const witness = (await device.store.syncContext()).witness;
    const restored = await createApp({ databasePath: snapshot });
    servers.push(restored);
    const before = restored.db.sqlite.prepare('SELECT * FROM notes').all();
    await expect(
      new SyncService(
        device.store.synchronization,
        transport(restored, tokens.accessToken, device.store),
      ).sync(),
    ).rejects.toMatchObject({ code: 'server_regressed' });
    expect(restored.db.sqlite.prepare('SELECT * FROM notes').all()).toEqual(before);
    expect(await device.store.synchronization.pending()).toEqual(pending);
    expect(await device.store.cursor()).toBe(cursor);
    expect(
      (
        device.sqlite.prepare("SELECT value FROM metadata WHERE key = 'sync-checkpoint'").get() as {
          value: string;
        }
      ).value,
    ).toBe(JSON.stringify(witness));
    expect((await device.store.get(first.id))?.body).toBe('미전송 오프라인 수정');
    await expect(sync.sync()).rejects.toMatchObject({ code: 'server_regressed' });
  });

  it('detects a restored branch even after its sequence has grown past the device cursor', async () => {
    const directory = folder();
    const { server, tokens, device, sync } = await setup();
    await device.store.save({ ...blankNote(randomUUID()), body: '공통 이력' });
    await sync.sync();
    const snapshot = join(directory, 'branch.db');
    await backupConnection(server.db.sqlite, snapshot);
    await device.store.save({ ...blankNote(randomUUID()), body: '원래 분기' });
    await sync.sync();
    const restored = await createApp({ databasePath: snapshot });
    servers.push(restored);
    const branch = localDevice();
    devices.push(branch);
    await branch.store.migrate();
    await branch.store.save({ ...blankNote(randomUUID()), body: '다른 분기 1' });
    await branch.store.save({ ...blankNote(randomUUID()), body: '다른 분기 2' });
    await new SyncService(
      branch.store.synchronization,
      transport(restored, tokens.accessToken, branch.store),
    ).sync();
    expect(restored.notes.checkpoint(tokens.userId).head).toBeGreaterThan(
      (await device.store.syncContext()).witness!.head,
    );
    await expect(
      new SyncService(
        device.store.synchronization,
        transport(restored, tokens.accessToken, device.store),
      ).sync(),
    ).rejects.toMatchObject({ code: 'history_diverged' });
  });

  it('distinguishes server replacement and generation changes, and checks again inside the push transaction', async () => {
    for (const [column, code] of [
      ['server_id', 'server_replaced'],
      ['generation', 'generation_changed'],
    ] as const) {
      const { server, tokens, device, sync } = await setup();
      await sync.sync();
      await device.store.save(blankNote(randomUUID()));
      const connection = transport(server, tokens.accessToken, device.store);
      const changed = new SyncService(device.store.synchronization, {
        checkpoint: (context) => connection.checkpoint(context),
        push: (operations, witness) => {
          server.db.sqlite.prepare(`UPDATE sync_identity SET ${column} = ?`).run(randomUUID());
          return connection.push(operations, witness);
        },
        pull: (cursor, witness) => connection.pull(cursor, witness),
      });
      await expect(changed.sync()).rejects.toMatchObject({ code });
      expect(server.notes.list(tokens.userId)).toEqual([]);
      expect(await device.store.synchronization.pending()).toHaveLength(1);
    }
  });

  it('blocks anchorless legacy devices without touching their pending operations and rejects old sync clients', async () => {
    const { server, tokens, device } = await setup();
    const note = { ...blankNote(randomUUID()), body: '구버전 오프라인 데이터', revision: 4 };
    await device.store.applyRemote([note], 4);
    await device.store.save({ ...note, body: '구버전 추가 입력' });
    const pending = await device.store.pending();
    const check = vi.fn(async () => server.notes.checkpoint(tokens.userId));
    await expect(
      new SyncService(device.store.synchronization, {
        checkpoint: check,
        push: async () => {
          throw new Error('unexpected');
        },
        pull: async () => {
          throw new Error('unexpected');
        },
      }).sync(),
    ).rejects.toMatchObject({ code: 'legacy_checkpoint_required' });
    expect(check).not.toHaveBeenCalled();
    expect(await device.store.pending()).toEqual(pending);
    const response = await server.app.inject({
      url: '/sync/v2/push',
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload: { operations: [] },
    });
    expect(response.statusCode).toBe(426);
    expect(response.json().code).toBe('protocol_upgrade_required');
    expect(await device.store.syncIssue()).toBe('legacy_checkpoint_required');
    expect(new SyncSafetyError('legacy_checkpoint_required').message).not.toContain(note.body);
  });
});
