import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import { encodeBytes, joinAttachment, type Attachment } from '@yeongdu/shared/src/attachments';
import { SyncSafetyError } from '@yeongdu/shared/src/sync-safety';
import { CategoryAccessError } from '@yeongdu/shared/src/category-access';
import { attachmentDigest } from './encryption';
import { useRuntime } from './runtime';
import { assertVisible } from './attachment-access';
import { downloadAttachment } from './attachment-transfer';
import { deleteOwnCache } from '../storage/attachment-cache';
export { pickAttachment, type AttachmentPickMode } from './attachment-picker';
export { exportAttachmentBackup } from './attachment-transfer';

export function canPreviewImage(file: Attachment) {
  return [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/avif',
  ].includes(file.mime.toLowerCase());
}

export async function readAttachment(noteId: string, id: string) {
  const store = useRuntime.getState().store!;
  const version = store.categoryAccessVersion();
  assertVisible(version);
  let result = await store.attachmentData(noteId, id);
  if (!result.chunks) {
    await downloadAttachment(result.file);
    result = await store.attachmentData(noteId, id);
  }
  const bytes = joinAttachment(result.chunks!, result.file.size);
  if ((await attachmentDigest(bytes)) !== result.file.sha256) {
    throw new Error('첨부파일 무결성 검사를 통과하지 못했습니다.');
  }
  assertVisible(version);
  return { file: result.file, bytes };
}

let previewQueue: Promise<void> = Promise.resolve();

export function attachmentPreview(
  noteId: string,
  id: string,
  stillWanted: () => boolean = () => true,
): Promise<string> {
  const request = previewQueue
    .catch(() => undefined)
    .then(async () => {
      if (!stillWanted()) {
        throw new Error('이미지 미리보기를 취소했습니다.');
      }
      const version = useRuntime.getState().store!.categoryAccessVersion();
      assertVisible(version);
      const result = await readAttachment(noteId, id);
      if (!stillWanted()) {
        throw new Error('이미지 미리보기를 취소했습니다.');
      }
      const context = ImageManipulator.manipulate(
        `data:${result.file.mime};base64,${encodeBytes(result.bytes)}`,
        { maxWidth: 1024, maxHeight: 1024 },
      );
      let temporary: string | undefined;
      try {
        const rendered = await context.renderAsync();
        try {
          const png = result.file.mime === 'image/png';
          const preview = await rendered.saveAsync({
            format: png ? SaveFormat.PNG : SaveFormat.JPEG,
            compress: 0.75,
            base64: true,
          });
          temporary = preview.uri;
          assertVisible(version);
          if (!preview.base64) {
            throw new Error('이미지 미리보기를 만들지 못했습니다.');
          }
          return `data:image/${png ? 'png' : 'jpeg'};base64,${preview.base64}`;
        } finally {
          rendered.release();
        }
      } finally {
        context.release();
        if (temporary) {
          deleteOwnCache(temporary);
        }
      }
    })
    .catch((error: unknown) => {
      if (error instanceof SyncSafetyError || error instanceof CategoryAccessError) {
        throw error;
      }
      // Native image errors may contain the supplied data URI. Never surface that payload.
      throw new Error(
        '이미지 미리보기를 만들지 못했습니다. 서버 연결·이미지 형식·앱 빌드를 확인하거나 파일로 열어 주세요.',
      );
    });
  // Keep only queue completion, never a fulfilled promise containing plaintext image data.
  previewQueue = request.then(
    () => undefined,
    () => undefined,
  );
  return request;
}

export async function shareAttachment(noteId: string, id: string) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('이 기기에서 파일 열기·공유를 지원하지 않습니다.');
  }
  const version = useRuntime.getState().store!.categoryAccessVersion();
  const result = await readAttachment(noteId, id);
  assertVisible(version);
  const suffix = result.file.name.match(/\.[a-z0-9]{1,10}$/i)?.[0] ?? '';
  const file = new File(Paths.cache, `memo-attachment-share-${Crypto.randomUUID()}${suffix}`);
  try {
    file.write(result.bytes);
    await Sharing.shareAsync(file.uri, {
      mimeType: result.file.mime,
      dialogTitle: result.file.name,
    });
  } finally {
    if (file.exists) {
      file.delete();
    }
  }
}
