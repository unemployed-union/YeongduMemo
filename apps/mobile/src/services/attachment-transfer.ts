import { attachmentStorageId, type Attachment } from '@yeongdu/shared/src/attachments';
import { AttachmentSync } from '@yeongdu/shared/src/attachment-sync';
import { verifySyncStart } from '@yeongdu/shared/src/sync';
import { SyncSafetyError } from '@yeongdu/shared/src/sync-safety';
import { ApiClient } from './api';
import { loadNoteEncryption } from './encryption';
import { gate, useRuntime } from './runtime';
import { readTokens } from '../storage/secure';

export async function downloadAttachment(file: Attachment) {
  const { store, settings } = useRuntime.getState();
  const tokens = await readTokens();
  if (!settings.serverUrl || !tokens) {
    throw new Error('아직 이 기기에 없는 첨부파일입니다. 원래 서버에 연결해 다운로드하세요.');
  }
  const client = new ApiClient(settings.serverUrl);
  try {
    await verifySyncStart(store!.synchronization, (context) => client.checkpoint(context));
    const registered = await client.encryptionKey();
    if (!registered) {
      throw new Error('등록된 암호화 키가 없습니다.');
    }
    const crypto = await loadNoteEncryption(
      settings.serverUrl,
      tokens.userId,
      registered.keyId,
      gate.assertAccess,
    );
    await new AttachmentSync(store!, client, crypto.attachments, crypto.keyId).download(file);
  } catch (error) {
    if (error instanceof SyncSafetyError) {
      useRuntime.setState({ syncIssue: error.code, syncStatus: error.message });
    }
    throw error;
  }
}

export async function exportAttachmentBackup() {
  const store = useRuntime.getState().store!;
  return store.exportBackup(async (files) => {
    const downloaded = new Set<string>();
    for (const file of files) {
      if (!downloaded.has(attachmentStorageId(file)) && !(await store.transportAttachment(file))) {
        await downloadAttachment(file);
      }
      downloaded.add(attachmentStorageId(file));
    }
  });
}
