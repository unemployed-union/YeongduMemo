import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { blankNote } from '@yeongdu/shared';
import { AccessGate } from '@yeongdu/shared/src/lock';

const native = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  getRandomBytesAsync: vi.fn(async () => new Uint8Array(32).fill(0xa7)),
  aesEncryptAsync: vi.fn(),
  aesDecryptAsync: vi.fn(),
  authenticate: vi.fn(async () => true),
  registeredKey: vi.fn(),
  tokens: vi.fn(),
}));
vi.mock('../apps/mobile/src/services/device-auth', () => ({
  authenticateDevice: native.authenticate,
}));
vi.mock('../apps/mobile/src/services/api', () => ({
  ApiClient: class {
    encryptionKey = native.registeredKey;
  },
}));
vi.mock('../apps/mobile/src/storage/secure', () => ({
  readTokens: native.tokens,
  readSecret: vi.fn(async (name: string) => native.secrets.get(name) ?? null),
  writeSecret: vi.fn(async (name: string, value: string) => {
    native.secrets.set(name, value);
  }),
}));
vi.mock('expo-crypto', async () => {
  const { createHash, randomUUID } = await import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, input: string) =>
      createHash('sha256').update(input).digest('hex'),
    digest: async (_algorithm: string, input: Uint8Array) => {
      const bytes = createHash('sha256').update(input).digest();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    AESEncryptionKey: { import: async (bytes: Uint8Array) => ({ bytes: new Uint8Array(bytes) }) },
    AESSealedData: { fromCombined: (combined: string) => combined },
    randomUUID,
    getRandomBytesAsync: native.getRandomBytesAsync,
    aesEncryptAsync: native.aesEncryptAsync,
    aesDecryptAsync: native.aesDecryptAsync,
  };
});

import {
  createNoteEncryption,
  generateRecoveryKey,
  loadNoteEncryption,
  saveRecoveryKey,
  revealRecoveryKey,
} from '../apps/mobile/src/services/encryption';

const recoveryKey = 'a7'.repeat(32);
const keyId = createHash('sha256').update(Buffer.from(recoveryKey, 'hex')).digest('hex');
const base = 'https://memo.example.com';
const userId = randomUUID();
beforeEach(() => {
  native.secrets.clear();
  vi.clearAllMocks();
  native.authenticate.mockResolvedValue(true);
});

describe('mobile encryption key storage and native API boundaries (mocked Expo)', () => {
  it('generates keys only on explicit request using the asynchronous native CSPRNG', async () => {
    expect(await generateRecoveryKey()).toBe(recoveryKey);
    expect(native.getRandomBytesAsync).toHaveBeenCalledWith(32);
  });

  it('does not publish a late generated key after cancellation and clears the native bytes', async () => {
    let complete!: (bytes: Uint8Array<ArrayBuffer>) => void;
    native.getRandomBytesAsync.mockImplementationOnce(
      () =>
        new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
          complete = resolve;
        }),
    );
    const controller = new AbortController();
    const generated = generateRecoveryKey(controller.signal).then(
      () => 'published',
      () => 'canceled',
    );
    controller.abort();
    const bytes = new Uint8Array(32).fill(0xa7);
    complete(bytes);
    expect(await generated).toBe('canceled');
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(native.secrets.size).toBe(0);
  });

  it('propagates a native key generation failure without writing a replacement key', async () => {
    const failure = new Error('CSPRNG unavailable');
    native.getRandomBytesAsync.mockRejectedValueOnce(failure);
    await expect(generateRecoveryKey()).rejects.toBe(failure);
    expect(native.secrets.size).toBe(0);
  });

  it('fails closed on missing/corrupted keys and never generates a replacement', async () => {
    const gate = new AccessGate();
    gate.unlock();
    await expect(loadNoteEncryption(base, userId, keyId, gate.assertAccess)).rejects.toThrow(
      '찾을 수 없습니다',
    );
    await saveRecoveryKey(base, userId, keyId, 'b8'.repeat(32));
    await expect(loadNoteEncryption(base, userId, keyId, gate.assertAccess)).rejects.toThrow(
      '손상',
    );
    expect(native.getRandomBytesAsync).not.toHaveBeenCalled();
  });

  it('scopes saved keys to server, account and fingerprint without overwriting previous keys', async () => {
    const otherKey = 'b8'.repeat(32);
    const otherId = createHash('sha256').update(Buffer.from(otherKey, 'hex')).digest('hex');
    await saveRecoveryKey(base, userId, keyId, recoveryKey);
    await saveRecoveryKey(base, userId, otherId, otherKey);
    await expect(saveRecoveryKey(base, userId, keyId, otherKey)).rejects.toThrow('덮어쓸');
    const gate = new AccessGate();
    gate.unlock();
    expect((await loadNoteEncryption(base, userId, keyId, gate.assertAccess)).keyId).toBe(keyId);
    await expect(
      loadNoteEncryption('https://other.example.com', userId, keyId, gate.assertAccess),
    ).rejects.toThrow('찾을 수 없습니다');
    await expect(loadNoteEncryption(base, randomUUID(), keyId, gate.assertAccess)).rejects.toThrow(
      '찾을 수 없습니다',
    );
    expect(native.secrets.size).toBe(3);
  });

  it('reveals a verified key offline only after authentication and fails on revocation or cancellation', async () => {
    await saveRecoveryKey(base, userId, keyId, recoveryKey);
    const gate = new AccessGate();
    gate.unlock();
    expect(await revealRecoveryKey(`${base}|${userId}`, gate.assertAccess)).toBe(recoveryKey);
    expect(native.registeredKey).not.toHaveBeenCalled();
    native.authenticate.mockResolvedValueOnce(false);
    expect(await revealRecoveryKey(`${base}|${userId}`, gate.assertAccess)).toBeNull();
    native.authenticate.mockImplementationOnce(async () => {
      gate.lock();
      return true;
    });
    await expect(revealRecoveryKey(`${base}|${userId}`, gate.assertAccess)).rejects.toThrow('잠금');
    expect(native.getRandomBytesAsync).not.toHaveBeenCalled();
  });

  it('indexes an older installation only through its bound account and does not regenerate a lost key', async () => {
    await saveRecoveryKey(base, userId, keyId, recoveryKey);
    for (const name of native.secrets.keys()) {
      if (name.startsWith('e2ee-current-')) {
        native.secrets.delete(name);
      }
    }
    native.tokens.mockResolvedValue({ userId: randomUUID() });
    await expect(revealRecoveryKey(`${base}|${userId}`, () => undefined)).rejects.toThrow(
      '원래 서버',
    );
    expect(native.registeredKey).not.toHaveBeenCalled();
    native.tokens.mockResolvedValue({ userId });
    native.registeredKey.mockResolvedValue({ keyId });
    expect(await revealRecoveryKey(`${base}|${userId}`, () => undefined)).toBe(recoveryKey);
    for (const name of native.secrets.keys()) {
      if (!name.startsWith('e2ee-current-')) {
        native.secrets.delete(name);
      }
    }
    await expect(revealRecoveryKey(`${base}|${userId}`, () => undefined)).rejects.toThrow(
      '찾을 수 없습니다',
    );
    expect(native.getRandomBytesAsync).not.toHaveBeenCalled();
  });

  it('blocks key access while locked and supplies the expected nonce, tag and AAD to Expo AES', async () => {
    const gate = new AccessGate();
    await expect(createNoteEncryption(recoveryKey, userId, gate.assertAccess)).rejects.toThrow(
      '잠금',
    );
    gate.unlock();
    const { encryption } = await createNoteEncryption(recoveryKey, userId, gate.assertAccess);
    native.aesEncryptAsync.mockResolvedValue({
      combined: async () => Buffer.alloc(32, 1).toString('base64'),
    });
    await encryption.encrypt(blankNote(randomUUID()));
    const [, key, options] = native.aesEncryptAsync.mock.calls[0]!;
    expect(Buffer.from(key.bytes).toString('hex')).toBe(recoveryKey);
    expect(options.nonce).toEqual({ length: 12 });
    expect(options.tagLength).toBe(16);
    expect(new TextDecoder().decode(options.additionalData)).toContain(userId);
    gate.lock();
    await expect(encryption.encrypt(blankNote(randomUUID()))).rejects.toThrow('잠금');
    expect(native.aesEncryptAsync).toHaveBeenCalledTimes(1);
  });
});
