import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';

export function BottomSheet({
  open,
  available,
  onClose,
  dismissLabel,
  children,
}: {
  open: boolean;
  available: boolean;
  onClose: () => void;
  dismissLabel: string;
  children: ReactNode;
}) {
  const t = useTheme();
  const [presented, setPresented] = useState(false);
  const [shown, setShown] = useState(false);
  const [height, setHeight] = useState(0);
  const progress = useSharedValue(0);
  const requested = useRef(false);
  requested.current = open && available;
  const duration = open ? t.effects.sheetOpenDuration : t.effects.sheetCloseDuration;

  const finishClose = useCallback(() => {
    // A queued completion must not dismiss a sheet that was reopened.
    if (requested.current) {
      return;
    }
    setPresented(false);
    setShown(false);
    setHeight(0);
  }, []);

  useEffect(() => {
    if (!available) {
      cancelAnimation(progress);
      progress.value = 0;
      finishClose();
      return;
    }

    if (open) {
      setPresented(true);
      // Measure before sliding so the travel is exactly the sheet's height.
      if (shown && height > 0) {
        progress.value = withTiming(1, { duration, reduceMotion: ReduceMotion.System });
      }
    } else if (presented) {
      progress.value = withTiming(
        0,
        { duration, reduceMotion: ReduceMotion.System },
        (finished) => {
          if (finished) {
            runOnJS(finishClose)();
          }
        },
      );
    }

    return () => cancelAnimation(progress);
  }, [available, open, presented, shown, height, duration, progress, finishClose]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: height > 0 ? 1 : 0,
    transform: [{ translateY: height * (1 - progress.value) }],
  }));

  return (
    <Modal
      visible={available && presented}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onShow={() => setShown(true)}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents={open ? 'auto' : 'none'}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay }, backdropStyle]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dismissLabel}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
          onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
          style={[
            {
              width: '100%',
              maxWidth: t.layout.contentWidth,
              maxHeight: '85%',
              alignSelf: 'center',
            },
            sheetStyle,
          ]}
        >
          <SafeAreaView
            edges={['bottom', 'left', 'right']}
            style={{
              backgroundColor: t.surface,
              padding: t.spacing.page,
              borderTopLeftRadius: t.radius.xl,
              borderTopRightRadius: t.radius.xl,
              flexShrink: 1,
            }}
          >
            {children}
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}
