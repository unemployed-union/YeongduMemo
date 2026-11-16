import { useEffect, useState, type ComponentRef, type RefObject } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme';

export type ChromeBlurTarget = RefObject<ComponentRef<typeof View> | null>;

export function ChromeBackdrop({ blurTarget }: { blurTarget: ChromeBlurTarget }) {
  const t = useTheme();
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let active = true;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (active) {
          setReduceTransparency(enabled);
        }
      })
      .catch(() => {
        if (active) {
          setReduceTransparency(true);
        }
      });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return (
    <View
      collapsable={false}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
    >
      {!reduceTransparency && (
        <BlurView
          blurTarget={blurTarget}
          blurMethod="dimezisBlurView"
          intensity={t.effects.chromeBlurIntensity}
          blurReductionFactor={t.effects.blurReductionFactor}
          tint={t.mode === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: reduceTransparency ? t.surface : t.tabGlass },
        ]}
      />
    </View>
  );
}
