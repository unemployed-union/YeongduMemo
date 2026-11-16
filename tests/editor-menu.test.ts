import { describe, expect, it, vi } from 'vitest';
import { blankNote } from '@yeongdu/shared';
import { randomUUID } from 'node:crypto';
const ui = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock('react-native', () => ({ Alert: { alert: ui.alert } }));
vi.mock('lucide-react-native', () => ({
  Archive: {},
  ArchiveRestore: {},
  Pin: {},
  PinOff: {},
  Star: {},
  StarOff: {},
  Trash2: {},
}));
import { createEditorMenu } from '../apps/mobile/src/features/notes/editor-menu';

describe('editor trash confirmation', () => {
  it('does nothing on cancel and updates the draft before requesting the existing back/flush flow', () => {
    const events: string[] = [];
    const update = vi.fn(() => {
      events.push('update');
    });
    const back = vi.fn(async () => {
      events.push('back');
    });
    const menu = createEditorMenu(blankNote(randomUUID()), update, back);
    menu.find((action) => action.danger)!.onPress();
    expect(update).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    const buttons = ui.alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    buttons.find((button) => button.text === '취소')!.onPress?.();
    expect(events).toEqual([]);
    buttons.find((button) => button.text === '삭제')!.onPress!();
    expect(events).toEqual(['update', 'back']);
    expect(update).toHaveBeenCalledWith({ deletedAt: expect.any(String) });
  });
});
