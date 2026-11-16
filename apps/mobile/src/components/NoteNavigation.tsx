import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { PlatformPressable } from 'expo-router/react-navigation';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Archive, FileText, Star, Trash2 } from 'lucide-react-native';
import type { NoteFilter } from '@yeongdu/shared/src/local-store';
import { useTheme } from '../theme';
import { ChromeBackdrop, type ChromeBlurTarget } from './ChromeBackdrop';

export const noteDestinations = [
  { value: 'notes', label: '메모', icon: FileText, tabIcon: 'document-text' },
  { value: 'favorites', label: '즐겨찾기', icon: Star, tabIcon: 'star' },
  { value: 'archive', label: '보관함', icon: Archive, tabIcon: 'archive' },
  { value: 'trash', label: '휴지통', icon: Trash2, tabIcon: 'trash' },
] as const;

type NoteSelection = {
  selected: NoteFilter;
  onSelect: (value: NoteFilter) => void;
};

type NoteTabBarProps = NoteSelection & {
  blurTarget: ChromeBlurTarget;
  bottomInset: number;
};

type NoteNavigationProps =
  (NoteSelection & { sidebar: true }) | (NoteTabBarProps & { sidebar?: false });

export function NoteNavigation(props: NoteNavigationProps) {
  if (props.sidebar) {
    return <NoteSidebar selected={props.selected} onSelect={props.onSelect} />;
  }
  return <NoteTabBar {...props} />;
}

function NoteTabBar({ selected, onSelect, blurTarget, bottomInset }: NoteTabBarProps) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const horizontal = width >= t.layout.tabHorizontalBreakpoint || width > height;
  const compact = Platform.OS === 'ios' && !Platform.isPad && width > height && horizontal;
  const iconSize = compact ? t.layout.tabCompactIconSize : t.layout.tabIconSize;
  const iconWidth = compact ? t.layout.tabCompactIconWidth : t.layout.tabIconWidth;
  const iconHeight = compact ? t.layout.tabCompactIconHeight : t.layout.tabIconHeight;

  return (
    <View
      collapsable={false}
      role="tablist"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: t.layout.tabBarHeight + bottomInset,
        paddingTop: t.spacing.sm,
        paddingBottom: Math.max(bottomInset, t.spacing.sm),
        flexDirection: 'row',
        backgroundColor: 'transparent',
        overflow: 'hidden',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: t.chromeBorder,
        elevation: t.effects.tabElevation,
      }}
    >
      <ChromeBackdrop blurTarget={blurTarget} />
      {noteDestinations.map(({ value, label, tabIcon }) => {
        const active = selected === value;
        const color = active ? t.chromeTint : t.chromeMuted;
        return (
          <PlatformPressable
            key={value}
            role={Platform.OS === 'ios' ? 'button' : 'tab'}
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            pressOpacity={1}
            pressColor={t.tabRipple}
            android_ripple={{ borderless: true }}
            onPress={() => onSelect(value)}
            style={{
              flex: 1,
              minWidth: t.layout.minTouch,
              minHeight: t.layout.minTouch,
              padding: t.spacing.tabItem,
              borderRadius: t.radius.sm,
              borderCurve: 'continuous',
              flexDirection: horizontal ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: horizontal ? 'center' : 'flex-start',
              backgroundColor: 'transparent',
            }}
          >
            <View
              style={{
                width: iconWidth,
                height: iconHeight,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={active ? tabIcon : `${tabIcon}-outline`}
                size={iconSize}
                color={color}
                accessible={false}
              />
            </View>
            <Text
              numberOfLines={1}
              allowFontScaling={Platform.OS !== 'ios'}
              style={{
                color,
                fontSize: 11,
                fontWeight: '700',
                marginStart: horizontal ? t.spacing.tabItem : 0,
                marginEnd: horizontal ? t.spacing.tabLabelTrailing : 0,
                lineHeight: horizontal ? t.spacing.lg : undefined,
              }}
            >
              {label}
            </Text>
          </PlatformPressable>
        );
      })}
    </View>
  );
}

function NoteSidebar({ selected, onSelect }: NoteSelection) {
  const t = useTheme();
  return (
    <View role="tablist" style={{ gap: t.spacing.xs, padding: t.spacing.sm }}>
      {noteDestinations.map(({ value, label, icon: Icon }) => {
        const active = selected === value;
        const color = active ? t.accent : t.secondary;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(value)}
            style={({ pressed }) => ({
              minHeight: 52,
              minWidth: t.layout.minTouch,
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing.md,
              padding: t.spacing.sm,
              borderRadius: t.radius.md,
              backgroundColor: active ? t.accentSoft : pressed ? t.pressed : 'transparent',
            })}
          >
            <Icon size={22} color={color} strokeWidth={active ? 2.2 : 1.8} accessible={false} />
            <Text
              numberOfLines={1}
              style={{ color, fontSize: 15, fontWeight: active ? '700' : '500' }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
