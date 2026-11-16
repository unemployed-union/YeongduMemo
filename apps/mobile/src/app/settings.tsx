import { ServerConnectionSettings } from '../components/ServerConnectionSettings';
import { shareBackup } from '../services/backup-export';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Page, ScreenHeader, SettingsSection } from '../components/ui';
import { AnimatedSwitch } from '../components/AnimatedSwitch';
import { SettingsButton } from '../components/SettingsButton';
import { SyncRecoveryNotice } from '../components/SyncRecoveryNotice';
import { BackupImport } from '../components/BackupImport';
import {
  flushEditors,
  relockCategories,
  gate,
  updateSettings,
  useRuntime,
} from '../services/runtime';
import { useTheme } from '../theme';
import { authenticateDevice } from '../services/device-auth';
import { ArrowLeft } from 'lucide-react-native';
import { authorizeCategoryManagement } from '../services/category-protection';

const themeOptions = [
  { value: 'system', title: '시스템' },
  { value: 'light', title: '라이트' },
  { value: 'dark', title: '다크' },
] as const;
const lockOptions = [
  { value: 'immediate', title: '즉시' },
  { value: '30s', title: '30초 후' },
  { value: 'restart', title: '재실행 시' },
] as const;

export default function SettingsScreen() {
  const state = useRuntime();
  const t = useTheme();

  const [busy, setBusy] = useState(false);

  async function perform(task: () => Promise<void>) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await task();
    } catch (error) {
      Alert.alert('확인해 주세요', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function toggleLock() {
    if (await authenticateDevice('앱 잠금 설정 변경')) {
      await updateSettings({ lockEnabled: !state.settings.lockEnabled });
    }
  }

  return (
    <Page>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{
            width: '100%',
            maxWidth: t.layout.contentWidth,
            alignSelf: 'center',
            paddingBottom: t.spacing.xxl,
          }}
        >
          <ScreenHeader
            title="설정"
            detail="나의 메모 공간을 내 취향에 맞게."
            leading={<Button title="메모" icon={ArrowLeft} onPress={() => router.back()} />}
          />
          <View style={{ paddingHorizontal: t.spacing.page, paddingTop: t.spacing.md }}>
            <SyncRecoveryNotice />
            <SettingsSection title="화면 모드">
              <View style={{ flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap' }}>
                {themeOptions.map((option) => (
                  <SettingsButton
                    key={option.value}
                    title={option.title}
                    selected={state.settings.theme === option.value}
                    disabled={busy}
                    onPress={() => {
                      void perform(() => updateSettings({ theme: option.value }));
                    }}
                  />
                ))}
              </View>
              <Text style={{ color: t.secondary, fontSize: 13, lineHeight: 21 }}>
                시스템 모드는 기기의 화면 설정을 따릅니다.
              </Text>
            </SettingsSection>
            <SettingsSection title="보안과 잠금">
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: t.layout.minTouch,
                  gap: t.spacing.md,
                }}
              >
                <Text style={{ color: t.text, fontSize: 16, fontWeight: '600', flex: 1 }}>
                  생체 인증 · 기기 암호 잠금
                </Text>
                <AnimatedSwitch
                  accessibilityLabel="앱 잠금 활성화"
                  value={state.settings.lockEnabled}
                  busy={busy}
                  onValueChange={() => {
                    void perform(toggleLock);
                  }}
                />
              </View>
              <Text style={{ color: t.secondary, fontSize: 13, lineHeight: 22 }}>
                Face ID·지문을 사용하고, 사용할 수 없으면 OS 기기 암호로 인증합니다. DB는 잠금
                설정과 별개로 SQLCipher로 암호화합니다.
              </Text>
              {state.settings.lockEnabled && (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                    {lockOptions.map((option) => (
                      <SettingsButton
                        key={option.value}
                        title={option.title}
                        selected={state.settings.lockPolicy === option.value}
                        disabled={busy}
                        onPress={() => {
                          void perform(() => updateSettings({ lockPolicy: option.value }));
                        }}
                      />
                    ))}
                  </View>
                  <SettingsButton
                    title="지금 잠그기"
                    disabled={busy}
                    onPress={() => {
                      void perform(async () => {
                        await flushEditors();
                        relockCategories();
                        gate.lock();
                        useRuntime.setState({ unlocked: false });
                      });
                    }}
                  />
                </>
              )}
            </SettingsSection>
            <SettingsSection title="카테고리 보호">
              <SettingsButton
                title="카테고리 잠금·숨김 관리"
                disabled={busy}
                onPress={() => {
                  void perform(async () => {
                    if (await authorizeCategoryManagement()) {
                      router.push('/categories');
                    }
                  });
                }}
              />
              <Text style={{ color: t.secondary, fontSize: 13, lineHeight: 21 }}>
                보호 설정은 암호화하여 동기화합니다. 잠금 해제는 각 기기에서 인증하며 앱을 나가면
                다시 잠깁니다.
              </Text>
              <SettingsButton title="보호된 카테고리 다시 잠그기" onPress={relockCategories} />
            </SettingsSection>
            <ServerConnectionSettings busy={busy} perform={perform} />
            <SettingsSection title="데이터 보관">
              <BackupImport />
              <SettingsButton
                title="모든 메모 내보내기"
                align="start"
                disabled={busy}
                onPress={() => {
                  Alert.alert(
                    '메모 내보내기',
                    '메모와 첨부파일을 평문 JSON으로 내보냅니다. 아직 없는 첨부는 원래 서버에서 내려받습니다. 안전한 위치에 보관하세요.',
                    [
                      { text: '취소', style: 'cancel' },
                      {
                        text: '내보내기',
                        onPress: () => {
                          void perform(shareBackup);
                        },
                      },
                    ],
                  );
                }}
              />
              <Text style={{ color: t.secondary, fontSize: 13, lineHeight: 21 }}>
                JSON 파일에 Markdown 원문을 그대로 담습니다. 내보낸 파일은 암호화되지 않습니다.
              </Text>
            </SettingsSection>
            <View
              style={{ alignItems: 'center', gap: t.spacing.sm, paddingVertical: t.spacing.md }}
            >
              <Text style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>
                영두메모 <Text style={{ color: t.secondary, fontWeight: '400' }}>0.1.0</Text>
              </Text>
              <Text
                style={{ color: t.secondary, lineHeight: 22, fontSize: 12, textAlign: 'center' }}
              >
                나만의 기록을, 나만의 공간에.{'\n'}Local-first · Markdown · Self-hosted
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}
