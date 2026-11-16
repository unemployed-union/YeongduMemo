import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  version: 0,
  expireAfterRead: false,
  digestDone: false,
  expiryScheduled: false,
  available: vi.fn(),
  share: vi.fn(),
  write: vi.fn(),
  save: vi.fn(),
  manipulate: vi.fn(),
  remove: vi.fn(),
  releaseImage: vi.fn(),
  releaseContext: vi.fn(),
  download: vi.fn(),
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    exists = true;
    constructor(private uri: string) {}
    write = native.write;
    delete() {
      native.remove(this.uri);
    }
  },
}));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: native.manipulate },
  SaveFormat: { PNG: 'png', JPEG: 'jpeg' },
}));
vi.mock('expo-sharing', () => ({ isAvailableAsync: native.available, shareAsync: native.share }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '10000000-0000-4000-8000-000000000002' }));
vi.mock('../apps/mobile/src/services/attachment-picker', () => ({ pickAttachment: vi.fn() }));
vi.mock('../apps/mobile/src/services/attachment-transfer', () => ({
  downloadAttachment: native.download,
  exportAttachmentBackup: vi.fn(),
}));
vi.mock('../apps/mobile/src/services/encryption', () => ({
  attachmentDigest: async () => {
    native.digestDone = true;
    return 'a'.repeat(64);
  },
}));
vi.mock('../apps/mobile/src/services/runtime', () => ({
  gate: { assertAccess: () => undefined },
  useRuntime: {
    getState: () => ({
      active: true,
      unlocked: true,
      store: {
        categoryAccessVersion: () => {
          const version = native.version;
          if (native.expireAfterRead && native.digestDone && !native.expiryScheduled) {
            native.expiryScheduled = true;
            queueMicrotask(() => {
              native.version++;
            });
          }
          return version;
        },
        attachmentData: async () => ({
          file: {
            id: '10000000-0000-4000-8000-000000000001',
            name: 'private.png',
            mime: 'image/png',
            size: 2,
            sha256: 'a'.repeat(64),
          },
          chunks: ['AQI='],
        }),
      },
    }),
  },
}));
import { attachmentPreview, shareAttachment } from '../apps/mobile/src/services/attachments';

beforeEach(() => {
  vi.clearAllMocks();
  native.version = 0;
  native.expireAfterRead = false;
  native.digestDone = false;
  native.expiryScheduled = false;
  native.available.mockResolvedValue(true);
  native.share.mockResolvedValue(undefined);
  native.save.mockResolvedValue({
    uri: 'file:///cache/ImageManipulator/preview.png',
    base64: 'UElD',
  });
  native.manipulate.mockReturnValue({
    renderAsync: async () => ({ saveAsync: native.save, release: native.releaseImage }),
    release: native.releaseContext,
  });
});
describe('preview lifetime (mocked native APIs)', () => {
  it('keeps an approved share file until the native activity ends, then cleans it even after relocking', async () => {
    let finish!: () => void;
    native.share.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const sharing = shareAttachment('note', 'file');
    await vi.waitFor(() => expect(native.share).toHaveBeenCalledOnce());
    expect(native.write).toHaveBeenCalledOnce();
    expect(native.remove).not.toHaveBeenCalled();
    native.version++;
    finish();
    await sharing;
    expect(native.remove).toHaveBeenCalledOnce();
  });
  it('does not hand off a plaintext attachment after its read authorization has expired', async () => {
    native.expireAfterRead = true;
    await expect(shareAttachment('note', 'file')).rejects.toThrow('만료');
    expect(native.write).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
  });
  it('discards an image completed after category revocation and still removes its plaintext cache', async () => {
    native.save.mockImplementationOnce(async () => {
      native.version++;
      return { uri: 'file:///cache/ImageManipulator/preview.png', base64: 'private-content' };
    });
    await expect(attachmentPreview('note', 'file')).rejects.toThrow('미리보기');
    expect(native.remove).toHaveBeenCalledWith('file:///cache/ImageManipulator/preview.png');
    expect(native.releaseImage).toHaveBeenCalledOnce();
    expect(native.releaseContext).toHaveBeenCalledOnce();
  });
  it('does not expose a native data-URI error and lets a subsequent queued request complete', async () => {
    native.manipulate.mockImplementationOnce((uri: string) => {
      throw new Error(`native failure: ${uri}`);
    });
    const first = attachmentPreview('note', 'file').catch((error: Error) => error);
    const second = attachmentPreview('note', 'file');
    const error = await first;
    expect(String(error)).not.toContain('data:image');
    expect(String(error)).not.toContain('AQI=');
    expect(await second).toBe('data:image/png;base64,UElD');
    expect(native.remove).toHaveBeenCalledOnce();
  });
});
