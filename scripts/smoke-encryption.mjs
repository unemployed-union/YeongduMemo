import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

// Independent Node fixture for the v1 envelope retained by the v3 sync protocol.
export async function encryptedFixture(base, headers, userId, note, key = randomBytes(32)) {
  const keyId = createHash('sha256').update(key).digest('hex');
  const registered = await fetch(`${base}/e2ee/key`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ version: 1, keyId }),
  });
  if (!registered.ok) {
    throw new Error(`Key registration failed (${registered.status})`);
  }
  const conflictId = randomUUID();
  const attachmentIds = note.attachments?.map((file) => file.id) ?? [];
  const context = Buffer.from(
    JSON.stringify([
      'yeongdu-memo',
      1,
      userId,
      keyId,
      note.id,
      note.purged,
      conflictId,
      ...(attachmentIds.length ? [attachmentIds] : []),
    ]),
  );
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(context);
  const ciphertext = Buffer.concat([
    nonce,
    cipher.update(JSON.stringify(note), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  return {
    note: {
      id: note.id,
      sourceId: note.id,
      conflictId,
      conflictOf: note.conflictOf,
      version: 1,
      keyId,
      purged: note.purged,
      ciphertext,
      ...(attachmentIds.length ? { attachmentIds } : {}),
    },
    decrypt(encrypted) {
      const combined = Buffer.from(encrypted.ciphertext, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, combined.subarray(0, 12));
      decipher.setAAD(context);
      decipher.setAuthTag(combined.subarray(-16));
      return JSON.parse(
        Buffer.concat([decipher.update(combined.subarray(12, -16)), decipher.final()]).toString(
          'utf8',
        ),
      );
    },
  };
}

export function encryptedAttachmentFixture(userId, key, bytes) {
  const id = randomUUID();
  const keyId = createHash('sha256').update(key).digest('hex');
  const file = {
    id,
    name: 'smoke-attachment.bin',
    mime: 'application/octet-stream',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const count = Math.max(1, Math.ceil(bytes.length / 262144));
  const chunks = [];
  const manifest = { version: 1, id, keyId, chunks: [] };
  const aad = (index) =>
    Buffer.from(JSON.stringify(['yeongdu-memo-attachment', 1, userId, keyId, id, index, count]));
  for (let index = 0; index < count; index++) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(index));
    const sealed = Buffer.concat([
      nonce,
      cipher.update(bytes.subarray(index * 262144, (index + 1) * 262144)),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    chunks.push(sealed.toString('base64'));
    manifest.chunks.push({
      size: sealed.length,
      sha256: createHash('sha256').update(sealed).digest('hex'),
    });
  }
  return {
    file,
    chunks,
    manifest,
    decrypt(data, index) {
      const sealed = Buffer.from(data, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
      decipher.setAAD(aad(index));
      decipher.setAuthTag(sealed.subarray(-16));
      return Buffer.concat([decipher.update(sealed.subarray(12, -16)), decipher.final()]);
    },
  };
}
