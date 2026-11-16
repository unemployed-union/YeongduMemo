import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import type { LucideIcon } from 'lucide-react-native';

export function Page({
  children,
  bottomInset = true,
}: PropsWithChildren<{ bottomInset?: boolean }>) {
  const t = useTheme();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: t.background }}
      edges={bottomInset ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}
    >
      {children}
    </SafeAreaView>
  );
}

export function ScreenHeader({
  title,
  detail,
  leading,
  action,
}: {
  title: string;
  detail?: string;
  leading?: ReactNode;
  action?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: t.spacing.page,
        paddingTop: t.spacing.md,
        paddingBottom: t.spacing.md,
      }}
    >
      {leading && (
        <View style={{ alignSelf: 'flex-start', marginBottom: t.spacing.sm }}>{leading}</View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            color: t.text,
            fontSize: 38,
            lineHeight: 46,
            fontWeight: '800',
            letterSpacing: -1.6,
          }}
        >
          {title}
        </Text>
        {action}
      </View>
      {!!detail && (
        <Text style={{ color: t.secondary, fontSize: 14, lineHeight: 22, marginTop: t.spacing.xs }}>
          {detail}
        </Text>
      )}
    </View>
  );
}

export function Button({
  title,
  onPress,
  danger = false,
  filled = false,
  disabled = false,
  icon: Icon,
  iconOnly = false,
  selected,
  align = 'center',
  style,
}: {
  title: string;
  onPress: () => void;
  danger?: boolean;
  filled?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  iconOnly?: boolean;
  selected?: boolean;
  align?: 'center' | 'start';
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const color = danger ? t.danger : filled ? t.accentText : t.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: t.layout.minTouch,
          minWidth: t.layout.minTouch,
          paddingHorizontal: iconOnly ? t.spacing.sm : t.spacing.md,
          paddingVertical: t.spacing.sm,
          flexDirection: 'row',
          gap: t.spacing.sm,
          alignItems: 'center',
          justifyContent: align === 'start' ? 'flex-start' : 'center',
          borderRadius: t.radius.pill,
          backgroundColor: filled
            ? t.accent
            : selected
              ? t.accentSoft
              : pressed
                ? t.pressed
                : 'transparent',
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {Icon && <Icon size={21} color={color} strokeWidth={1.8} accessible={false} />}
      {!iconOnly && (
        <Text style={{ color, fontSize: 14, fontWeight: '700', flexShrink: 1 }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ icon: Icon, ...props }: TextInputProps & { icon?: LucideIcon }) {
  const t = useTheme();
  return (
    <View style={{ position: 'relative' }}>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
        placeholderTextColor={t.secondary}
        selectionColor={t.accent}
        style={[
          {
            backgroundColor: t.inset,
            color: t.text,
            borderRadius: t.radius.md,
            minHeight: 48,
            paddingHorizontal: t.spacing.md,
            paddingVertical: t.spacing.sm,
            fontSize: 16,
            paddingLeft: Icon ? t.spacing.xxl : t.spacing.md,
          },
          props.style,
        ]}
      />
      {Icon && (
        <View pointerEvents="none" style={{ position: 'absolute', left: t.spacing.md, top: 14 }}>
          <Icon size={20} color={t.secondary} strokeWidth={1.8} accessible={false} />
        </View>
      )}
    </View>
  );
}

export function SettingsSection({ title, children }: PropsWithChildren<{ title: string }>) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: t.spacing.lg }}>
      <Text
        accessibilityRole="header"
        style={{
          color: t.secondary,
          fontSize: 12,
          fontWeight: '800',
          letterSpacing: 1.2,
          marginBottom: t.spacing.settingsGap,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: t.surface,
          borderRadius: t.radius.settingsGroup,
          borderWidth: 1,
          borderColor: t.line,
          overflow: 'hidden',
          padding: t.spacing.settingsBody,
          gap: t.spacing.settingsGap,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function Message({
  title,
  detail,
  loading = false,
  icon: Icon,
}: {
  title: string;
  detail?: string;
  loading?: boolean;
  icon?: LucideIcon;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        padding: t.spacing.xl,
        gap: t.spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
      }}
    >
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: t.radius.lg,
          backgroundColor: t.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {loading ? (
          <ActivityIndicator color={t.accent} />
        ) : (
          Icon && <Icon size={32} color={t.accent} strokeWidth={1.6} accessible={false} />
        )}
      </View>
      <Text
        style={{
          fontSize: 23,
          fontWeight: '800',
          letterSpacing: -0.7,
          color: t.text,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {detail && (
        <Text
          style={{
            fontSize: 14,
            lineHeight: 23,
            color: t.secondary,
            textAlign: 'center',
            maxWidth: 320,
          }}
        >
          {detail}
        </Text>
      )}
    </View>
  );
}
