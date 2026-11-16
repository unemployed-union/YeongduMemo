import { useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Folder, Plus, X } from 'lucide-react-native';
import { categoryNameSchema } from '@yeongdu/shared';
import { useNoteCategories } from '../features/notes/useNoteCategories';
import { useRuntime } from '../services/runtime';
import { useTheme } from '../theme';
import { openCategory } from '../services/category-protection';
import { Button, Field } from './ui';

export function CategoryPicker({
  open,
  selected,
  onSelect,
  onClose,
}: {
  open: boolean;
  selected: string | null;
  onSelect: (category: string | null) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const visible = useRuntime((state) => state.active && state.unlocked);
  const { categories, error: loadError } = useNoteCategories();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const names = categories;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setError('');
    }
  }, [open]);

  async function choose(category: string | null) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      if (category === null || (await openCategory(category))) {
        onSelect(category);
        onClose();
      }
    } catch {
      setError('카테고리를 열지 못했습니다. 인증 후 다시 시도하세요.');
    } finally {
      setBusy(false);
    }
  }

  function create() {
    const parsed = categoryNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '카테고리 이름을 확인하세요.');
      return;
    }
    void choose(parsed.data);
  }

  return (
    <Modal visible={open && visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.overlay }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'center', padding: t.spacing.page }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="카테고리 선택 닫기"
            onPress={onClose}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
          />
          <View
            accessibilityViewIsModal
            style={{
              width: '100%',
              maxWidth: t.layout.categoryPickerWidth,
              maxHeight: '85%',
              alignSelf: 'center',
              borderRadius: t.radius.lg,
              backgroundColor: t.surface,
              padding: t.spacing.md,
              gap: t.spacing.md,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Folder size={22} color={t.accent} accessible={false} />
              <Text
                accessibilityRole="header"
                style={{ flex: 1, color: t.text, fontSize: 22, fontWeight: '700' }}
              >
                카테고리
              </Text>
              <Button title="닫기" icon={X} iconOnly onPress={onClose} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Field
                  placeholder="새 카테고리 이름"
                  value={name}
                  onChangeText={(value) => {
                    setName(value);
                    setError('');
                  }}
                  maxLength={40}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={create}
                />
              </View>
              <Button
                title="추가"
                icon={Plus}
                filled
                disabled={busy || !name.trim()}
                onPress={create}
              />
            </View>
            {!!(error || loadError) && (
              <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 13 }}>
                {error || loadError}
              </Text>
            )}
            <FlatList
              data={names}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ gap: t.spacing.xs }}
              ListHeaderComponent={
                <Button
                  title="미분류"
                  icon={selected === null ? Check : Folder}
                  selected={selected === null}
                  align="start"
                  disabled={busy}
                  onPress={() => {
                    void choose(null);
                  }}
                />
              }
              ListEmptyComponent={
                <Text style={{ color: t.secondary, fontSize: 13, padding: t.spacing.md }}>
                  새 이름을 입력해 카테고리를 추가하세요.
                </Text>
              }
              renderItem={({ item }) => (
                <Button
                  title={item}
                  icon={selected === item ? Check : Folder}
                  selected={selected === item}
                  align="start"
                  disabled={busy}
                  onPress={() => {
                    void choose(item);
                  }}
                />
              )}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
