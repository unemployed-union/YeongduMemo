import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { flushEditors, gate, useRuntime } from './runtime';
import { exportAttachmentBackup } from './attachment-transfer';

export async function shareBackup() {
  await flushEditors();
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('이 기기에서 파일 공유를 지원하지 않습니다.');
  }
  const initial = useRuntime.getState();
  const store = initial.store;
  const accessVersion = store?.categoryAccessVersion();
  function assertExportAccess() {
    gate.assertAccess();
    const current = useRuntime.getState();
    const stillAuthorized =
      store !== null &&
      current.store === store &&
      current.active &&
      current.unlocked &&
      store.categoryAccessVersion() === accessVersion;
    if (!stillAuthorized) {
      throw new Error('내보내기 확인이 만료되었습니다. 앱으로 돌아와 다시 인증해 주세요.');
    }
  }
  assertExportAccess();
  const backup = await exportAttachmentBackup();
  if (!backup) {
    return;
  }
  // Recheck the handoff boundary, after the export promise has resolved.
  assertExportAccess();
  const file = new File(Paths.cache, `yeongdu-memo-${Date.now()}.json`);
  try {
    file.write(JSON.stringify(backup, null, 2));
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: '메모 내보내기',
      UTI: 'public.json',
    });
  } finally {
    if (file.exists) {
      file.delete();
    }
  }
}
