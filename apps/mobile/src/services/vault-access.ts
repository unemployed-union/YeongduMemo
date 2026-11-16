import { BackupImportError } from '@yeongdu/shared/src/backup';
import { gate, useRuntime } from './runtime';

// System pickers resume through the normal vault unlock flow.
export async function waitForVaultAccess() {
  const accessible = () => {
    const state = useRuntime.getState();
    return state.active && state.unlocked && state.store !== null;
  };
  if (accessible()) {
    gate.assertAccess();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const unsubscribe = useRuntime.subscribe(() => {
      if (accessible()) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
    const timer = setTimeout(() => {
      unsubscribe();
      reject(
        new BackupImportError('앱 잠금 해제 후 파일을 다시 선택해 주세요. 변경한 메모는 없습니다.'),
      );
    }, 120_000);
  });
  gate.assertAccess();
}
