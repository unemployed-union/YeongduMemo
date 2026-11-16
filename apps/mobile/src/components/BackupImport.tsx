import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import type { BackupImportPlan } from '@yeongdu/shared/src/backup';
import { confirmBackupImport, discardBackupImport, pickBackupImport } from '../services/backup';
import { useRuntime } from '../services/runtime';
import { useTheme } from '../theme';
import { SettingsButton } from './SettingsButton';

function summary(plan: BackupImportPlan) {
  return `새 사본 ${plan.imported}개 · 휴지통 ${plan.trash}개 · 보호됨 ${plan.protected}개 · 첨부 ${plan.attachments}개\n기존 ID ${plan.existingIds}개도 새 ID로 복사 · 카테고리 이름 변경 ${plan.renamedCategories}개\n영구 삭제 표식 ${plan.skippedPurged}개는 복원하지 않습니다.`;
}

export function BackupImport() {
  const t = useTheme();
  const active = useRuntime((state) => state.active && state.unlocked);
  const categoryVersion = useRuntime((state) => state.categoryVersion);
  const [plan, setPlan] = useState<BackupImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    setPlan(null);
  }, [active, categoryVersion]);
  useEffect(
    () => () => {
      if (plan) {
        discardBackupImport(plan);
      }
    },
    [plan],
  );

  async function perform(task: () => Promise<void>) {
    if (running.current) {
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      await task();
    } catch (error) {
      setPlan(null);
      Alert.alert(
        '가져오기 확인',
        error instanceof Error ? error.message : '가져오기를 완료하지 못했습니다.',
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: t.spacing.sm }}>
      <SettingsButton
        title={busy ? '가져오기 처리 중…' : 'JSON 백업 가져오기'}
        align="start"
        disabled={busy || !active}
        onPress={() => {
          void perform(async () => {
            setPlan(null);
            const next = await pickBackupImport();
            if (next) {
              setPlan(next);
            } else {
              Alert.alert(
                '파일 선택',
                '파일을 선택하지 않았거나 선택할 수 없습니다. 변경한 메모는 없습니다.',
              );
            }
          });
        }}
      />
      <Text style={{ color: t.secondary, fontSize: 13, lineHeight: 21 }}>
        평문 JSON에는 민감한 내용이 포함됩니다. 신뢰하는 파일만 선택하세요. 모든 메모를 새 사본으로
        가져오며 기존 메모는 보존합니다. 같은 이름의 카테고리에는 ‘복원’을 붙입니다. 보호된 메모는
        기기 인증이 필요합니다.
      </Text>
      {active && plan && (
        <View style={{ gap: t.spacing.sm }}>
          <Text accessibilityLiveRegion="polite" style={{ color: t.text, lineHeight: 23 }}>
            {summary(plan)}
          </Text>
          <Text style={{ color: t.secondary, lineHeight: 21 }}>
            다시 가져오면 사본이 추가됩니다. 보호 설정과 휴지통 상태를 유지하고, 파일 원본은 그대로
            둡니다.
          </Text>
          <SettingsButton
            title="확인하고 사본 가져오기"
            filled
            disabled={busy}
            onPress={() => {
              void perform(async () => {
                const result = await confirmBackupImport(plan);
                setPlan(null);
                Alert.alert(
                  '가져오기 완료',
                  `${summary(result)}\n보호된 카테고리는 다시 잠겼습니다. 동기화가 중단된 상태라면 로컬에만 보관됩니다.`,
                );
              });
            }}
          />
          <SettingsButton title="취소" disabled={busy} onPress={() => setPlan(null)} />
        </View>
      )}
    </View>
  );
}
