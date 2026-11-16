import { normalizeServerUrl } from '@yeongdu/shared';
import { ApiClient } from './api';
import { createNoteEncryption, saveRecoveryKey } from './encryption';
import { gate, settleSync, updateSettings, useRuntime } from './runtime';
import { readTokens, writeTokens } from '../storage/secure';
import { confirmRecoveryKey, type RecoveryKeyConfirmation } from '@yeongdu/shared/src/recovery-key';

export async function connectServer(
  url: string,
  email: string,
  password: string,
  recoveryKey: string,
  confirmation: RecoveryKeyConfirmation,
) {
  gate.assertAccess();
  const confirmedKey = confirmRecoveryKey(recoveryKey, confirmation);
  await settleSync();
  const base = normalizeServerUrl(url, __DEV__);
  const client = new ApiClient(base);
  const tokens = await client.login(email.trim(), password);
  const { keyId } = await createNoteEncryption(confirmedKey, tokens.userId, gate.assertAccess);
  const registered = await client.encryptionKey(tokens);
  if (registered && registered.keyId !== keyId) {
    throw new Error('복구 키가 일치하지 않습니다. 처음 연결한 기기에서 보관한 키를 입력하세요.');
  }
  gate.assertAccess();
  await useRuntime.getState().store!.bindAccount(`${base}|${tokens.userId}`);
  // Persist the key before registering it, so a lost response never strands the account.
  await saveRecoveryKey(base, tokens.userId, keyId, confirmedKey);
  await client.registerEncryptionKey(keyId, tokens);
  gate.assertAccess();
  await writeTokens(tokens);
  await updateSettings({ serverUrl: base });
}

export async function disconnectServer(serverUrl: string): Promise<boolean> {
  await settleSync();
  const tokens = await readTokens();
  if (!tokens) {
    return false;
  }
  await new ApiClient(serverUrl).logout();
  await updateSettings({ serverUrl: '' });
  useRuntime.setState({ syncStatus: '로그아웃 · 로컬에 저장' });
  return true;
}
