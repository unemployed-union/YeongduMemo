import { useEffect } from 'react';
import { Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';

export function AnimatedSwitch({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
  busy = false,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  const t = useTheme();
  const progress = useSharedValue(value ? 1 : 0);
  const blocked = disabled || busy;
  const offTrack = t.line;
  const onTrack = disabled ? t.secondary : t.chromeTint;
  const offThumb = disabled ? t.switchThumbDisabled : t.switchThumbOff;
  const onThumb = disabled ? t.switchThumbDisabled : t.switchThumbOn;
  const travel = t.layout.switchThumbTravel;
  const duration = t.effects.switchDuration;

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, {
      duration,
      reduceMotion: ReduceMotion.System,
    });
  }, [value, duration, progress]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [offTrack, onTrack]),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [offThumb, onThumb]),
    transform: [{ translateX: progress.value * travel }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: blocked, busy }}
      disabled={blocked}
      onPress={() => {
        if (!blocked) {
          void Haptics.selectionAsync().catch(() => undefined);
          onValueChange(!value);
        }
      }}
      style={{
        width: t.layout.switchWidth,
        minHeight: t.layout.minTouch,
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            width: t.layout.switchWidth,
            height: t.layout.switchHeight,
            borderRadius: t.layout.switchHeight / 2,
          },
          trackStyle,
        ]}
      >
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: t.layout.switchThumbInset,
              top: t.layout.switchThumbInset,
              width: t.layout.switchThumbSize,
              height: t.layout.switchThumbSize,
              borderRadius: t.layout.switchThumbSize / 2,
              shadowColor: t.effects.switchShadowColor,
              shadowOpacity: t.effects.switchShadowOpacity,
              shadowRadius: t.effects.switchShadowRadius,
              shadowOffset: { width: 0, height: t.effects.switchShadowOffset },
              elevation: t.effects.switchElevation,
            },
            thumbStyle,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
