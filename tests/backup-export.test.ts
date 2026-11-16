import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  active: true,
  version: 0,
  available: vi.fn(),
  backup: vi.fn(),
  share: vi.fn(),
  flush: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: class {
    uri = 'file:///cache/export.json';
    exists = true;
    constructor(...args: unknown[]) {
      native.create(...args);
    }
    write = native.write;
    delete = native.remove;
  },
}));
vi.mock('expo-sharing', () => ({ isAvailableAsync: native.available, shareAsync: native.share }));
vi.mock('../apps/mobile/src/services/attachment-transfer', () => ({
  exportAttachmentBackup: native.backup,
}));
const store = vi.hoisted(() => ({ categoryAccessVersion: () => native.version }));
vi.mock('../apps/mobile/src/services/runtime', () => ({
  flushEditors: native.flush,
  gate: { assertAccess: () => undefined },
  useRuntime: { getState: () => ({ active: native.active, unlocked: true, store }) },
}));
import { shareBackup } from '../apps/mobile/src/services/backup-export';

beforeEach(() => {
  vi.clearAllMocks();
  native.active = true;
  native.version = 0;
  native.available.mockResolvedValue(true);
  native.backup.mockResolvedValue({
    format: 'yeongdu-memo',
    version: 2,
    notes: [],
    attachments: [],
  });
  native.share.mockResolvedValue(undefined);
});
describe('backup share workflow (mocked native APIs)', () => {
  it('does not create or share a plaintext backup if access expires after export resolves', async () => {
    native.backup.mockImplementationOnce(() => {
      const exported = Promise.resolve({
        format: 'yeongdu-memo',
        version: 2,
        notes: [],
        attachments: [],
      });
      void exported.then(() => {
        native.active = false;
        native.version++;
      });
      return exported;
    });
    await expect(shareBackup()).rejects.toThrow('만료');
    expect(native.create).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
  });
  it('creates no plaintext cache when export authorization is canceled', async () => {
    native.backup.mockResolvedValueOnce(null);
    await shareBackup();
    expect(native.flush).toHaveBeenCalledOnce();
    expect(native.create).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
  });
  it('cleans the plaintext file after a failed share and retains the original error', async () => {
    const error = new Error('sharing unavailable');
    native.share.mockRejectedValueOnce(error);
    await expect(shareBackup()).rejects.toBe(error);
    expect(native.write).toHaveBeenCalledWith(
      JSON.stringify(await native.backup.mock.results[0]!.value, null, 2),
    );
    expect(native.remove).toHaveBeenCalledOnce();
  });
});
