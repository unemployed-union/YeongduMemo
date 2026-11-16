import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { attachmentLink, type Attachment } from '@yeongdu/shared/src/attachments';
import { AttachmentCard } from './AttachmentCard';
import {
  backspaceBlockStart,
  blockText,
  editBlockText,
  insertBlockFormat,
  toggleTask,
  type BlockEdit,
  type MarkdownSelection,
} from '../features/notes/markdown-blocks';
import {
  reconcileBlockDocument,
  rowAtOffset,
  type BlockRow,
} from '../features/notes/block-document';
import { useTheme } from '../theme';
import { MarkdownBlockRow } from './MarkdownBlockRow';

export interface MarkdownBlockEditorHandle {
  insert(before: string, after: string): void;
  focus(): void;
}

export const MarkdownBlockEditor = forwardRef<
  MarkdownBlockEditorHandle,
  {
    value: string;
    onChangeText: (value: string) => void;
    editable: boolean;
    initialSelection: MarkdownSelection;
    onSelectionChange: (selection: MarkdownSelection) => void;
    noteId: string;
    attachments: Attachment[];
    onRemoveAttachment: (id: string) => void;
  }
>(function MarkdownBlockEditor(
  {
    value,
    onChangeText,
    editable,
    initialSelection,
    onSelectionChange,
    noteId,
    attachments,
    onRemoveAttachment,
  },
  ref,
) {
  const t = useTheme();
  const [document, setDocument] = useState(() => reconcileBlockDocument(value));
  const latest = useRef(document);
  const selection = useRef(initialSelection);
  const inputs = useRef(new Map<string, ComponentRef<typeof TextInput>>());
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const positions = useRef(new Map<string, number>());
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [, refreshPositions] = useState(0);
  const [focus, setFocus] = useState<{ id: string; selection: MarkdownSelection } | null>(null);

  useEffect(() => {
    if (value !== latest.current.source) {
      const next = reconcileBlockDocument(value, latest.current);
      latest.current = next;
      setDocument(next);
    }
  }, [value]);

  useLayoutEffect(() => {
    if (!focus) {
      return;
    }
    inputs.current.get(focus.id)?.focus();
    // A newly mounted empty input may already have the requested selection and emit no
    // selection event. Release control after applying it so the next keystroke can move.
    const frame = requestAnimationFrame(() => {
      const position = positions.current.get(focus.id);
      if (position !== undefined) {
        scroll.current?.scrollTo({ y: Math.max(0, position - t.spacing.lg), animated: false });
      }
      setFocus((current) => (current === focus ? null : current));
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, t.spacing.lg]);

  function requestFocus(sourceOffset: number) {
    const row = rowAtOffset(latest.current, sourceOffset);
    const cursor = Math.max(
      0,
      Math.min(
        row.block.contentEnd - row.block.contentStart,
        sourceOffset - row.block.contentStart,
      ),
    );
    setFocus({ id: row.id, selection: { start: cursor, end: cursor } });
  }

  function commit(edit: BlockEdit, moveFocus: boolean, origin?: BlockRow) {
    if (!editable) {
      return;
    }
    if (edit.source.length > 1_000_000) {
      Alert.alert('메모가 너무 깁니다', '본문은 100만 자까지 입력할 수 있습니다.');
      setDocument({ ...latest.current });
      return;
    }
    const next = reconcileBlockDocument(edit.source, latest.current);
    latest.current = next;
    selection.current = edit.selection;
    setDocument(next);
    onChangeText(edit.source);
    onSelectionChange(edit.selection);
    const target = rowAtOffset(next, edit.selection.end);
    const changedStructure =
      origin && (origin.id !== target.id || origin.block.prefix !== target.block.prefix);
    if (moveFocus || changedStructure) {
      requestFocus(edit.selection.end);
    }
  }

  useImperativeHandle(ref, () => ({
    insert(before, after) {
      commit(insertBlockFormat(latest.current.source, selection.current, before, after), true);
    },
    focus() {
      requestFocus(selection.current.end);
    },
  }));

  return (
    <ScrollView
      ref={scroll}
      onLayout={(event) =>
        setViewport((current) => ({ ...current, height: event.nativeEvent.layout.height }))
      }
      onScroll={(event) =>
        setViewport((current) => ({ ...current, top: event.nativeEvent.contentOffset.y }))
      }
      scrollEventThrottle={100}
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="interactive"
      contentContainerStyle={{ paddingHorizontal: t.spacing.page, paddingBottom: t.spacing.xxl }}
    >
      {document.rows.map(({ id, block }) => {
        const link =
          block.kind === 'paragraph' ? attachmentLink(blockText(document.source, block)) : null;
        if (link) {
          const file = attachments.find((item) => item.id === link.id);
          const y = positions.current.get(id);
          const nearby =
            y !== undefined && y + 600 >= viewport.top && y <= viewport.top + viewport.height + 200;
          return (
            <View
              key={id}
              onLayout={(event) => {
                const next = event.nativeEvent.layout.y;
                if (positions.current.get(id) !== next) {
                  positions.current.set(id, next);
                  refreshPositions((value) => value + 1);
                }
              }}
            >
              {file ? (
                <AttachmentCard
                  noteId={noteId}
                  file={file}
                  loadPreview={nearby}
                  onRemove={editable ? () => onRemoveAttachment(file.id) : undefined}
                />
              ) : (
                <Text style={{ color: t.secondary }}>첨부파일 정보를 찾을 수 없습니다.</Text>
              )}
            </View>
          );
        }
        return (
          <MarkdownBlockRow
            key={id}
            block={block}
            text={blockText(document.source, block)}
            editable={editable}
            onLayout={(position) => positions.current.set(id, position)}
            onInput={(input) => {
              if (input) {
                inputs.current.set(id, input);
              } else {
                inputs.current.delete(id);
                positions.current.delete(id);
              }
            }}
            placeholder={document.source === '' ? '무슨 생각을 하고 있나요?' : undefined}
            selection={focus?.id === id ? focus.selection : undefined}
            onFocus={() => {
              const current = latest.current.rows.find((row) => row.id === id);
              if (current) {
                const start = current.block.contentStart;
                selection.current = { start, end: start };
              }
            }}
            onSelection={(local) => {
              if (focus?.id === id) {
                if (local.start === focus.selection.start && local.end === focus.selection.end) {
                  setFocus(null);
                } else {
                  return;
                }
              }
              const current = latest.current.rows.find((row) => row.id === id);
              if (current) {
                const length = current.block.contentEnd - current.block.contentStart;
                selection.current = {
                  start: current.block.contentStart + Math.max(0, Math.min(length, local.start)),
                  end: current.block.contentStart + Math.max(0, Math.min(length, local.end)),
                };
                onSelectionChange(selection.current);
              }
            }}
            onText={(text) => {
              const current = latest.current.rows.find((row) => row.id === id);
              if (!current) {
                return;
              }
              const edit = editBlockText(latest.current.source, current.block, text);
              commit(edit, false, current);
            }}
            onBackspace={() => {
              const currentIndex = latest.current.rows.findIndex((row) => row.id === id);
              const edit = backspaceBlockStart(
                latest.current.source,
                latest.current.rows.map((row) => row.block),
                currentIndex,
              );
              if (edit) {
                commit(edit, true);
              }
            }}
            onToggle={() => {
              const current = latest.current.rows.find((row) => row.id === id);
              if (current) {
                const edit = toggleTask(latest.current.source, current.block);
                commit({ ...edit, selection: selection.current }, false);
              }
            }}
          />
        );
      })}
      {attachments
        .filter(
          (file) =>
            !document.rows.some(
              ({ block }) =>
                block.kind === 'paragraph' &&
                attachmentLink(blockText(document.source, block))?.id === file.id,
            ),
        )
        .map((file) => (
          <AttachmentCard
            key={file.id}
            noteId={noteId}
            file={file}
            onRemove={editable ? () => onRemoveAttachment(file.id) : undefined}
          />
        ))}
    </ScrollView>
  );
});
