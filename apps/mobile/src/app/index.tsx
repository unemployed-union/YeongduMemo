import { useEffect, useState } from 'react';
import { Alert, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { blankNote, type Note } from '@yeongdu/shared';
import type {
  CategoryFilter as CategorySelection,
  NoteFilter,
} from '@yeongdu/shared/src/local-store';
import { Button, Field, Message, Page, ScreenHeader } from '../components/ui';
import { NoteList } from '../components/NoteList';
import { AppIcon } from '../components/AppIcon';
import { NoteNavigation, noteDestinations } from '../components/NoteNavigation';
import { useNotes } from '../features/notes/useNotes';
import { useNoteCategories } from '../features/notes/useNoteCategories';
import { CategoryFilter } from '../components/CategoryFilter';
import { notifyChange, relockCategories, synchronize, useRuntime } from '../services/runtime';
import { authorizeCategoryManagement, openCategory } from '../services/category-protection';
import { useTheme } from '../theme';
import {
  ArrowDownWideNarrow,
  NotebookPen,
  Search,
  Settings2,
  ShieldCheck,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react-native';

const emptyStates: Record<NoteFilter, { title: string; detail: string }> = {
  notes: {
    title: '첫 메모를 남겨보세요',
    detail: '떠오른 생각부터 오늘의 할 일까지.\n작은 기록을 차곡차곡 담아보세요.',
  },
  favorites: {
    title: '즐겨찾는 메모를 모아보세요',
    detail: '메모의 더보기 메뉴에서 별을 눌러 추가하세요.',
  },
  archive: { title: '보관함이 비어 있어요', detail: '간직하고 싶은 메모를 보관함으로 옮겨보세요.' },
  trash: { title: '휴지통이 비어 있어요', detail: '삭제한 메모가 이곳에 보관됩니다.' },
};

export default function NotesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const expanded =
    width >= t.layout.sidebarBreakpoint * Math.max(1, fontScale) &&
    height >= t.layout.sidebarMinHeight;
  const store = useRuntime((state) => state.store)!;
  const categoryVersion = useRuntime((state) => state.categoryVersion);
  const categorySession = useRuntime((state) => state.categorySession);
  const params = useLocalSearchParams<{ category?: string }>();
  const syncStatus = useRuntime((state) => state.syncStatus);
  const syncIssue = useRuntime((state) => state.syncIssue);
  const [filter, setFilter] = useState<NoteFilter>('notes');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategorySelection>(undefined);
  const [categoryVisible, setCategoryVisible] = useState(true);
  const { notes, error } = useNotes(filter, query, category);
  const { categories, details, error: categoryError } = useNoteCategories();

  useEffect(() => {
    setCategoryVisible(true);
  }, [filter, query, category]);

  async function selectCategory(value: CategorySelection) {
    try {
      if (typeof value !== 'string' || (await openCategory(value))) {
        setCategory(value);
      }
    } catch (reason) {
      Alert.alert('카테고리를 열지 못했습니다', String(reason));
    }
  }

  async function manageCategories() {
    try {
      if (await authorizeCategoryManagement()) {
        router.push('/categories');
      }
    } catch (reason) {
      Alert.alert('카테고리 관리', String(reason));
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (typeof category !== 'string') {
      return;
    }
    void store
      .canAccessCategory(category)
      .then((allowed) => {
        if (!cancelled && !allowed) {
          setCategory(undefined);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCategory(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [categoryVersion, category, store]);

  useEffect(() => {
    if (typeof params.category === 'string') {
      void selectCategory(params.category);
    }
  }, [params.category]);
  const destination = noteDestinations.find((item) => item.value === filter)!;
  const sectionTitle = filter === 'notes' ? '최근 메모' : destination.label;
  let empty = emptyStates[filter];
  if (category !== undefined) {
    empty = {
      title: '이 카테고리에 메모가 없어요',
      detail: '다른 카테고리를 선택하거나 전체 메모를 확인해 보세요.',
    };
  }
  if (query) {
    empty = { title: '검색 결과가 없어요', detail: '다른 검색어로 다시 찾아보세요.' };
  }

  async function createNote() {
    try {
      const note = await store.save({
        ...blankNote(Crypto.randomUUID()),
        category: category ?? null,
      });
      notifyChange();
      void Haptics.selectionAsync().catch(() => undefined);
      router.push({ pathname: '/note/[id]', params: { id: note.id } });
    } catch (reason) {
      Alert.alert('메모 생성 실패', String(reason));
    }
  }

  async function changeNote(note: Note, patch: Partial<Note>) {
    try {
      await store.save({ ...note, ...patch });
      notifyChange();
      void synchronize();
    } catch (reason) {
      Alert.alert('저장 실패', String(reason));
    }
  }

  function purge(note: Note) {
    Alert.alert(
      '영구 삭제할까요?',
      '이 기기와 연결된 서버의 현재 메모를 삭제합니다. 복원할 수 없습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '영구 삭제',
          style: 'destructive',
          onPress: () => {
            void changeNote(note, { purged: true, title: '', body: '' });
          },
        },
      ],
    );
  }

  return (
    <Page bottomInset={false}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {expanded && (
          <View
            style={{
              width: t.layout.sidebarWidth,
              padding: t.spacing.md,
              paddingBottom: t.spacing.md + insets.bottom,
              backgroundColor: t.surface,
              borderRightWidth: 1,
              borderRightColor: t.line,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.sm,
                padding: t.spacing.md,
                marginBottom: t.spacing.lg,
              }}
            >
              <AppIcon size={36} />
              <Text style={{ color: t.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.7 }}>
                영두메모
              </Text>
            </View>
            <NoteNavigation selected={filter} onSelect={setFilter} sidebar />
            <View style={{ flex: 1 }} />
            <Button
              title="설정"
              icon={Settings2}
              align="start"
              onPress={() => router.push('/settings')}
            />
          </View>
        )}
        <NoteList
          header={
            <View style={{ width: '100%', maxWidth: t.layout.contentWidth, alignSelf: 'center' }}>
              <ScreenHeader
                title={destination.label}
                detail="나만의 기록을, 나만의 공간에."
                action={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
                    <Button
                      title="새 메모 작성"
                      icon={SquarePen}
                      iconOnly
                      style={{ backgroundColor: t.surface }}
                      onPress={() => {
                        void createNote();
                      }}
                    />
                    <Button
                      title="설정"
                      icon={Settings2}
                      iconOnly
                      style={{ backgroundColor: t.surface }}
                      onPress={() => router.push('/settings')}
                    />
                  </View>
                }
              />
              <View
                style={{
                  paddingHorizontal: t.spacing.page,
                  gap: t.spacing.md,
                  paddingBottom: t.spacing.md,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      icon={Search}
                      placeholder="제목과 내용으로 검색"
                      value={query}
                      onChangeText={setQuery}
                      returnKeyType="search"
                      autoCorrect={false}
                    />
                  </View>
                  {!!query && (
                    <Button title="검색어 지우기" icon={X} iconOnly onPress={() => setQuery('')} />
                  )}
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: t.spacing.sm,
                  }}
                >
                  <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>
                    {query ? '검색 결과' : sectionTitle}
                    <Text style={{ color: t.secondary, fontWeight: '500' }}> {notes.length}</Text>
                  </Text>
                  <View
                    style={{
                      flex: 1,
                      minWidth: 88,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: t.spacing.xs,
                    }}
                  >
                    <ShieldCheck size={13} color={t.secondary} accessible={false} />
                    <Text
                      numberOfLines={1}
                      accessibilityLabel={syncStatus}
                      accessibilityLiveRegion="polite"
                      style={{
                        color: t.secondary,
                        fontSize: 11,
                        flexShrink: 1,
                        textAlign: 'right',
                      }}
                    >
                      {syncStatus}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
                    <ArrowDownWideNarrow size={14} color={t.secondary} accessible={false} />
                    <Text style={{ color: t.secondary, fontSize: 11 }}>고정 · 최근 수정순</Text>
                  </View>
                </View>
              </View>
              <CategoryFilter
                visible={categoryVisible}
                categories={categories}
                details={details}
                selected={category}
                onSelect={(value) => {
                  void selectCategory(value);
                }}
                onManage={() => {
                  void manageCategories();
                }}
                onRelock={categorySession ? relockCategories : undefined}
              />
              {syncIssue && (
                <Button title="동기화 중단 · 복구 안내" onPress={() => router.push('/settings')} />
              )}
            </View>
          }
          notes={notes}
          selected={filter}
          onSelect={setFilter}
          showNavigation={!expanded}
          categoryVisible={categoryVisible}
          onCategoryVisibilityChange={setCategoryVisible}
          trash={filter === 'trash'}
          empty={
            <Message
              icon={filter === 'trash' ? Trash2 : query ? Search : NotebookPen}
              title={empty.title}
              detail={error || categoryError || empty.detail}
            />
          }
          onOpen={(note) => router.push({ pathname: '/note/[id]', params: { id: note.id } })}
          onRestore={(note) => {
            void changeNote(note, { deletedAt: null });
          }}
          onPurge={purge}
        />
      </View>
    </Page>
  );
}
