import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronDown, Folder, LockKeyhole, Settings2, X } from 'lucide-react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { CategoryDetails } from '@yeongdu/shared/src/category-access';
import type { CategoryFilter as CategorySelection } from '@yeongdu/shared/src/local-store';
import { useTheme } from '../theme';
import { useRuntime } from '../services/runtime';
import { Button } from './ui';
import { BottomSheet } from './BottomSheet';

export function CategoryFilter({
  visible,
  categories,
  selected,
  onSelect,
  details,
  onManage,
  onRelock,
}: {
  visible: boolean;
  categories: string[];
  selected: CategorySelection;
  onSelect: (category: CategorySelection) => void;
  details: CategoryDetails[];
  onManage: () => void;
  onRelock?: () => void;
}) {
  const t = useTheme();
  const accessible = useRuntime((state) => state.active && state.unlocked);
  const [open, setOpen] = useState(false);
  const selectedLabel = selected === undefined ? '전체' : (selected ?? '미분류');
  const progress = useSharedValue(visible ? 0 : 1);
  const height = useSharedValue(t.layout.minTouch + t.spacing.sm);
  const duration = visible ? t.effects.categoryRevealDuration : t.effects.categoryHideDuration;

  useEffect(() => {
    progress.value = withTiming(visible ? 0 : 1, {
      duration,
      reduceMotion: ReduceMotion.System,
    });
    return () => cancelAnimation(progress);
  }, [visible, duration, progress]);

  const frameStyle = useAnimatedStyle(() => ({
    height: height.value * (1 - progress.value),
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: -height.value * progress.value }],
  }));

  useEffect(() => {
    if (!visible || !accessible) {
      setOpen(false);
    }
  }, [visible, accessible]);

  function select(value: CategorySelection) {
    setOpen(false);
    onSelect(value);
  }

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[{ overflow: 'hidden', flexShrink: 0 }, frameStyle]}
    >
      <Animated.View
        collapsable={false}
        onLayout={(event) => {
          const measured = event.nativeEvent.layout.height;
          if (measured > 0) {
            height.value = measured;
          }
        }}
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            paddingHorizontal: t.spacing.page,
            paddingBottom: t.spacing.sm,
          },
          contentStyle,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`카테고리: ${selectedLabel}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          style={({ pressed }) => ({
            minHeight: t.layout.minTouch,
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.sm,
            paddingHorizontal: t.spacing.md,
            borderRadius: t.radius.md,
            backgroundColor: pressed ? t.pressed : t.inset,
          })}
        >
          <Folder size={20} color={t.accent} accessible={false} />
          <Text
            numberOfLines={1}
            style={{ flex: 1, color: t.text, fontSize: 14, fontWeight: '700' }}
          >
            {selectedLabel}
          </Text>
          <ChevronDown size={20} color={t.secondary} accessible={false} />
        </Pressable>
        <BottomSheet
          open={open}
          available={visible && accessible}
          onClose={() => setOpen(false)}
          dismissLabel="카테고리 선택 닫기"
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing.sm,
              marginBottom: t.spacing.md,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ flex: 1, color: t.text, fontSize: 23, fontWeight: '800' }}
            >
              카테고리
            </Text>
            <Button title="닫기" icon={X} iconOnly onPress={() => setOpen(false)} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: t.spacing.xs }}
          >
            <Button
              title="전체"
              selected={selected === undefined}
              align="start"
              onPress={() => select(undefined)}
            />
            <Button
              title="미분류"
              selected={selected === null}
              align="start"
              onPress={() => select(null)}
            />
            {categories.map((name) => (
              <Button
                key={name}
                title={name}
                icon={
                  details.some((item) => item.name === name && item.locked && !item.unlocked)
                    ? LockKeyhole
                    : Folder
                }
                selected={selected === name}
                align="start"
                onPress={() => select(name)}
              />
            ))}
            <Button
              title="카테고리 관리"
              icon={Settings2}
              align="start"
              onPress={() => {
                setOpen(false);
                onManage();
              }}
            />
            {onRelock && (
              <Button
                title="다시 잠그기"
                icon={LockKeyhole}
                align="start"
                onPress={() => {
                  setOpen(false);
                  onRelock();
                }}
              />
            )}
          </ScrollView>
        </BottomSheet>
      </Animated.View>
    </Animated.View>
  );
}
