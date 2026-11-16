import { create } from 'zustand';
import { AccessGate } from '@yeongdu/shared/src/lock';
import type { LocalStore } from '@yeongdu/shared/src/local-store';
import { SyncService, verifySyncStart } from '@yeongdu/shared/src/sync';
import { SyncSafetyError, type SyncIssue } from '@yeongdu/shared/src/sync-safety';
import { EncryptedTransport } from '@yeongdu/shared/src/e2ee';
import { ApiClient, ApiError } from './api';
import { defaultSettings, readTokens, writeSettings, type Settings } from '../storage/secure';
import { loadNoteEncryption } from './encryption';
import { AttachmentSync } from '@yeongdu/shared/src/attachment-sync';

export const gate = new AccessGate();
export const useRuntime = create<{
  ready: boolean;
  active: boolean;
  unlocked: boolean;
  settings: Settings;
  store: LocalStore | null;
  change: number;
  syncStatus: string;
  categoryVersion: number;
  categorySession: boolean;
  syncIssue: SyncIssue | null;
}>(() => ({
  ready: false,
  active: true,
  unlocked: false,
  settings: defaultSettings,
  store: null,
  change: 0,
  syncStatus: '로컬에 저장',
  categoryVersion: 0,
  categorySession: false,
  syncIssue: null,
}));

export const notifyChange = () => useRuntime.setState((state) => ({ change: state.change + 1 }));
export const notifyCategoryAccess = (categorySession: boolean) =>
  useRuntime.setState((state) => ({
    change: state.change + 1,
    categoryVersion: state.categoryVersion + 1,
    categorySession,
  }));

export function relockCategories() {
  const store = useRuntime.getState().store;
  if (store) {
    store.relockCategories();
  } else {
    notifyCategoryAccess(false);
  }
}
const flushers = new Set<() => Promise<void>>();
export function registerFlusher(flush: () => Promise<void>) {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}
export async function flushEditors() {
  await Promise.all([...flushers].map((flush) => flush()));
}

export async function updateSettings(patch: Partial<Settings>) {
  gate.assertAccess();
  const settings = { ...useRuntime.getState().settings, ...patch };
  await writeSettings(settings);
  gate.enabled = settings.lockEnabled;
  gate.policy = settings.lockPolicy;
  useRuntime.setState({ settings });
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let currentSync: Promise<void> | undefined;
export async function settleSync() {
  await currentSync?.catch(() => undefined);
}
export async function synchronize() {
  const { store, settings, active } = useRuntime.getState();
  if (!store || !settings.serverUrl || !gate.isUnlocked() || !active || flushers.size > 0) return;
  if (currentSync) {
    return currentSync;
  }
  clearTimeout(retryTimer);
  useRuntime.setState({ syncStatus: '동기화 중…' });
  try {
    currentSync = Promise.resolve().then(async () => {
      const tokens = await readTokens();
      if (!tokens) {
        throw new ApiError(401, '서버에 로그인하세요.');
      }
      const client = new ApiClient(settings.serverUrl);
      await verifySyncStart(store.synchronization, (context) => client.checkpoint(context));
      const registered = await client.encryptionKey();
      if (!registered) {
        throw new Error(
          '서버에 암호화 키가 등록되지 않았습니다. 설정에서 복구 키로 다시 연결하세요.',
        );
      }
      const { encryption, attachments, keyId } = await loadNoteEncryption(
        settings.serverUrl,
        tokens.userId,
        registered.keyId,
        gate.assertAccess,
      );
      const attachmentSync = new AttachmentSync(store, client, attachments, keyId);
      await new SyncService(
        store.synchronization,
        new EncryptedTransport(store, client, encryption, async (operation, witness) => {
          for (const file of operation.note.attachments) {
            await attachmentSync.upload(file, witness);
          }
        }),
      ).sync();
    });
    await currentSync;
    failures = 0;
    useRuntime.setState({
      syncIssue: null,
      syncStatus: `동기화됨 · ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
    });
    notifyChange();
  } catch (error) {
    if (error instanceof SyncSafetyError) {
      useRuntime.setState({ syncIssue: error.code, syncStatus: error.message });
      return;
    }
    useRuntime.setState({ syncStatus: error instanceof Error ? error.message : '동기화 대기 중' });
    if (error instanceof ApiError && error.status === 401) return;
    failures++;
    retryTimer = setTimeout(
      () => {
        void synchronize();
      },
      Math.min(60_000, 2 ** Math.min(failures, 6) * 1000),
    );
  } finally {
    currentSync = undefined;
  }
}
