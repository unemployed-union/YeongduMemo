import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './ui';
import { useTheme } from '../theme';
import { useRuntime } from '../services/runtime';
import { FileText, X, type LucideIcon } from 'lucide-react-native';

export function ActionSheet({
  open,
  onClose,
  actions,
  title = '메모 관리',
}: {
  open: boolean;
  onClose: () => void;
  actions: { title: string; onPress: () => void; danger?: boolean; icon?: LucideIcon }[];
  title?: string;
}) {
  const t = useTheme();
  const visible = useRuntime((state) => state.active && state.unlocked);
  return (
    <Modal visible={open && visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: t.overlay }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="메모 관리 닫기"
          onPress={onClose}
          style={{ flex: 1, minHeight: t.layout.minTouch }}
        />
        <SafeAreaView
          edges={['bottom', 'left', 'right']}
          style={{
            backgroundColor: t.surface,
            padding: t.spacing.page,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            width: '100%',
            maxWidth: t.layout.contentWidth,
            alignSelf: 'center',
            maxHeight: '85%',
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: t.radius.pill,
              backgroundColor: t.line,
              alignSelf: 'center',
              marginBottom: t.spacing.lg,
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing.sm,
              marginBottom: t.spacing.md,
            }}
          >
            <FileText size={22} color={t.accent} accessible={false} />
            <Text
              accessibilityRole="header"
              style={{
                flex: 1,
                color: t.text,
                fontSize: 23,
                fontWeight: '800',
                letterSpacing: -0.6,
              }}
            >
              {title}
            </Text>
            <Button title="닫기" icon={X} iconOnly onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ gap: t.spacing.xs }}>
            {actions.map((action) => (
              <Button
                key={action.title}
                title={action.title}
                danger={action.danger}
                icon={action.icon}
                align="start"
                style={{ borderRadius: t.radius.md, minHeight: 52, backgroundColor: t.background }}
                onPress={() => {
                  onClose();
                  action.onPress();
                }}
              />
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
