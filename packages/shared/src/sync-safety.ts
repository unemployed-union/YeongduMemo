import { z } from 'zod';

export const checkpointSchema = z.strictObject({
  serverId: z.uuid(),
  generation: z.uuid(),
  head: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  token: z.uuid(),
});
export type SyncCheckpoint = z.infer<typeof checkpointSchema>;
export const syncContextSchema = z.strictObject({
  witness: checkpointSchema.nullable(),
  cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  knownRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type SyncContext = z.infer<typeof syncContextSchema>;
export const syncIssueSchema = z.enum([
  'server_replaced',
  'generation_changed',
  'server_regressed',
  'history_diverged',
  'legacy_checkpoint_required',
  'protocol_upgrade_required',
]);
export type SyncIssue = z.infer<typeof syncIssueSchema>;
const messages: Record<SyncIssue, string> = {
  server_replaced: '다른 서버 DB가 감지되어 동기화를 중단했습니다.',
  generation_changed: '서버 복원 또는 세대 변경이 감지되어 동기화를 중단했습니다.',
  server_regressed: '서버가 기기의 동기화 이력보다 이전 상태입니다. 동기화를 중단했습니다.',
  history_diverged: '서버 이력이 기기에 기록된 이력과 다릅니다. 동기화를 중단했습니다.',
  legacy_checkpoint_required:
    '기존 기기에 서버 이력 표식이 없어 자동 연결하지 않습니다. 복구 안내를 확인하세요.',
  protocol_upgrade_required: '백업 복구 검사를 지원하는 최신 서버와 앱으로 모두 업데이트하세요.',
};
export class SyncSafetyError extends Error {
  readonly statusCode = 409;
  constructor(readonly code: SyncIssue) {
    super(messages[code]);
    this.name = 'SyncSafetyError';
  }
}

export function assertCheckpointProgress(
  previous: SyncCheckpoint | null,
  next: SyncCheckpoint,
  minimum = 0,
) {
  if (previous && previous.serverId !== next.serverId) {
    throw new SyncSafetyError('server_replaced');
  }
  if (previous && previous.generation !== next.generation) {
    throw new SyncSafetyError('generation_changed');
  }
  if (next.head < Math.max(previous?.head ?? 0, minimum)) {
    throw new SyncSafetyError('server_regressed');
  }
  if (previous && previous.head === next.head && previous.token !== next.token) {
    throw new SyncSafetyError('history_diverged');
  }
}
