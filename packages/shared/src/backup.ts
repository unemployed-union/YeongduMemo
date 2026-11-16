import { z } from 'zod';
import { noteSchema, type CategoryProtection } from './index';
import { attachmentBackupSchema, attachmentStorageId, joinAttachment } from './attachments';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_NOTES = 10_000;
const legacyBackupSchema = z.strictObject({
  format: z.literal('yeongdu-memo'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  notes: z.array(noteSchema.strict()).max(MAX_BACKUP_NOTES),
});
const backupSchema = z.discriminatedUnion('version', [
  legacyBackupSchema,
  legacyBackupSchema.extend({
    version: z.literal(2),
    attachments: z.array(attachmentBackupSchema).max(10_000),
  }),
]);
export type MemoBackup = z.infer<typeof backupSchema>;
export interface BackupImportPlan {
  readonly imported: number;
  readonly trash: number;
  readonly protected: number;
  readonly skippedPurged: number;
  readonly existingIds: number;
  readonly renamedCategories: number;
  readonly attachments: number;
}
export class BackupImportError extends Error {}

export function parseBackupText(text: string): MemoBackup {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) {
    throw new BackupImportError(
      '백업은 50MiB까지 가져올 수 있습니다. 원본을 보관하고 파일을 나눠 주세요.',
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new BackupImportError('JSON 파일을 읽을 수 없습니다. 원본 파일을 확인해 주세요.');
  }
  const result = backupSchema.safeParse(input);
  if (!result.success) {
    const index = result.error.issues[0]?.path[1];
    const position = typeof index === 'number' ? ` (${index + 1}번째 메모)` : '';
    throw new BackupImportError(
      `지원하는 영두메모 JSON 백업 형식이 아닙니다${position}. 변경한 메모는 없습니다.`,
    );
  }
  const ids = new Set<string>();
  for (const note of result.data.notes) {
    if (ids.has(note.id)) {
      throw new BackupImportError(
        '파일 안에 중복 메모 ID가 있습니다. 원본을 보관하고 중복을 확인해 주세요.',
      );
    }
    if (
      note.category === null &&
      (note.categoryProtection.locked || note.categoryProtection.hidden)
    ) {
      throw new BackupImportError(
        '카테고리 없는 메모에 보호 설정이 있습니다. 보호 설정을 확인해 주세요.',
      );
    }
    ids.add(note.id);
  }
  const descriptors = new Map(
    result.data.notes
      .filter((note) => !note.purged)
      .flatMap((note) =>
        note.attachments.map((file) => [attachmentStorageId(file), file] as const),
      ),
  );
  const files = result.data.version === 2 ? result.data.attachments : [];
  const fileIds = new Set<string>();
  for (const file of files) {
    const descriptor = descriptors.get(file.id);
    if (!descriptor || fileIds.has(file.id)) {
      throw new BackupImportError('첨부파일 ID가 중복되었거나 메모 참조와 다릅니다.');
    }
    try {
      joinAttachment(file.chunks, descriptor.size);
    } catch {
      throw new BackupImportError('첨부파일 조각이 누락되었거나 손상되었습니다.');
    }
    fileIds.add(file.id);
  }
  if ([...descriptors.keys()].some((id) => !fileIds.has(id))) {
    throw new BackupImportError(
      '백업에 첨부파일 내용이 없습니다. 첨부파일이 포함된 백업을 사용하세요.',
    );
  }
  for (const note of result.data.notes) {
    for (const file of note.attachments) {
      if (
        descriptors.has(attachmentStorageId(file)) &&
        JSON.stringify(descriptors.get(attachmentStorageId(file))) !== JSON.stringify(file)
      ) {
        throw new BackupImportError('동일한 첨부파일 ID의 정보가 다릅니다.');
      }
    }
  }
  return result.data;
}

export function importCategories(backup: MemoBackup, current: Map<string, CategoryProtection>) {
  const names = new Map<string, string>();
  const protections = new Map<string, CategoryProtection>();
  const reserved = new Set([
    ...current.keys(),
    ...backup.notes.flatMap((note) => (note.category === null ? [] : [note.category])),
  ]);
  for (const note of backup.notes) {
    if (note.purged || note.category === null) {
      continue;
    }
    const category = note.category;
    if (!names.has(category)) {
      let target = category;
      if (current.has(category)) {
        let index = 1;
        do {
          const suffix = index === 1 ? ' (복원)' : ` (복원 ${index})`;
          const characters = Array.from(category);
          while (characters.join('').length + suffix.length > 40) {
            characters.pop();
          }
          target = characters.join('') + suffix;
          index++;
        } while (reserved.has(target));
      }
      reserved.add(target);
      names.set(category, target);
    }
    const previous = protections.get(category);
    const existing = current.get(category);
    protections.set(category, {
      locked: !!previous?.locked || !!existing?.locked || note.categoryProtection.locked,
      hidden: !!previous?.hidden || !!existing?.hidden || note.categoryProtection.hidden,
    });
  }
  return { names, protections };
}
