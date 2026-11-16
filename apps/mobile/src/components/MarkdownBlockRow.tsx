import { useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Check, Square } from 'lucide-react-native';
import type { MarkdownBlock, MarkdownSelection } from '../features/notes/markdown-blocks';
import { useTheme } from '../theme';
import { MarkdownInput } from './MarkdownInput';

export function MarkdownBlockRow({
  block,
  text,
  editable,
  selection,
  onInput,
  onFocus,
  onText,
  onSelection,
  onBackspace,
  onToggle,
  onLayout,
  placeholder,
}: {
  block: MarkdownBlock;
  text: string;
  editable: boolean;
  selection?: MarkdownSelection;
  onInput: (input: ComponentRef<typeof TextInput> | null) => void;
  onFocus: () => void;
  onText: (text: string) => void;
  onSelection: (selection: MarkdownSelection) => void;
  onBackspace: () => void;
  onToggle: () => void;
  onLayout: (position: number) => void;
  placeholder?: string;
}) {
  const t = useTheme();
  const [height, setHeight] = useState(t.layout.minTouch);
  const currentSelection = useRef({ start: 0, end: 0 });
  const code = block.kind === 'code';
  const headingSizes = [32, 28, 24, 21, 19, 17];
  const fontSize = block.kind === 'heading' ? headingSizes[block.level - 1]! : code ? 16 : 17;
  const lineHeight = Math.max(28, Math.ceil(fontSize * 1.4));
  const list = block.kind === 'bullet' || block.kind === 'ordered' || block.kind === 'task';
  return (
    <View
      onLayout={(event) => onLayout(event.nativeEvent.layout.y)}
      style={{
        marginLeft: block.depth * t.spacing.md,
        paddingLeft: block.kind === 'quote' ? t.spacing.md : 0,
        borderLeftWidth: block.kind === 'quote' ? 3 : 0,
        borderLeftColor: t.accent,
        marginTop: block.kind === 'heading' ? t.spacing.md : 0,
        ...(code
          ? {
              backgroundColor: t.code,
              borderRadius: t.radius.sm,
              padding: t.spacing.md,
              marginVertical: t.spacing.sm,
            }
          : {}),
      }}
    >
      {code && (
        <Text style={{ color: t.secondary, fontSize: 12, marginBottom: t.spacing.sm }}>
          {block.language || '코드'}
        </Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {block.kind === 'task' && (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={text || '할 일'}
            accessibilityState={{ checked: block.checked, disabled: !editable }}
            disabled={!editable}
            onPress={onToggle}
            style={{
              width: t.layout.minTouch,
              minHeight: t.layout.minTouch,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {block.checked ? (
              <Check size={22} color={t.accent} accessible={false} />
            ) : (
              <Square size={20} color={t.secondary} accessible={false} />
            )}
          </Pressable>
        )}
        {list && block.kind !== 'task' && (
          <View
            style={{
              minWidth: 28,
              minHeight: t.layout.minTouch,
              paddingTop: t.spacing.sm,
              paddingRight: t.spacing.sm,
            }}
          >
            <Text
              accessible={false}
              style={{ color: t.text, fontSize: block.kind === 'bullet' ? 23 : 17, lineHeight }}
            >
              {block.kind === 'bullet' ? '•' : block.prefix.trim().match(/\d+[.)]/)?.[0]}
            </Text>
          </View>
        )}
        <MarkdownInput
          live={!code}
          hideSyntax
          inlineOnly
          inputRef={onInput}
          value={text}
          onChangeText={onText}
          editable={editable}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          accessibilityLabel={
            block.kind === 'heading'
              ? `제목 ${block.level}`
              : list
                ? '목록 항목'
                : code
                  ? '코드 블록'
                  : '문단'
          }
          placeholder={placeholder}
          placeholderTextColor={t.secondary}
          selectionColor={t.accent}
          autoCapitalize="none"
          autoCorrect={false}
          selection={selection}
          onFocus={onFocus}
          onKeyPress={(event) => {
            if (
              event.nativeEvent.key === 'Backspace' &&
              currentSelection.current.start === 0 &&
              currentSelection.current.end === 0
            ) {
              onBackspace();
            }
          }}
          onSelectionChange={(event) => {
            currentSelection.current = event.nativeEvent.selection;
            onSelection(event.nativeEvent.selection);
          }}
          onContentSizeChange={(event) => {
            const measured = Math.max(
              t.layout.minTouch,
              Math.ceil(event.nativeEvent.contentSize.height),
            );
            setHeight((previous) => (previous === measured ? previous : measured));
          }}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: t.layout.minTouch,
            height,
            paddingHorizontal: 0,
            paddingVertical: t.spacing.sm,
            color: block.kind === 'task' && block.checked ? t.secondary : t.text,
            textDecorationLine: block.kind === 'task' && block.checked ? 'line-through' : 'none',
            fontSize,
            lineHeight,
            fontWeight: block.kind === 'heading' ? '700' : '400',
            ...(code ? { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' } : {}),
          }}
        />
      </View>
    </View>
  );
}
