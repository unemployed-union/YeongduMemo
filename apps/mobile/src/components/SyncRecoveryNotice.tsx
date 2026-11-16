import { Text, View } from 'react-native';
import { SyncSafetyError } from '@yeongdu/shared/src/sync-safety';
import { useRuntime } from '../services/runtime';
import { useTheme } from '../theme';

export function SyncRecoveryNotice() {
  const issue = useRuntime((state) => state.syncIssue);
  const t = useTheme();
  if (!issue) {
    return null;
  }
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        padding: t.spacing.md,
        gap: t.spacing.sm,
        backgroundColor: t.accentSoft,
        borderRadius: t.radius.settingsGroup,
        marginBottom: t.spacing.lg,
      }}
    >
      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>
        동기화를 안전하게 중단했어요
      </Text>
      <Text style={{ color: t.text, fontSize: 13, lineHeight: 21 }}>
        {new SyncSafetyError(issue).message}
      </Text>
      <Text style={{ color: t.text, fontSize: 13, lineHeight: 21 }}>
        {issue === 'protocol_upgrade_required'
          ? '서버와 모든 기기의 앱을 업데이트하세요. 업데이트 전까지 메모와 전송 대기 수정은 이 기기에 보존됩니다.'
          : '이 기기의 메모와 전송 대기 수정은 그대로 보존됩니다. 서버 상태가 다시 바뀌어도 자동으로 연결하지 않습니다.\n\n1. 모든 기기에서 메모를 내보내고 복구 키를 안전하게 보관하세요.\n2. 관리자에게 서버를 중지하고 현재 DB·WAL·SHM 및 복원한 백업을 각각 보존하도록 요청하세요.\n3. 운영·복구 문서에 따라 서버 복사본을 검증하세요. 이력이 확정되지 않으면 원본 기기를 유지하고 별도 기기·앱 데이터 공간에 JSON을 새 사본으로 가져와 수동으로 비교합니다.\n\n앱 삭제, DB 삭제, cursor 초기화는 복구 확인 전에 하지 마세요.'}
      </Text>
    </View>
  );
}
