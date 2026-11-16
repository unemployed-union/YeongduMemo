import { Alert } from 'react-native';
import { Archive, ArchiveRestore, Pin, PinOff, Star, StarOff, Trash2 } from 'lucide-react-native';
import type { Note } from '@yeongdu/shared';

/** UI commands capture this rendered note, including the trash-confirmation order. */
export function createEditorMenu(
  note: Note,
  update: (patch: Partial<Note>) => void,
  back: () => Promise<void>,
) {
  return [
    {
      title: note.favorite ? '즐겨찾기 해제' : '즐겨찾기',
      icon: note.favorite ? StarOff : Star,
      onPress: () => update({ favorite: !note.favorite }),
    },
    {
      title: note.pinned ? '고정 해제' : '상단 고정',
      icon: note.pinned ? PinOff : Pin,
      onPress: () => update({ pinned: !note.pinned }),
    },
    {
      title: note.archived ? '보관 해제' : '보관함으로 이동',
      icon: note.archived ? ArchiveRestore : Archive,
      onPress: () => update({ archived: !note.archived }),
    },
    {
      title: '휴지통으로 이동',
      icon: Trash2,
      danger: true,
      onPress: () => {
        Alert.alert('메모를 삭제할까요?', '휴지통에서 복원할 수 있습니다.', [
          { text: '취소', style: 'cancel' },
          {
            text: '삭제',
            style: 'destructive',
            onPress: () => {
              update({ deletedAt: new Date().toISOString() });
              void back();
            },
          },
        ]);
      },
    },
  ];
}
