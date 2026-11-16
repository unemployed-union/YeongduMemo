import * as Crypto from 'expo-crypto';
import {
  NoteEncryption,
  keyIdSchema,
  normalizeRecoveryKey,
  type AeadCipher,
} from '@yeongdu/shared/src/e2ee';
import { readSecret, readTokens, writeSecret } from '../storage/secure';
import { authenticateDevice } from './device-auth';
import { ApiClient } from './api';
import { AttachmentEncryption } from '@yeongdu/shared/src/attachments';
import { attachmentDigest } from '../storage/digest';
export { attachmentDigest } from '../storage/digest';

export async function generateRecoveryKey(signal?: AbortSignal): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  try {
    if (signal?.aborted) {
      throw new Error('복구 키 생성을 취소했습니다.');
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } finally {
    bytes.fill(0);
  }
}

async function storageKey(base: string, userId: string, keyId: string) {
  const identity = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${base}|${userId}`,
  );
  return `e2ee-${identity}-${keyIdSchema.parse(keyId)}`;
}

async function currentKeySlot(identity: string) {
  return `e2ee-current-${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, identity)}`;
}

export async function createNoteEncryption(
  recoveryKey: string,
  userId: string,
  assertAccess: () => void,
) {
  assertAccess();
  const normalized = normalizeRecoveryKey(recoveryKey);
  const bytes = Uint8Array.from(normalized.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const keyId = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  let key: Crypto.AESEncryptionKey;
  try {
    key = await Crypto.AESEncryptionKey.import(bytes);
  } finally {
    bytes.fill(0);
  }
  assertAccess();
  const cipher: AeadCipher = {
    keyId,
    randomUUID: Crypto.randomUUID,
    async seal(plaintext, additionalData) {
      assertAccess();
      const sealed = await Crypto.aesEncryptAsync(plaintext, key, {
        additionalData,
        nonce: { length: 12 },
        tagLength: 16,
      });
      assertAccess();
      return sealed.combined('base64');
    },
    async open(ciphertext, additionalData) {
      assertAccess();
      const result = await Crypto.aesDecryptAsync(
        Crypto.AESSealedData.fromCombined(ciphertext, { ivLength: 12, tagLength: 16 }),
        key,
        { additionalData },
      );
      assertAccess();
      return result;
    },
  };
  return {
    encryption: new NoteEncryption(cipher, userId),
    keyId,
    attachments: new AttachmentEncryption(cipher, userId, attachmentDigest),
  };
}

export async function saveRecoveryKey(
  base: string,
  userId: string,
  keyId: string,
  recoveryKey: string,
) {
  const name = await storageKey(base, userId, keyId);
  const normalized = normalizeRecoveryKey(recoveryKey);
  const existing = await readSecret(name);
  if (existing && existing !== normalized) {
    throw new Error('이 기기에 저장된 복구 키와 다릅니다. 기존 키를 덮어쓸 수 없습니다.');
  }
  await writeSecret(name, normalized);
  await writeSecret(await currentKeySlot(`${base}|${userId}`), keyIdSchema.parse(keyId));
}

/** Only raw keys are returned, never written to a file or clipboard. Caller clears UI on background. */
export async function revealRecoveryKey(
  identity: string,
  assertCurrent: () => void,
): Promise<string | null> {
  assertCurrent();
  if (!(await authenticateDevice('복구 키 확인'))) {
    return null;
  }
  assertCurrent();
  const divider = identity.lastIndexOf('|');
  const base = identity.slice(0, divider);
  const userId = identity.slice(divider + 1);
  const slot = await currentKeySlot(identity);
  let keyId = await readSecret(slot);
  if (!keyId) {
    // Older installations have no index. Resolve it online once, scoped to the bound account.
    const tokens = await readTokens();
    if (!tokens || tokens.userId !== userId) {
      throw new Error('이전 버전의 키를 확인하려면 원래 서버·계정에 다시 로그인해 주세요.');
    }
    keyId = (await new ApiClient(base).encryptionKey(tokens))?.keyId ?? null;
  }
  assertCurrent();
  if (!keyId) {
    throw new Error('등록된 키가 없습니다. 보관한 원래 복구 키를 사용해 주세요.');
  }
  const key = await readSecret(await storageKey(base, userId, keyId));
  if (!key) {
    throw new Error(
      '이 기기에서 키를 찾을 수 없습니다. 새 키를 만들지 말고 보관한 원래 키를 사용하세요.',
    );
  }
  const verified = await createNoteEncryption(key, userId, assertCurrent);
  if (verified.keyId !== keyId) {
    throw new Error('저장된 키를 확인할 수 없습니다. 보관한 원래 키가 필요합니다.');
  }
  assertCurrent();
  await writeSecret(slot, keyId);
  assertCurrent();
  return normalizeRecoveryKey(key);
}

export async function loadNoteEncryption(
  base: string,
  userId: string,
  keyId: string,
  assertAccess: () => void,
) {
  assertAccess();
  const recoveryKey = await readSecret(await storageKey(base, userId, keyId));
  if (!recoveryKey) {
    throw new Error('암호화 키를 찾을 수 없습니다. 설정에서 원래 복구 키로 다시 연결하세요.');
  }
  const result = await createNoteEncryption(recoveryKey, userId, assertAccess);
  if (result.keyId !== keyId) {
    throw new Error('저장된 암호화 키가 손상되었습니다. 원래 복구 키로 다시 연결하세요.');
  }
  return result;
}
