import { Pressable, Text } from 'react-native';
import { useTheme } from '../theme';

export function SettingsButton({
  title,
  onPress,
  selected,
  filled = false,
  disabled = false,
  align = 'center',
}: {
  title: string;
  onPress: () => void;
  selected?: boolean;
  filled?: boolean;
  disabled?: boolean;
  align?: 'center' | 'start';
}) {
  const t = useTheme();
  const choice = selected !== undefined;
  const active = selected === true || filled;
  const inactiveText = choice ? t.text : t.chromeTint;
  const color = active ? t.settingsAccentText : inactiveText;
  let backgroundColor = 'transparent';
  if (active) {
    backgroundColor = t.chromeTint;
  } else if (choice) {
    backgroundColor = t.background;
  }

  return (
    <Pressable
      accessibilityRole={choice ? 'radio' : 'button'}
      accessibilityLabel={title}
      accessibilityState={{ disabled, ...(choice && { checked: selected }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: choice ? 1 : 0,
        flexShrink: 1,
        minHeight: t.layout.minTouch,
        minWidth: t.layout.minTouch,
        paddingHorizontal: t.spacing.settingsGap,
        paddingVertical: t.spacing.sm,
        alignItems: align === 'start' ? 'flex-start' : 'center',
        justifyContent: 'center',
        borderRadius: choice ? t.radius.settingsChoice : t.radius.settingsAction,
        borderWidth: 1,
        borderColor: active ? t.chromeTint : t.line,
        backgroundColor,
        opacity: disabled ? 0.5 : pressed ? 0.55 : 1,
      })}
    >
      <Text style={{ color, fontSize: 14, fontWeight: '700', flexShrink: 1 }}>{title}</Text>
    </Pressable>
  );
}
