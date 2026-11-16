import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankNote, normalizeServerUrl } from '@yeongdu/shared';
import { Autosave } from '../packages/shared/src/autosave';
import { AccessGate } from '../packages/shared/src/lock';
import { localDevice } from './helpers';
import { transactionalDatabase } from '../packages/shared/src/sql-transactions';

afterEach(() => vi.useRealTimers());
describe('local notes', () => {
  it('keeps uncommitted writes off the read connection and rolls back failed writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yeongdu-transactions-'));
    const path = join(dir, 'vault.db');
    const reader = localDevice(path);
    reader.sqlite.pragma('journal_mode = WAL');
    reader.sqlite.exec('CREATE TABLE probe (value TEXT)');
    const writer = localDevice(path);
    const adapter = transactionalDatabase(reader.adapter, writer.adapter);
    try {
      await adapter.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync('INSERT INTO probe VALUES (?)', 'committed');
        expect(await adapter.getAllAsync('SELECT * FROM probe')).toEqual([]);
      });
      expect(await adapter.getAllAsync('SELECT * FROM probe')).toEqual([{ value: 'committed' }]);
      await expect(
        adapter.withExclusiveTransactionAsync(async (tx) => {
          await tx.runAsync('INSERT INTO probe VALUES (?)', 'rollback');
          throw new Error('outbox failed');
        }),
      ).rejects.toThrow('outbox failed');
      expect(await adapter.getAllAsync('SELECT * FROM probe')).toEqual([{ value: 'committed' }]);
    } finally {
      reader.sqlite.close();
      writer.sqlite.close();
      rmSync(dir, { recursive: true });
    }
  });
  it('preserves exact Markdown, searches, filters, restores, and persists across reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yeongdu-local-'));
    const path = join(dir, 'notes.db');
    let device = localDevice(path);
    try {
      await device.store.migrate();
      const body =
        '# 제목\r\n\n- [x] 완료\n\n| 가 | 나 |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n  \n**bold** _italic_ ~~strike~~';
      const note = await device.store.save({
        ...blankNote(randomUUID()),
        title: '한글 메모',
        body,
      });
      expect((await device.store.list('notes', '완료'))[0]?.body).toBe(body);
      await device.store.save({ ...note, favorite: true, pinned: true });
      expect(await device.store.list('favorites')).toHaveLength(1);
      await device.store.save({ ...note, archived: true });
      expect(await device.store.list('notes')).toHaveLength(0);
      expect(await device.store.list('archive')).toHaveLength(1);
      await device.store.save({ ...note, deletedAt: new Date().toISOString() });
      expect(await device.store.list('trash')).toHaveLength(1);
      await device.store.save(note);
      device.sqlite.close();
      device = localDevice(path);
      await device.store.migrate();
      expect((await device.store.get(note.id))?.body).toBe(body);
      expect(await device.store.pending()).toHaveLength(1);
      await device.store.save({
        ...note,
        deletedAt: new Date().toISOString(),
        purged: true,
        title: '',
        body: '',
      });
      expect(await device.store.list('trash')).toHaveLength(0);
    } finally {
      device.sqlite.close();
      rmSync(dir, { recursive: true });
    }
  });

  it('enforces repository access after relocking and binds the first account', async () => {
    const gate = new AccessGate();
    const device = localDevice(':memory:', gate.assertAccess);
    try {
      await device.store.migrate();
      await expect(device.store.list('notes')).rejects.toThrow('잠금');
      gate.unlock();
      await device.store.save(blankNote(randomUUID()));
      await device.store.bindAccount('server-a|account-a');
      await expect(device.store.bindAccount('server-a|account-b')).rejects.toThrow('다른');
      gate.lock();
      await expect(device.store.pending()).rejects.toThrow('잠금');
      await expect(device.store.exportNotes()).rejects.toThrow('잠금');
      await expect(device.store.save(blankNote(randomUUID()))).rejects.toThrow('잠금');
    } finally {
      device.sqlite.close();
    }
  });
});

describe('autosave and security policy', () => {
  it('debounces, flushes on leave, serializes writes, and retries failures', async () => {
    vi.useFakeTimers();
    const values: string[] = [];
    let fail = false;
    const save = new Autosave<string>(
      async (value) => {
        if (fail) throw new Error('disk');
        values.push(value);
      },
      () => undefined,
      400,
    );
    save.update('a');
    save.update('b');
    await vi.advanceTimersByTimeAsync(399);
    expect(values).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(values).toEqual(['b']);
    save.update('c');
    await save.flush();
    expect(values).toEqual(['b', 'c']);
    fail = true;
    save.update('d');
    await expect(save.flush()).rejects.toThrow('disk');
    fail = false;
    await save.flush();
    expect(values).toEqual(['b', 'c', 'd']);
    save.update('e');
    const first = save.flush();
    save.update('f');
    await save.flush();
    await first;
    expect(values.slice(-2)).toEqual(['e', 'f']);
  });

  it('starts locked and applies immediate, delayed, and restart policies', () => {
    const gate = new AccessGate();
    expect(gate.isUnlocked()).toBe(false);
    gate.enabled = true;
    gate.unlock();
    gate.background(0);
    expect(gate.isUnlocked()).toBe(false);
    gate.policy = '30s';
    gate.unlock();
    gate.foreground(0);
    gate.background(1000);
    gate.foreground(30_999);
    expect(gate.isUnlocked()).toBe(true);
    gate.background(40_000);
    gate.foreground(70_000);
    expect(gate.isUnlocked()).toBe(false);
    gate.policy = 'restart';
    gate.unlock();
    gate.background(80_000);
    gate.foreground(100_000);
    expect(gate.isUnlocked()).toBe(true);
    expect(new AccessGate().isUnlocked()).toBe(false);
  });

  it('never retries a stale failed write over a newer queued successful edit', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saved: string[] = [];
    const saver = new Autosave<string>(
      async (value) => {
        if (value === 'old') {
          await blocked;
          throw new Error('old failed');
        }
        saved.push(value);
      },
      () => undefined,
    );
    saver.update('old');
    const old = saver.flush();
    saver.update('new');
    const newer = saver.flush();
    release();
    await expect(old).rejects.toThrow('old failed');
    await newer;
    await saver.flush();
    expect(saved).toEqual(['new']);
  });

  it('requires HTTPS and rejects credentials, paths, query strings, and script protocols', () => {
    expect(normalizeServerUrl('https://memo.example.com/')).toBe('https://memo.example.com');
    for (const url of [
      'http://localhost:3000',
      'https://user:pass@host',
      'https://host/path',
      'https://host/?key=abc',
      'javascript:alert(1)',
    ]) {
      expect(() => normalizeServerUrl(url)).toThrow();
    }
    expect(normalizeServerUrl('http://192.168.0.2:3000', true)).toBe('http://192.168.0.2:3000');
  });
});
