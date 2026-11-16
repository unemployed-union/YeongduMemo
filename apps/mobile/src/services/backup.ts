import { waitForVaultAccess } from './vault-access';
export { waitForVaultAccess } from './vault-access';
import { File } from 'expo-file-system';
import {
  BackupImportError,
  MAX_BACKUP_BYTES,
  type BackupImportPlan,
} from '@yeongdu/shared/src/backup';
import { flushEditors, gate, notifyChange, synchronize, useRuntime } from './runtime';

export async function pickBackupImport(): Promise<BackupImportPlan | null> {
  gate.assertAccess();
  await flushEditors();
  const selection = await File.pickFileAsync({
    mimeTypes: ['application/json', 'text/plain'],
    multipleFiles: false,
  });
  if (selection.canceled) {
    return null;
  }
  await waitForVaultAccess();
  let text: string;
  try {
    if (selection.result.size > MAX_BACKUP_BYTES) {
      throw new BackupImportError(
        '백업은 50MiB까지 가져올 수 있습니다. 원본을 보관하고 파일을 나눠 주세요.',
      );
    }
    text = await selection.result.text();
  } catch (error) {
    if (error instanceof BackupImportError) {
      throw error;
    }
    throw new BackupImportError(
      '선택한 파일을 읽을 수 없습니다. 파일 접근 권한과 형식을 확인해 주세요.',
    );
  }
  gate.assertAccess();
  if (!useRuntime.getState().active) {
    throw new BackupImportError('앱으로 돌아온 후 파일을 다시 선택해 주세요.');
  }
  // Do not copy, modify or delete the user's selected plaintext file.
  return useRuntime.getState().store!.prepareBackupImport(text);
}

export async function confirmBackupImport(plan: BackupImportPlan) {
  gate.assertAccess();
  const result = await useRuntime.getState().store!.importBackup(plan);
  notifyChange();
  void synchronize();
  return result;
}

export function discardBackupImport(plan: BackupImportPlan) {
  useRuntime.getState().store?.discardBackupImport(plan);
}
