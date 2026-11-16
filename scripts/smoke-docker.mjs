import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { encryptedFixture } from './smoke-encryption.mjs';

// Intended for the isolated CI Compose project, after `docker compose up -d --wait`.
const base = 'http://127.0.0.1:3000';
async function compose(args, input = '') {
  const child = spawn('docker', ['compose', ...args], {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let error = '';
  child.stderr.on('data', (data) => {
    error += data;
  });
  child.stdin.end(input);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0, error);
}
const email = `ci-${randomUUID()}@example.com`;
const password = randomUUID() + randomUUID();
await compose(['exec', '-T', 'server', 'node', 'dist/cli.js', 'user:create', email], password);
const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert.equal(login.status, 200);
const tokens = await login.json();
const headers = {
  Authorization: `Bearer ${tokens.accessToken}`,
  'Content-Type': 'application/json',
};
const now = new Date().toISOString();
const note = {
  id: randomUUID(),
  title: 'Compose persistence',
  body: 'restart retained this note',
  favorite: false,
  pinned: false,
  archived: false,
  purged: false,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
  conflictOf: null,
};
const fixture = await encryptedFixture(base, headers, tokens.userId, note);
const witness = await (
  await fetch(`${base}/sync/v4/checkpoint`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ witness: null, cursor: 0, knownRevision: 0 }),
  })
).json();
const push = await fetch(`${base}/sync/v4/push`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    witness,
    operations: [
      { operationId: randomUUID(), clientId: randomUUID(), baseRevision: 0, note: fixture.note },
    ],
  }),
});
assert.equal(push.status, 200);
await compose(['restart', 'server']);
await compose(['up', '-d', '--wait']);
const notes = await (await fetch(`${base}/notes`, { headers })).json();
assert.equal(fixture.decrypt(notes.find((item) => item.id === note.id)).body, note.body);
assert.ok(!JSON.stringify(notes).includes(note.body));
console.log(
  'Docker smoke passed: account, HTTP push, container restart, persisted note and session.',
);
