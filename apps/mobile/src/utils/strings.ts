const ko = {
  allNotes: '모든 메모',
  favorites: '즐겨찾기',
  archive: '보관함',
  trash: '휴지통',
  settings: '설정',
  appTitle: '영두메모',
  searchNotes: '메모 검색',
  newNote: '＋ 새 메모',
  noTitle: '제목 없음',
  saved: '저장됨',
  pending: '저장 대기',
  saving: '저장 중…',
  saveError: '저장 실패 · 다시 시도',
  edit: '편집',
  preview: '미리보기',
  more: '더보기',
};
type MessageKey = keyof typeof ko;
export type Locale = 'ko' | 'en';
const en: Record<MessageKey, string> = {
  allNotes: 'All notes',
  favorites: 'Favorites',
  archive: 'Archive',
  trash: 'Trash',
  settings: 'Settings',
  appTitle: 'YeongduMemo',
  searchNotes: 'Search notes',
  newNote: '＋ New note',
  noTitle: 'Untitled',
  saved: 'Saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saveError: 'Save failed · Retry',
  edit: 'Edit',
  preview: 'Preview',
  more: 'More',
};
export function strings(locale: Locale = 'ko'): Record<MessageKey, string> {
  return locale === 'en' ? en : ko;
}
