import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { blankNote } from '@yeongdu/shared';
import { NoteEncryption } from '@yeongdu/shared/src/e2ee';
import { migrationCipher } from '../apps/server/src/maintenance/e2ee-migration';
import { localDevice, testRecoveryKey } from './helpers';

describe('SQLite process interruption', () => {
  it('recovers notes, outbox, retry ciphertext and checkpoint after killing a writer mid-attachment transaction', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'memo-crash-test-'));
    const path = join(directory, 'vault.db');
    const tables = [
      'notes',
      'outbox',
      'encrypted_outbox',
      'metadata',
      'local_attachments',
      'attachment_chunks',
      'attachment_uploads',
    ];
    try {
      const seed = localDevice(path);
      let original: unknown[];
      let noteId: string;
      try {
        seed.sqlite.pragma('journal_mode = WAL');
        await seed.store.migrate();
        const note = await seed.store.save({
          ...blankNote(randomUUID()),
          body: 'committed Markdown\r\n* keep',
        });
        noteId = note.id;
        const operation = (await seed.store.pending())[0]!;
        const encryption = new NoteEncryption(migrationCipher(testRecoveryKey), randomUUID());
        await seed.store.encryptedOperation(operation, async () => {
          const { revision, ...content } = await encryption.encrypt(note);
          expect(revision).toBe(operation.baseRevision);
          return { ...operation, note: content };
        });
        await seed.store.recordSyncCheckpoint({
          serverId: randomUUID(),
          generation: randomUUID(),
          head: 0,
          token: randomUUID(),
        });
        original = tables.map((table) => seed.sqlite.prepare(`SELECT * FROM ${table}`).all());
      } finally {
        seed.sqlite.close();
      }

      const loader = createRequire(resolve('apps/server/package.json')).resolve('tsx');
      const script = `
        import { createHash, randomUUID } from 'node:crypto';
        import { localDevice } from './tests/helpers.ts';
        import { splitAttachment } from './packages/shared/src/attachments.ts';
        const device = localDevice(process.argv[1]);
        await device.store.migrate();
        const transaction = device.adapter.withExclusiveTransactionAsync.bind(device.adapter);
        device.adapter.withExclusiveTransactionAsync = (task) => transaction((tx) => task({
          ...tx,
          async runAsync(sql, ...params) {
            const result = await tx.runAsync(sql, ...params);
            if (sql.startsWith('INSERT INTO attachment_chunks')) {
              process.send({ phase: 'uncommitted' });
              await new Promise(() => { setInterval(() => undefined, 1000); });
            }
            return result;
          }
        }));
        const bytes = new Uint8Array([1, 2, 3]);
        const file = { id: randomUUID(), name: 'test.bin', mime: 'application/octet-stream', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
        await device.store.attachFile(await device.store.get(process.argv[2]), file, splitAttachment(bytes), 0);
      `;
      const child = spawn(
        process.execPath,
        [
          '--import',
          pathToFileURL(loader).href,
          '--input-type=module',
          '-e',
          script,
          path,
          noteId!,
        ],
        {
          cwd: process.cwd(),
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        },
      );
      const exited = new Promise<void>((done) => child.once('close', () => done()));
      let diagnostic = '';
      child.stderr!.on('data', (chunk) => {
        diagnostic = (diagnostic + String(chunk)).slice(-4000);
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((ready, reject) => {
          child.once('message', (message) => {
            if ((message as { phase?: string }).phase === 'uncommitted') {
              ready();
            }
          });
          child.once('error', reject);
          child.once('exit', () =>
            reject(new Error(`Writer exited before the crash boundary. ${diagnostic}`)),
          );
          timer = setTimeout(
            () => reject(new Error('Writer did not reach the crash boundary.')),
            10_000,
          );
        });
        child.kill('SIGKILL');
        await exited;
      } finally {
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        await exited;
      }

      const recovered = localDevice(path);
      try {
        await recovered.store.migrate();
        expect(
          tables.map((table) => recovered.sqlite.prepare(`SELECT * FROM ${table}`).all()),
        ).toEqual(original!);
        expect(recovered.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
        expect((await recovered.store.get(noteId!))?.body).toBe('committed Markdown\r\n* keep');
        expect(await recovered.store.pending()).toHaveLength(1);
      } finally {
        recovered.sqlite.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
