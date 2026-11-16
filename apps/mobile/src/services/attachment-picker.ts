import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { Image } from 'react-native';
import {
  attachmentSchema,
  MAX_ATTACHMENT_BYTES,
  resizedDimensions,
  splitAttachment,
} from '@yeongdu/shared/src/attachments';
import { CategoryAccessError } from '@yeongdu/shared/src/category-access';
import { attachmentDigest } from './encryption';
import { openProtectedNote } from './category-protection';
import { waitForVaultAccess } from './vault-access';
import { flushEditors, gate, useRuntime } from './runtime';
import { assertVisible } from './attachment-access';
import { deleteOwnCache } from '../storage/attachment-cache';
export type AttachmentPickMode = 'file' | 'original' | '2560' | '1280';

export async function pickAttachment(noteId: string, mode: AttachmentPickMode) {
  await flushEditors();
  gate.assertAccess();
  let uri: string;
  let name: string;
  let mime: string;
  let width: number | undefined;
  let height: number | undefined;
  const cleanup: string[] = [];
  try {
    if (mode === 'file') {
      const result = await File.pickFileAsync({ multipleFiles: false });
      if (result.canceled) {
        return null;
      }
      uri = result.result.uri;
      name = result.result.name;
      mime = result.result.type || 'application/octet-stream';
    } else {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        exif: false,
      });
      if (result.canceled) {
        return null;
      }
      const image = result.assets[0]!;
      uri = image.uri;
      cleanup.push(uri);
      name = image.fileName ?? 'image.jpg';
      mime = image.mimeType ?? 'image/jpeg';
      width = image.width;
      height = image.height;
    }
    await waitForVaultAccess();
    const store = useRuntime.getState().store!;
    try {
      await store.get(noteId);
    } catch (error) {
      if (!(error instanceof CategoryAccessError)) {
        throw error;
      }
      if (!(await openProtectedNote(noteId))) {
        return null;
      }
    }
    const version = store.categoryAccessVersion();
    await store.get(noteId);
    assertVisible(version);
    if (mode === '2560' || mode === '1280') {
      const edge = Number(mode);
      const context = ImageManipulator.manipulate(uri, { maxWidth: edge, maxHeight: edge });
      try {
        const target = resizedDimensions(width!, height!, edge);
        context.resize(target);
        const rendered = await context.renderAsync();
        try {
          const png = mime === 'image/png';
          const image = await rendered.saveAsync({
            format: png ? SaveFormat.PNG : SaveFormat.JPEG,
            compress: 0.85,
          });
          uri = image.uri;
          cleanup.push(uri);
          width = image.width;
          height = image.height;
          mime = png ? 'image/png' : 'image/jpeg';
          name = name.replace(/\.[^.]+$/, '') + (png ? '.png' : '.jpg');
        } finally {
          rendered.release();
        }
      } finally {
        context.release();
      }
    } else if (mime.startsWith('image/') && (!width || !height)) {
      try {
        const size = await Image.getSize(uri);
        width = size.width;
        height = size.height;
      } catch {
        /* Unsupported image formats remain downloadable file cards. */
      }
    }
    assertVisible(version);
    if (width && height && width * height > 40_000_000) {
      throw new Error(
        '원본 이미지가 너무 큽니다. 사진 메뉴의 2560px 또는 1280px 축소 옵션을 선택하세요.',
      );
    }
    const file = new File(uri);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('첨부파일은 20MiB까지 지원합니다. 이미지는 축소 옵션을 선택하세요.');
    }
    const bytes = await file.bytes();
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Error('첨부파일은 20MiB까지 지원합니다.');
    }
    const safeName =
      Array.from(name, (character) => (character.charCodeAt(0) < 32 ? '_' : character))
        .join('')
        .slice(0, 255) || 'attachment';
    const descriptor = attachmentSchema.parse({
      id: Crypto.randomUUID(),
      name: safeName,
      mime: mime.toLowerCase(),
      size: bytes.length,
      sha256: await attachmentDigest(bytes),
      ...(width && height ? { width, height } : {}),
    });
    assertVisible(version);
    return { file: descriptor, chunks: splitAttachment(bytes) };
  } catch (error) {
    if (
      error instanceof Error &&
      /^(첨부파일|원본 이미지|첨부파일 접근|기기 설정|보호된 카테고리)/.test(error.message)
    ) {
      throw error;
    }
    throw new Error(
      '파일 선택 또는 이미지 처리에 실패했습니다. 파일 형식과 앱의 네이티브 빌드를 확인하세요.',
    );
  } finally {
    for (const cached of new Set(cleanup)) {
      deleteOwnCache(cached);
    }
  }
}
