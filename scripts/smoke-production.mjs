import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { encryptedFixture, encryptedAttachmentFixture } from './smoke-encryption.mjs';

const directory = resolve(process.argv[2] ?? 'apps/server');
const temporary = await mkdtemp(join(tmpdir(), 'yeongdu-production-'));
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const env = {
  ...process.env,
  DATABASE_PATH: join(temporary, 'memo.db'),
  ATTACHMENT_STORAGE: 'filesystem',
  ATTACHMENT_PATH: join(temporary, 'blobs'),
  HOST: '127.0.0.1',
  PORT: String(port),
};
const base = `http://127.0.0.1:${port}`;
let child;

async function cli(args, input = '') {
  const process = spawn(globalThis.process.execPath, ['dist/cli.js', ...args], {
    cwd: directory,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let error = '';
  process.stderr.on('data', (data) => {
    error += data;
  });
  process.stdin.end(input);
  const code = await new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', resolve);
  });
  assert.equal(code, 0, error);
}
async function start() {
  child = spawn(process.execPath, ['dist/index.js'], {
    cwd: directory,
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* Wait for bind. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Production server failed to become ready.');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}
try {
  const password = randomUUID() + randomUUID();
  await cli(['user:create', 'smoke@example.com'], password);
  await start();
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'smoke@example.com', password }),
  });
  assert.equal(login.status, 200);
  const tokens = await login.json();
  const now = new Date().toISOString();
  const note = {
    id: randomUUID(),
    title: '배포 검증',
    body: '# 원문\n\n- [x] 보존',
    favorite: false,
    pinned: false,
    archived: false,
    deletedAt: null,
    purged: false,
    createdAt: now,
    updatedAt: now,
    conflictOf: null,
  };
  const authorization = {
    Authorization: `Bearer ${tokens.accessToken}`,
    'Content-Type': 'application/json',
  };
  const testKey = randomBytes(32);
  const attachmentBytes = Buffer.from('production attachment backup smoke');
  const attachment = encryptedAttachmentFixture(tokens.userId, testKey, attachmentBytes);
  note.attachments = [attachment.file];
  const fixture = await encryptedFixture(base, authorization, tokens.userId, note, testKey);
  const witness = await (
    await fetch(`${base}/sync/v4/checkpoint`, {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({ witness: null, cursor: 0, knownRevision: 0 }),
    })
  ).json();
  async function attachmentRequest(path, body, method = 'POST') {
    const response = await fetch(`${base}/attachments/v1/${path}`, {
      method,
      headers: authorization,
      body: JSON.stringify({ witness, ...body }),
    });
    assert.equal(response.status, 200);
  }
  await attachmentRequest('stage', { manifest: attachment.manifest });
  for (let index = 0; index < attachment.chunks.length; index++) {
    await attachmentRequest(
      `${attachment.file.id}/chunks/${index}`,
      { data: attachment.chunks[index] },
      'PUT',
    );
  }
  await attachmentRequest(`${attachment.file.id}/commit`, {});
  const pushed = await fetch(`${base}/sync/v4/push`, {
    method: 'POST',
    headers: authorization,
    body: JSON.stringify({
      witness,
      operations: [
        { operationId: randomUUID(), clientId: randomUUID(), baseRevision: 0, note: fixture.note },
      ],
    }),
  });
  assert.equal(pushed.status, 200);
  const firstCommit = await pushed.json();
  const backup = join(temporary, 'backup.db');
  await cli(['backup', backup]);
  await cli(['backup:verify', backup]);
  assert.ok((await stat(backup)).size > 0);
  const secondNote = { ...note, id: randomUUID(), body: '백업 이후 메모' };
  const secondFixture = await encryptedFixture(
    base,
    authorization,
    tokens.userId,
    secondNote,
    testKey,
  );
  const secondPush = await fetch(`${base}/sync/v4/push`, {
    method: 'POST',
    headers: authorization,
    body: JSON.stringify({
      witness: firstCommit.checkpoint,
      operations: [
        {
          operationId: randomUUID(),
          clientId: randomUUID(),
          baseRevision: 0,
          note: secondFixture.note,
        },
      ],
    }),
  });
  assert.equal(secondPush.status, 200);
  const secondCommit = await secondPush.json();
  await stop();
  await start();
  const notes = await (await fetch(`${base}/notes`, { headers: authorization })).json();
  assert.equal(notes.length, 2);
  assert.equal(fixture.decrypt(notes.find((item) => item.id === note.id)).body, note.body);
  assert.ok(!JSON.stringify(notes).includes(note.body));
  await stop();
  // Restore only a fresh temporary copy; preserve the newer DB for the entire exercise.
  env.DATABASE_PATH = join(temporary, 'restored.db');
  env.ATTACHMENT_PATH = join(temporary, 'restored-blobs');
  await copyFile(backup, env.DATABASE_PATH);
  await cp(`${backup}.attachments`, env.ATTACHMENT_PATH, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await cli(['sync:renew-generation']);
  assert.ok(
    (await readdir(temporary)).some((name) => name.startsWith('restored.db.before-generation-')),
  );
  await start();
  const rejected = await fetch(`${base}/sync/v4/checkpoint`, {
    method: 'POST',
    headers: authorization,
    body: JSON.stringify({
      witness: secondCommit.checkpoint,
      cursor: secondCommit.checkpoint.head,
      knownRevision: secondCommit.checkpoint.head,
    }),
  });
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).code, 'generation_changed');
  const restoredNotes = await (await fetch(`${base}/notes`, { headers: authorization })).json();
  assert.equal(restoredNotes.length, 1);
  assert.equal(fixture.decrypt(restoredNotes[0]).body, note.body);
  const restoredChunk = await fetch(`${base}/attachments/v1/${attachment.file.id}/chunks/0`, {
    headers: authorization,
  });
  assert.equal(restoredChunk.status, 200);
  assert.deepEqual(attachment.decrypt((await restoredChunk.json()).data, 0), attachmentBytes);
  console.log(
    'Production smoke passed: CLI account, encrypted attachment upload/download, guarded sync, DB + blob backup verification/restore, restart persistence and generation renewal.',
  );
} finally {
  await stop();
  await rm(temporary, { recursive: true, force: true });
}
