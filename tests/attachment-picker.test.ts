import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryAccessError } from '@yeongdu/shared/src/category-access';

const native = vi.hoisted(() => ({
  picker: vi.fn(),
  filePicker: vi.fn(),
  manipulate: vi.fn(),
  resize: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  releaseImage: vi.fn(),
  releaseContext: vi.fn(),
  bytes: vi.fn(),
  getNote: vi.fn(),
  authorize: vi.fn(),
  deleted: [] as string[],
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    static pickFileAsync = native.filePicker;
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get name() {
      return 'user-photo.png';
    }
    get type() {
      return 'image/png';
    }
    get size() {
      return 4;
    }
    get exists() {
      return true;
    }
    bytes = native.bytes;
    delete() {
      native.deleted.push(this.uri);
    }
  },
}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: native.picker }));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: native.manipulate },
  SaveFormat: { PNG: 'png', JPEG: 'jpeg' },
}));
vi.mock('expo-sharing', () => ({}));
vi.mock('expo-crypto', () => ({ randomUUID: () => '10000000-0000-4000-8000-000000000001' }));
vi.mock('react-native', () => ({ Image: { getSize: async () => ({ width: 100, height: 80 }) } }));
vi.mock('../apps/mobile/src/services/encryption', () => ({
  attachmentDigest: async () => 'a'.repeat(64),
  loadNoteEncryption: vi.fn(),
}));
vi.mock('../apps/mobile/src/services/api', () => ({ ApiClient: class {} }));
vi.mock('../apps/mobile/src/services/category-protection', () => ({
  openProtectedNote: native.authorize,
}));
vi.mock('../apps/mobile/src/services/vault-access', () => ({
  waitForVaultAccess: async () => undefined,
}));
vi.mock('../apps/mobile/src/storage/secure', () => ({ readTokens: vi.fn() }));
vi.mock('../apps/mobile/src/services/runtime', () => ({
  flushEditors: async () => undefined,
  gate: { assertAccess: () => undefined },
  useRuntime: {
    getState: () => ({
      active: true,
      unlocked: true,
      store: { categoryAccessVersion: () => 0, get: native.getNote },
    }),
  },
}));
import { pickAttachment } from '../apps/mobile/src/services/attachments';

beforeEach(() => {
  vi.clearAllMocks();
  native.deleted.length = 0;
  native.getNote.mockResolvedValue({});
  native.authorize.mockResolvedValue(true);
  native.bytes.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  native.picker.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///cache/ImagePicker/source.png',
        fileName: 'source.png',
        mimeType: 'image/png',
        width: 8000,
        height: 6000,
      },
    ],
  });
  native.filePicker.mockResolvedValue({
    canceled: false,
    result: { uri: 'content://user/original.png', name: 'original.png', type: 'image/png' },
  });
  native.manipulate.mockReturnValue({
    resize: native.resize,
    renderAsync: native.render,
    release: native.releaseContext,
  });
  native.render.mockResolvedValue({ saveAsync: native.save, release: native.releaseImage });
  native.save.mockResolvedValue({
    uri: 'file:///cache/ImageManipulator/scaled.png',
    width: 2560,
    height: 1920,
  });
});

describe('image selection and resize boundary (mocked native APIs)', () => {
  it('downsamples during decode, retains aspect ratio and PNG alpha, and cleans only owned caches', async () => {
    const result = await pickAttachment('note', '2560');
    expect(native.manipulate).toHaveBeenCalledWith('file:///cache/ImagePicker/source.png', {
      maxWidth: 2560,
      maxHeight: 2560,
    });
    expect(native.resize).toHaveBeenCalledWith({ width: 2560, height: 1920 });
    expect(native.save).toHaveBeenCalledWith({ format: 'png', compress: 0.85 });
    expect(result?.file).toMatchObject({ width: 2560, height: 1920, mime: 'image/png', size: 4 });
    expect(native.deleted).toEqual([
      'file:///cache/ImagePicker/source.png',
      'file:///cache/ImageManipulator/scaled.png',
    ]);
    expect(native.releaseImage).toHaveBeenCalledOnce();
    expect(native.releaseContext).toHaveBeenCalledOnce();
  });
  it('preserves selected external files and never silently converts the original option', async () => {
    expect(await pickAttachment('note', 'file')).not.toBeNull();
    expect(native.deleted).toEqual([]);
    native.picker.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///cache/ImagePicker/original.jpg',
          fileName: 'original.jpg',
          mimeType: 'image/jpeg',
          width: 3000,
          height: 2000,
        },
      ],
    });
    expect((await pickAttachment('note', 'original'))?.file).toMatchObject({
      width: 3000,
      height: 2000,
      mime: 'image/jpeg',
    });
    expect(native.manipulate).not.toHaveBeenCalled();
    expect(native.deleted).not.toContain('content://user/original.png');
  });
  it('does not read protected file bytes when category re-authentication is canceled', async () => {
    native.getNote.mockRejectedValueOnce(new CategoryAccessError());
    native.authorize.mockResolvedValueOnce(false);
    expect(await pickAttachment('note', '2560')).toBeNull();
    expect(native.bytes).not.toHaveBeenCalled();
    expect(native.manipulate).not.toHaveBeenCalled();
  });
});
