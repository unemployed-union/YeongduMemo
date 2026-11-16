import { createEditorMenu } from '../../features/notes/editor-menu';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Message, Page } from '../../components/ui';
import { ActionSheet } from '../../components/ActionSheet';
import { CategoryPicker } from '../../components/CategoryPicker';
import { useEditor } from '../../features/notes/useEditor';
import { useTheme } from '../../theme';
import { strings } from '../../utils/strings';
import {
  ArrowLeft,
  Check,
  CloudUpload,
  Ellipsis,
  Folder,
  LoaderCircle,
  LockKeyhole,
  Pin,
  RotateCw,
  Star,
  Image as ImageIcon,
  Paperclip,
} from 'lucide-react-native';
import { MarkdownToolbar } from '../../components/MarkdownToolbar';
import { supportsBlockEditing } from '../../features/notes/markdown-blocks';
import {
  MarkdownBlockEditor,
  type MarkdownBlockEditorHandle,
} from '../../components/MarkdownBlockEditor';
import { AttachmentCard } from '../../components/AttachmentCard';
import { removeAttachmentMarkup } from '@yeongdu/shared/src/attachments';
import type { AttachmentPickMode } from '../../services/attachments';

const copy = strings();
const statusText = {
  saved: copy.saved,
  pending: copy.pending,
  saving: copy.saving,
  error: copy.saveError,
};

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const editor = useEditor(id);
  const t = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const bodyInput = useRef<ComponentRef<typeof TextInput>>(null);
  const blockInput = useRef<MarkdownBlockEditorHandle>(null);
  const closing = useRef(false);
  const backRef = useRef<() => Promise<void>>(async () => undefined);

  async function back() {
    if (closing.current) return;
    closing.current = true;
    try {
      await editor.cleanEmpty();
      router.back();
    } catch (reason) {
      Alert.alert(
        '저장하지 못했습니다',
        `화면을 유지했습니다. 다시 시도하세요.\n${String(reason)}`,
      );
    } finally {
      closing.current = false;
    }
  }
  backRef.current = back;
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void backRef.current();
      return true;
    });
    return () => subscription.remove();
  }, []);
  if (!editor.note) {
    return (
      <Page>
        <Button title="뒤로" icon={ArrowLeft} iconOnly onPress={() => router.back()} />
        <Message title="메모 열기" detail={editor.error} loading={!editor.error} />
        {editor.categoryLocked && (
          <Button
            title="인증하고 메모 열기"
            icon={LockKeyhole}
            onPress={() => {
              void editor
                .requestAccess()
                .catch((reason) => Alert.alert('잠금 해제 실패', String(reason)));
            }}
          />
        )}
      </Page>
    );
  }
  const note = editor.note;
  const readOnly = !!note.deletedAt || note.purged;
  const editable = !readOnly && !editor.attaching;
  const liveEnabled = supportsBlockEditing(note.body);
  const saveIcon = { saved: Check, pending: CloudUpload, saving: LoaderCircle, error: RotateCw }[
    editor.status
  ];

  function insert(before: string, after: string) {
    if (liveEnabled) {
      blockInput.current?.insert(before, after);
      return;
    }
    const start = Math.min(selection.start, note.body.length);
    const end = Math.min(selection.end, note.body.length);
    editor.update({
      body:
        note.body.slice(0, start) +
        before +
        note.body.slice(start, end) +
        after +
        note.body.slice(end),
    });
    const cursor = end + before.length;
    setSelection({ start: cursor, end: cursor });
    bodyInput.current?.focus();
  }
  function removeAttachment(id: string) {
    editor.update({
      body: removeAttachmentMarkup(note.body, id),
      attachments: note.attachments.filter((file) => file.id !== id),
    });
  }
  function attach(mode: AttachmentPickMode) {
    void editor
      .attach(mode, selection.end)
      .catch((reason) =>
        Alert.alert(
          '첨부파일',
          reason instanceof Error ? reason.message : '첨부파일을 추가하지 못했습니다.',
        ),
      );
  }
  const actions = createEditorMenu(note, editor.update, back);

  return (
    <Page>
      <KeyboardAvoidingView
        style={{
          flex: 1,
          width: '100%',
          maxWidth: t.layout.editorWidth,
          alignSelf: 'center',
          backgroundColor: t.surface,
        }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingHorizontal: t.spacing.sm,
            paddingVertical: t.spacing.sm,
            alignItems: 'center',
            borderBottomWidth: 1,
            borderBottomColor: t.line,
          }}
        >
          <Button
            title="메모 목록으로"
            icon={ArrowLeft}
            iconOnly
            onPress={() => {
              void back();
            }}
          />
          <Button
            title={statusText[editor.status]}
            icon={saveIcon}
            danger={editor.status === 'error'}
            onPress={() => {
              void editor.flush().catch((reason) => Alert.alert('저장 실패', String(reason)));
            }}
          />
          {!readOnly && (
            <Button title="더보기" icon={Ellipsis} iconOnly onPress={() => setMenuOpen(true)} />
          )}
        </View>
        {note.conflictOf && (
          <Text
            style={{
              color: t.accent,
              backgroundColor: t.accentSoft,
              paddingHorizontal: t.spacing.page,
              paddingVertical: t.spacing.sm,
              fontSize: 13,
              lineHeight: 21,
            }}
          >
            충돌 사본 · 두 버전을 비교해 내용을 정리하세요.
          </Text>
        )}
        <TextInput
          value={note.title}
          onChangeText={(title) => editor.update({ title })}
          editable={editable}
          accessibilityLabel="메모 제목"
          placeholder="제목"
          placeholderTextColor={t.secondary}
          selectionColor={t.accent}
          maxLength={1000}
          style={{
            color: t.text,
            fontSize: 32,
            fontWeight: '800',
            letterSpacing: -1,
            paddingHorizontal: t.spacing.page,
            paddingTop: t.spacing.lg,
            paddingBottom: t.spacing.sm,
            minHeight: 76,
          }}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.sm,
            paddingHorizontal: t.spacing.page,
            paddingBottom: t.spacing.xs,
          }}
        >
          <Text style={{ color: t.secondary, fontSize: 12, flex: 1 }}>
            {new Date(note.updatedAt).toLocaleDateString('ko-KR', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}{' '}
            · Markdown
          </Text>
          {note.pinned && <Pin size={15} color={t.accent} accessibilityLabel="고정된 메모" />}
          {note.favorite && <Star size={15} color={t.accent} accessibilityLabel="즐겨찾기 메모" />}
        </View>
        <View style={{ paddingHorizontal: t.spacing.page, paddingBottom: t.spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`카테고리 선택: ${note.category ?? '미분류'}`}
            accessibilityState={{ disabled: !editable, expanded: categoryOpen }}
            disabled={!editable}
            onPress={() => setCategoryOpen(true)}
            style={({ pressed }) => ({
              alignSelf: 'flex-start',
              maxWidth: '100%',
              minWidth: t.layout.minTouch,
              minHeight: t.layout.minTouch,
              justifyContent: 'center',
              opacity: !editable ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.xs,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: t.spacing.xs,
                borderRadius: t.radius.pill,
                backgroundColor: t.inset,
              }}
            >
              <Folder size={16} color={t.accent} strokeWidth={1.8} accessible={false} />
              <Text
                numberOfLines={1}
                style={{ color: t.accent, fontSize: 12, fontWeight: '700', flexShrink: 1 }}
              >
                카테고리 · {note.category ?? '미분류'}
              </Text>
            </View>
          </Pressable>
        </View>
        {readOnly && (
          <Text
            style={{
              color: t.secondary,
              fontSize: 12,
              paddingHorizontal: t.spacing.page,
              paddingBottom: t.spacing.sm,
            }}
          >
            휴지통 · 읽기 전용
          </Text>
        )}
        {!readOnly && (
          <Text
            style={{
              color: t.secondary,
              fontSize: 12,
              lineHeight: 19,
              paddingHorizontal: t.spacing.page,
              paddingBottom: t.spacing.sm,
            }}
          >
            {liveEnabled
              ? '* 또는 - 뒤에 공백을 입력하면 목록이 됩니다. Enter로 이어서 작성하세요.'
              : '긴 메모는 입력 성능을 위해 Markdown 원문으로 표시합니다.'}
          </Text>
        )}
        {editor.attaching && (
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: t.accent, paddingHorizontal: t.spacing.page }}
          >
            첨부파일을 준비하는 중…
          </Text>
        )}
        {liveEnabled ? (
          <MarkdownBlockEditor
            ref={blockInput}
            value={note.body}
            onChangeText={(body) => editor.update({ body })}
            editable={editable}
            noteId={note.id}
            attachments={note.attachments}
            onRemoveAttachment={removeAttachment}
            initialSelection={selection}
            onSelectionChange={setSelection}
          />
        ) : (
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <TextInput
              ref={bodyInput}
              value={note.body}
              onChangeText={(body) => editor.update({ body })}
              editable={editable}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Markdown 본문"
              placeholder="무슨 생각을 하고 있나요?"
              placeholderTextColor={t.secondary}
              selectionColor={t.accent}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={1_000_000}
              onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
              selection={selection}
              style={{
                flex: 1,
                color: t.text,
                fontSize: 17,
                lineHeight: 28,
                paddingHorizontal: t.spacing.page,
                paddingTop: t.spacing.sm,
                paddingBottom: t.spacing.xl,
              }}
            />
            <View style={{ paddingHorizontal: t.spacing.page }}>
              {note.attachments.map((file) => (
                <AttachmentCard
                  key={file.id}
                  noteId={note.id}
                  file={file}
                  onRemove={editable ? () => removeAttachment(file.id) : undefined}
                />
              ))}
            </View>
          </ScrollView>
        )}
        {!readOnly && (
          <MarkdownToolbar
            onInsert={insert}
            onAttach={() => setAttachmentOpen(true)}
            disabled={editor.attaching}
          />
        )}
        <ActionSheet
          open={attachmentOpen && editable}
          onClose={() => setAttachmentOpen(false)}
          title="사진·파일 첨부"
          actions={[
            { title: '사진 · 긴 변 2560px로 축소', icon: ImageIcon, onPress: () => attach('2560') },
            { title: '사진 · 긴 변 1280px로 축소', icon: ImageIcon, onPress: () => attach('1280') },
            { title: '사진 · 원본 크기', icon: ImageIcon, onPress: () => attach('original') },
            { title: '파일 선택 · 최대 20MiB', icon: Paperclip, onPress: () => attach('file') },
          ]}
        />
        <ActionSheet open={menuOpen} onClose={() => setMenuOpen(false)} actions={actions} />
        {!readOnly && categoryOpen && (
          <CategoryPicker
            open={categoryOpen}
            selected={note.category}
            onSelect={(category) => editor.update({ category })}
            onClose={() => setCategoryOpen(false)}
          />
        )}
      </KeyboardAvoidingView>
    </Page>
  );
}
