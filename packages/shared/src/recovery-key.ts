import { normalizeRecoveryKey } from './e2ee';

export interface RecoveryKeyConfirmation {
  confirmation: string;
  backedUp: boolean;
}

export function confirmRecoveryKey(key: string, confirmation: RecoveryKeyConfirmation) {
  const normalized = normalizeRecoveryKey(key);
  if (!confirmation.backedUp) {
    throw new Error(
      '복구 키를 비밀번호 관리자 또는 안전한 오프라인 장소에 보관하고 확인해 주세요.',
    );
  }
  if (normalized !== normalizeRecoveryKey(confirmation.confirmation)) {
    throw new Error('보관한 복구 키가 일치하지 않습니다. 보관한 값을 다시 입력해 주세요.');
  }
  return normalized;
}
