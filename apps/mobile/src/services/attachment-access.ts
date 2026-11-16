import { gate, useRuntime } from './runtime';

export function assertVisible(version: number) {
  gate.assertAccess();
  const state = useRuntime.getState();
  if (!state.active || !state.unlocked || state.store?.categoryAccessVersion() !== version) {
    throw new Error('첨부파일 접근이 만료되었습니다. 앱으로 돌아와 메모를 다시 열어 주세요.');
  }
}
