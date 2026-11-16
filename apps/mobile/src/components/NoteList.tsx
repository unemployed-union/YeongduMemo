import { useEffect, useRef, useState, type ComponentRef, type ReactElement } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';
import { BlurTargetView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import type { Note } from '@yeongdu/shared';
import type { NoteFilter } from '@yeongdu/shared/src/local-store';
import { useTheme } from '../theme';
import { NoteCard } from './NoteCard';
import { NoteNavigation } from './NoteNavigation';
import { AndroidScrollIndicator } from './AndroidScrollIndicator';

export function NoteList({
  header,
  notes,
  empty,
  trash,
  onOpen,
  onRestore,
  onPurge,
  selected,
  onSelect,
  showNavigation,
  categoryVisible,
  onCategoryVisibilityChange,
}: {
  header: ReactElement;
  notes: Note[];
  empty: ReactElement;
  trash: boolean;
  onOpen: (note: Note) => void;
  onRestore: (note: Note) => void;
  onPurge: (note: Note) => void;
  selected: NoteFilter;
  onSelect: (filter: NoteFilter) => void;
  showNavigation: boolean;
  categoryVisible: boolean;
  onCategoryVisibilityChange: (visible: boolean) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const blurTarget = useRef<ComponentRef<typeof View>>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const tabHeight = showNavigation ? t.layout.tabBarHeight + insets.bottom : insets.bottom;
  const scrollIndicatorBottomInset = keyboardVisible ? 0 : tabHeight;
  // Keep the final card above the navigation and its shadow.
  const navigationShadowSpace =
    !keyboardVisible && showNavigation && Platform.OS === 'android' ? t.effects.tabElevation : 0;
  const bottomSpace = scrollIndicatorBottomInset + navigationShadowSpace + t.spacing.lg;
  const offset = useSharedValue(0);
  const viewport = useSharedValue(0);
  const content = useSharedValue(0);
  const scrollAnchor = useSharedValue(0);
  const scrollViewport = useSharedValue(0);
  const categoryShown = useSharedValue(categoryVisible);
  const revealingGesture = useSharedValue(false);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    categoryShown.value = categoryVisible;
    scrollAnchor.value = offset.value;
  }, [categoryShown, categoryVisible, offset, scrollAnchor]);

  const onScroll = useAnimatedScrollHandler({
    onBeginDrag: (event) => {
      scrollAnchor.value = offset.value;
      scrollViewport.value = event.layoutMeasurement.height;
    },
    onScroll: (event) => {
      const maximum = Math.max(0, event.contentSize.height - event.layoutMeasurement.height);
      const position = Math.min(maximum, Math.max(0, event.contentOffset.y));
      offset.value = position;

      // Collapsing the category resizes the list and can adjust its scroll offset.
      // Treat that adjustment as layout, rather than a change in swipe direction.
      if (scrollViewport.value !== event.layoutMeasurement.height) {
        scrollViewport.value = event.layoutMeasurement.height;
        scrollAnchor.value = position;
        return;
      }

      const distance = position - scrollAnchor.value;
      if (position <= 1 && !categoryShown.value) {
        categoryShown.value = true;
        scrollAnchor.value = position;
        runOnJS(onCategoryVisibilityChange)(true);
      } else if (revealingGesture.value) {
        scrollAnchor.value = position;
      } else if (distance >= 24 && categoryShown.value) {
        categoryShown.value = false;
        scrollAnchor.value = position;
        runOnJS(onCategoryVisibilityChange)(false);
      } else if (distance <= -12 && !categoryShown.value) {
        categoryShown.value = true;
        scrollAnchor.value = position;
        runOnJS(onCategoryVisibilityChange)(true);
      } else if ((categoryShown.value && distance < 0) || (!categoryShown.value && distance > 0)) {
        scrollAnchor.value = position;
      }
    },
  });
  const fadeHeight = t.effects.scrollFadeHeight;
  const topStyle = useAnimatedStyle(() => {
    const height = Math.min(fadeHeight, viewport.value / 3);
    return { height, opacity: Math.min(1, Math.max(0, offset.value / Math.max(1, height))) };
  });
  const topColors = [
    t.background,
    `${t.background}D9`,
    `${t.background}80`,
    `${t.background}20`,
    `${t.background}00`,
  ] as const;
  return (
    <View style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
      {/* Keep the capture and chrome fixed to the screen while the category header resizes.
          Paint the background inside the target so Android captures it as well. */}
      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
        <View
          collapsable={false}
          style={{ flex: 1, minHeight: 0, overflow: 'hidden', backgroundColor: t.background }}
        >
          {header}
          <View style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <Animated.FlatList
              style={{ flex: 1 }}
              data={notes}
              keyExtractor={(note) => note.id}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={Platform.OS !== 'android'}
              automaticallyAdjustsScrollIndicatorInsets={false}
              scrollIndicatorInsets={{ bottom: scrollIndicatorBottomInset }}
              // Keep native stretch/rubber banding out of the glass backdrop capture.
              overScrollMode="never"
              bounces={false}
              onTouchStart={(event) => {
                touchStartY.current = event.nativeEvent.pageY;
                revealingGesture.value = false;
                scrollAnchor.value = offset.value;
              }}
              onTouchMove={(event) => {
                const startY = touchStartY.current;
                if (startY === null || event.nativeEvent.pageY - startY < 12) {
                  return;
                }

                revealingGesture.value = true;
                if (!categoryShown.value) {
                  categoryShown.value = true;
                  onCategoryVisibilityChange(true);
                }
              }}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onLayout={(event) => {
                viewport.value = event.nativeEvent.layout.height;
              }}
              onContentSizeChange={(_width, height) => {
                content.value = height;
              }}
              contentContainerStyle={{
                width: '100%',
                maxWidth: t.layout.contentWidth,
                alignSelf: 'center',
                paddingHorizontal: t.spacing.page,
                gap: t.spacing.sm,
                flexGrow: 1,
                paddingBottom: bottomSpace,
              }}
              ListEmptyComponent={empty}
              renderItem={({ item }) => (
                <NoteCard
                  note={item}
                  onOpen={() => onOpen(item)}
                  onRestore={trash ? () => onRestore(item) : undefined}
                  onPurge={trash ? () => onPurge(item) : undefined}
                />
              )}
            />
            <Animated.View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.edge, { top: 0 }, topStyle]}
            >
              <LinearGradient
                colors={topColors}
                locations={[0, 0.2, 0.5, 0.8, 1]}
                dither={false}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            {Platform.OS === 'android' && (
              <AndroidScrollIndicator
                offset={offset}
                contentHeight={content}
                viewportHeight={viewport}
                bottomInset={scrollIndicatorBottomInset}
              />
            )}
          </View>
        </View>
      </BlurTargetView>
      {!keyboardVisible && showNavigation && (
        <NoteNavigation
          selected={selected}
          onSelect={onSelect}
          blurTarget={blurTarget}
          bottomInset={insets.bottom}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ edge: { position: 'absolute', left: 0, right: 0 } });
