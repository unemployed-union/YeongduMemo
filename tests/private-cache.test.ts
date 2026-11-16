import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ files: [] as string[], removed: [] as string[] }));
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(public name: string) {}
    exists = true;
    delete() {
      native.removed.push(this.name);
    }
  },
  Directory: class {
    private name: string;
    constructor(...parts: unknown[]) {
      this.name = String(parts.at(-1));
    }
    exists = true;
    delete() {
      native.removed.push(this.name);
    }
  },
  Paths: { cache: { uri: 'file:///cache/', list: async () => [] } },
}));
import { File, Paths } from 'expo-file-system';
import {
  cleanupAttachmentCache,
  deleteOwnCache,
} from '../apps/mobile/src/storage/attachment-cache';

beforeEach(() => {
  native.files = [
    'yeongdu-memo-1794050000000.json',
    'memo-attachment-share-10000000-0000-4000-8000-000000000001.pdf',
    'user-backup.json',
    'yeongdu-memo-custom.json',
    'photo.jpg',
  ];
  native.removed.length = 0;
  vi.spyOn(Paths.cache, 'list').mockImplementation(() =>
    native.files.map((name) => new File(name)),
  );
});
describe('owned plaintext cache cleanup (mocked native filesystem)', () => {
  it('removes an interrupted JSON share on next startup while preserving unrelated files', () => {
    cleanupAttachmentCache();
    expect(native.removed).toContain('yeongdu-memo-1794050000000.json');
    expect(native.removed).toContain(
      'memo-attachment-share-10000000-0000-4000-8000-000000000001.pdf',
    );
    expect(native.removed).not.toContain('user-backup.json');
    expect(native.removed).not.toContain('yeongdu-memo-custom.json');
    expect(native.removed).not.toContain('photo.jpg');
  });
  it('does not delete selected source files outside the exact app cache directory', () => {
    deleteOwnCache('content://documents/user-photo.png');
    deleteOwnCache('file:///cache-other/user-photo.png');
    expect(native.removed).toEqual([]);
    deleteOwnCache('file:///cache/ImageManipulator/generated.png');
    expect(native.removed).toEqual(['file:///cache/ImageManipulator/generated.png']);
  });
});
