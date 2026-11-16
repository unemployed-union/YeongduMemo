import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  active: true,
  unlocked: true,
  listeners: new Set<() => void>(),
  picker: vi.fn(),
  readText: vi.fn(),
  prepare: vi.fn(),
  flush: vi.fn(),
}));
vi.mock('expo-file-system', () => ({ File: { pickFileAsync: mock.picker } }));
vi.mock('../apps/mobile/src/services/runtime', () => ({
  gate: {
    assertAccess: () => {
      if (!mock.unlocked) {
        throw new Error('locked');
      }
    },
  },
  flushEditors: mock.flush,
  notifyChange: vi.fn(),
  synchronize: vi.fn(),
  useRuntime: {
    getState: () => ({
      active: mock.active,
      unlocked: mock.unlocked,
      store: { prepareBackupImport: mock.prepare },
    }),
    subscribe: (listener: () => void) => {
      mock.listeners.add(listener);
      return () => {
        mock.listeners.delete(listener);
      };
    },
  },
}));
import { pickBackupImport } from '../apps/mobile/src/services/backup';

beforeEach(() => {
  vi.clearAllMocks();
  mock.active = true;
  mock.unlocked = true;
  mock.listeners.clear();
  mock.readText.mockResolvedValue('backup-json');
  mock.prepare.mockResolvedValue({ imported: 1 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('backup file selection boundary (mocked native picker)', () => {
  it('waits for normal app unlock after the OS picker before reading plaintext', async () => {
    mock.picker.mockImplementationOnce(async () => {
      mock.active = false;
      mock.unlocked = false;
      return { canceled: false, result: { size: 10, text: mock.readText } };
    });
    const pending = pickBackupImport();
    await vi.waitFor(() => expect(mock.listeners.size).toBe(1));
    expect(mock.readText).not.toHaveBeenCalled();
    mock.active = true;
    mock.unlocked = true;
    for (const listener of mock.listeners) {
      listener();
    }
    expect(await pending).toEqual({ imported: 1 });
    expect(mock.prepare).toHaveBeenCalledWith('backup-json');
    expect(mock.listeners.size).toBe(0);
  });

  it('treats cancellation as no import and hides native file paths in read errors', async () => {
    mock.picker.mockResolvedValueOnce({ canceled: true });
    expect(await pickBackupImport()).toBeNull();
    expect(mock.prepare).not.toHaveBeenCalled();
    mock.readText.mockRejectedValueOnce(new Error('file:///private/secret-backup.json'));
    mock.picker.mockResolvedValueOnce({
      canceled: false,
      result: { size: 10, text: mock.readText },
    });
    await expect(pickBackupImport()).rejects.toThrow('읽을 수 없습니다');
    expect(mock.prepare).not.toHaveBeenCalled();
  });
});
