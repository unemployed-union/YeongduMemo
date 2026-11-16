import { useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Page, Button, Message, ScreenHeader, SettingsSection } from '../components/ui';
import { AnimatedSwitch } from '../components/AnimatedSwitch';
import { SettingsButton } from '../components/SettingsButton';
import { openCategory, updateCategoryProtection } from '../services/category-protection';
import { useCategoryProtection } from '../features/notes/useCategoryProtection';
import { useTheme } from '../theme';

export default function CategorySettingsScreen() {
  const t = useTheme();
  const { categories, visible, error, requestManagement } = useCategoryProtection();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  async function perform(task: () => Promise<void>) {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await task();
    } catch (reason) {
      Alert.alert(
        '카테고리 보호',
        reason instanceof Error ? reason.message : '처리하지 못했습니다.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Page>
      <ScreenHeader
        title="카테고리 보호"
        leading={<Button title="뒤로" icon={ArrowLeft} onPress={() => router.back()} />}
        detail="설정은 암호화해 동기화하며, 인증은 기기마다 따로 진행합니다."
      />
      {!visible ? (
        <View style={{ flex: 1, padding: t.spacing.page }}>
          <Message
            title="인증 후 관리할 수 있어요"
            detail={error || '잠금과 숨김 설정을 안전하게 관리합니다.'}
          />
          <SettingsButton
            title="인증하고 카테고리 관리"
            disabled={busy}
            onPress={() => {
              void perform(requestManagement);
            }}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            width: '100%',
            maxWidth: t.layout.contentWidth,
            alignSelf: 'center',
            padding: t.spacing.page,
          }}
        >
          {categories.length === 0 && (
            <Message
              title="카테고리가 없어요"
              detail="메모 편집 화면에서 카테고리를 먼저 지정하세요."
            />
          )}
          {categories.map((category) => (
            <SettingsSection key={category.name} title={category.name}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                <Text style={{ flex: 1, color: t.text, fontSize: 16 }}>카테고리 잠금</Text>
                <AnimatedSwitch
                  accessibilityLabel={`${category.name} 잠금`}
                  value={category.locked}
                  busy={busy}
                  onValueChange={(locked) => {
                    void perform(() =>
                      updateCategoryProtection(category.name, { locked, hidden: category.hidden }),
                    );
                  }}
                />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                <Text style={{ flex: 1, color: t.text, fontSize: 16 }}>카테고리 숨김</Text>
                <AnimatedSwitch
                  accessibilityLabel={`${category.name} 숨김`}
                  value={category.hidden}
                  busy={busy}
                  onValueChange={(hidden) => {
                    void perform(() =>
                      updateCategoryProtection(category.name, { hidden, locked: category.locked }),
                    );
                  }}
                />
              </View>
              <Text style={{ color: t.secondary, fontSize: 12, lineHeight: 19 }}>
                숨긴 메모는 전체 목록과 검색에서 제외됩니다. 열기를 누르면 인증 후 해당 카테고리만
                표시합니다.
              </Text>
              <SettingsButton
                title="카테고리 열기"
                disabled={busy}
                onPress={() => {
                  void perform(async () => {
                    if (await openCategory(category.name)) {
                      router.replace({ pathname: '/', params: { category: category.name } });
                    }
                  });
                }}
              />
            </SettingsSection>
          ))}
        </ScrollView>
      )}
    </Page>
  );
}
