import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '../theme';

/** Android has no native scrollIndicatorInsets; keep its replacement above the tab bar. */
export function AndroidScrollIndicator({
  offset,
  contentHeight,
  viewportHeight,
  bottomInset,
}: {
  offset: SharedValue<number>;
  contentHeight: SharedValue<number>;
  viewportHeight: SharedValue<number>;
  bottomInset: number;
}) {
  const t = useTheme();
  const opacity = useSharedValue(0);
  const edgeInset = t.spacing.xs;
  const minimumHeight = t.layout.scrollIndicatorMinHeight;
  const activeOpacity = t.effects.scrollIndicatorOpacity;
  const fadeDelay = t.effects.scrollIndicatorFadeDelay;
  const fadeDuration = t.effects.scrollIndicatorFadeDuration;

  useEffect(() => () => cancelAnimation(opacity), [opacity]);

  useAnimatedReaction(
    () => offset.value,
    (position, previous) => {
      if (previous !== null && position !== previous) {
        opacity.value = activeOpacity;
        opacity.value = withDelay(fadeDelay, withTiming(0, { duration: fadeDuration }));
      }
    },
  );

  const indicatorStyle = useAnimatedStyle(() => {
    const viewport = viewportHeight.value;
    const content = contentHeight.value;
    const range = content - viewport;
    const track = Math.max(0, viewport - bottomInset - edgeInset * 2);
    const height =
      content > 0 ? Math.min(track, Math.max(minimumHeight, (track * viewport) / content)) : 0;
    const progress = range > 0 ? Math.min(1, Math.max(0, offset.value / range)) : 0;

    return {
      height,
      opacity: range > 1 && track > 0 ? opacity.value : 0,
      transform: [{ translateY: progress * (track - height) }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          position: 'absolute',
          top: edgeInset,
          right: edgeInset,
          width: t.layout.scrollIndicatorWidth,
          borderRadius: t.radius.pill,
          backgroundColor: t.text,
        },
        indicatorStyle,
      ]}
    />
  );
}
