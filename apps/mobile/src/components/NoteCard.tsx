import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Folder, Pin, RotateCcw, Star, Trash2 } from 'lucide-react-native';
import type { Note } from '@yeongdu/shared';
import { useTheme } from '../theme';
import { Button } from './ui';
import { NoteIcon } from './NoteIcon';
import { markdownPreview } from '../utils/markdown';

export function NoteCard({
  note,
  onOpen,
  onRestore,
  onPurge,
}: {
  note: Note;
  onOpen: () => void;
  onRestore?: () => void;
  onPurge?: () => void;
}) {
  const t = useTheme();
  const preview = useMemo(() => markdownPreview(note.body), [note.body]);
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: t.radius.lg,
        borderWidth: 1,
        borderColor: t.line,
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${note.title || '제목 없음'} 메모 열기`}
        accessibilityHint="메모 편집 화면으로 이동합니다"
        onPress={onOpen}
        style={({ pressed }) => ({
          padding: t.spacing.md,
          gap: t.spacing.md,
          backgroundColor: pressed ? t.pressed : 'transparent',
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}>
          <NoteIcon />
          <View style={{ flex: 1, gap: t.spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  color: t.text,
                  fontSize: 17,
                  fontWeight: '700',
                  letterSpacing: -0.4,
                }}
              >
                {note.title || '제목 없음'}
              </Text>
              {note.pinned && <Pin size={15} color={t.accent} accessibilityLabel="고정된 메모" />}
              {note.favorite && (
                <Star size={15} color={t.accent} accessibilityLabel="즐겨찾기 메모" />
              )}
            </View>
            <Text numberOfLines={2} style={{ color: t.secondary, fontSize: 14, lineHeight: 21 }}>
              {preview || '내용을 추가해 보세요'}
            </Text>
            {note.category !== null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
                <Folder size={13} color={t.accent} accessible={false} />
                <Text numberOfLines={1} style={{ color: t.accent, fontSize: 12, flexShrink: 1 }}>
                  {note.category}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
          <Text style={{ flex: 1, color: t.secondary, fontSize: 11 }}>
            {new Date(note.updatedAt).toLocaleString('ko-KR', {
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
          {note.conflictOf && (
            <Text style={{ color: t.accent, fontSize: 11, fontWeight: '600' }}>충돌 사본</Text>
          )}
        </View>
      </Pressable>
      {onRestore && onPurge && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            padding: t.spacing.xs,
            borderTopWidth: 1,
            borderTopColor: t.line,
          }}
        >
          <Button title="복원" icon={RotateCcw} onPress={onRestore} />
          <Button title="영구 삭제" icon={Trash2} danger onPress={onPurge} />
        </View>
      )}
    </View>
  );
}
