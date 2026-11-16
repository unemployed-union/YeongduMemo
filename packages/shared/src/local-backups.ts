import { noteSchema, type Note } from './index';
import { attachmentStorageId, type Attachment } from './attachments';
import {
  BackupImportError,
  MAX_BACKUP_BYTES,
  MAX_BACKUP_NOTES,
  importCategories,
  parseBackupText,
  type BackupImportPlan,
  type MemoBackup,
} from './backup';
import type { CategoryAccess, CategoryProtections } from './category-access';
import type { LocalAttachments } from './local-attachments';
import type { SqlExecutor } from './local-database';
type PayloadRow = { payload: string };

interface BackupContext {
  db: SqlExecutor;
  uuid: () => string;
  access: CategoryAccess;
  files: LocalAttachments;
  assertAccess: () => void;
  settleWrites: () => Promise<unknown>;
  transaction: <T>(task: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
  protections: (tx?: SqlExecutor) => Promise<CategoryProtections>;
  write: (tx: SqlExecutor, note: Note) => Promise<void>;
  queue: (tx: SqlExecutor, note: Note, baseRevision: number) => Promise<void>;
}

/** Backup authorization and one-use plans share the store's access session and writer. */
export class LocalBackups {
  private importPlans = new WeakMap<
    BackupImportPlan,
    { backup: MemoBackup; stamp: number; snapshot: string }
  >();
  constructor(private context: BackupContext) {}
  revoke() {
    this.importPlans = new WeakMap();
  }
  private async importSnapshot(tx: SqlExecutor = this.context.db) {
    const rules = await this.context.protections(tx);
    const rows = await tx.getAllAsync<{ id: string }>('SELECT id FROM notes ORDER BY id');
    const ids = new Set(rows.map((row) => row.id));
    const snapshot = JSON.stringify({
      ids: [...ids],
      rules: [...rules].sort(([a], [b]) => a.localeCompare(b)),
    });
    return { rules, ids, snapshot };
  }

  async prepareBackupImport(text: string): Promise<BackupImportPlan> {
    this.context.assertAccess();
    const backup = parseBackupText(text);
    if (backup.version === 2) {
      const descriptors = new Map(
        backup.notes.flatMap((note) =>
          note.attachments.map((file) => [attachmentStorageId(file), file] as const),
        ),
      );
      for (const file of backup.attachments) {
        await this.context.files.validate(descriptors.get(file.id)!, file.chunks);
      }
    }
    let stamp = this.context.access.stamp();
    await this.context.settleWrites().catch(() => undefined);
    const { rules, ids, snapshot } = await this.importSnapshot();
    this.context.access.assertCurrent(stamp);
    const mapping = importCategories(backup, rules);
    const requiresAuthentication = [...rules.values(), ...mapping.protections.values()].some(
      (rule) => rule.locked || rule.hidden,
    );
    if (requiresAuthentication) {
      const authorization = await this.context.access.authorize('보호된 메모 가져오기');
      if (authorization === null) {
        throw new BackupImportError('인증을 취소했습니다. 변경한 메모는 없습니다.');
      }
      stamp = authorization;
    }
    this.context.access.assertCurrent(stamp);
    const notes = backup.notes.filter((note) => !note.purged);
    const plan: BackupImportPlan = Object.freeze({
      imported: notes.length,
      trash: notes.filter((note) => note.deletedAt !== null).length,
      protected: notes.filter(
        (note) =>
          note.category !== null &&
          (mapping.protections.get(note.category)?.locked ||
            mapping.protections.get(note.category)?.hidden),
      ).length,
      skippedPurged: backup.notes.length - notes.length,
      existingIds: notes.filter((note) => ids.has(note.id)).length,
      renamedCategories: [...mapping.names].filter(([source, target]) => source !== target).length,
      attachments: backup.version === 2 ? backup.attachments.length : 0,
    });
    this.importPlans.set(plan, { backup, stamp, snapshot });
    return plan;
  }

  discardBackupImport(plan: BackupImportPlan) {
    this.importPlans.delete(plan);
  }

  async importBackup(plan: BackupImportPlan): Promise<BackupImportPlan> {
    const prepared = this.importPlans.get(plan);
    this.importPlans.delete(plan);
    if (!prepared) {
      throw new BackupImportError('가져오기 확인이 만료되었습니다. 파일을 다시 선택해 주세요.');
    }
    await this.context.transaction(async (tx) => {
      this.context.access.assertCurrent(prepared.stamp);
      const { rules, ids, snapshot } = await this.importSnapshot(tx);
      if (snapshot !== prepared.snapshot) {
        throw new BackupImportError(
          '메모 또는 카테고리가 변경되었습니다. 파일을 다시 검토해 주세요.',
        );
      }
      const mapping = importCategories(prepared.backup, rules);
      const restoredBlobIds = new Map<string, string>();
      if (prepared.backup.version === 2) {
        const existing = await tx.getAllAsync<{ id: string }>('SELECT id FROM local_attachments');
        const reserved = new Set(existing.map((row) => row.id));
        for (const file of prepared.backup.attachments) {
          let id = this.context.uuid();
          while (reserved.has(id)) {
            id = this.context.uuid();
          }
          reserved.add(id);
          restoredBlobIds.set(file.id, id);
        }
      }
      // Keep logical Markdown IDs verbatim; copies get independent immutable storage IDs.
      const notes = prepared.backup.notes
        .filter((note) => !note.purged)
        .map((note) => ({
          ...note,
          attachments: note.attachments.map((file) => ({
            ...file,
            blobId: restoredBlobIds.get(attachmentStorageId(file))!,
          })),
        }));
      if (prepared.backup.version === 2) {
        const restoredFilesByBlobId = new Map(
          notes.flatMap((note) =>
            note.attachments.map((file) => [attachmentStorageId(file), file] as const),
          ),
        );
        for (const file of prepared.backup.attachments) {
          const restoredBlobId = restoredBlobIds.get(file.id)!;
          const descriptor = restoredFilesByBlobId.get(restoredBlobId)!;
          await this.context.files.write(tx, descriptor, file.chunks);
        }
      }
      const importedIds = new Map<string, string>();
      for (const note of notes) {
        let id = this.context.uuid();
        while (ids.has(id)) {
          id = this.context.uuid();
        }
        ids.add(id);
        importedIds.set(note.id, id);
      }
      for (const note of notes) {
        const copy: Note = {
          ...note,
          id: importedIds.get(note.id)!,
          revision: 0,
          category: note.category === null ? null : mapping.names.get(note.category)!,
          categoryProtection:
            note.category === null
              ? { locked: false, hidden: false }
              : mapping.protections.get(note.category)!,
          conflictOf:
            note.conflictOf === null ? null : (importedIds.get(note.conflictOf) ?? note.conflictOf),
        };
        await this.context.write(tx, copy);
        await this.context.queue(tx, copy, 0);
      }
      this.context.access.assertCurrent(prepared.stamp);
    });
    this.context.access.reset();
    return plan;
  }

  async exportAllNotes(): Promise<Note[] | null> {
    this.context.assertAccess();
    let stamp = this.context.access.stamp();
    await this.context.settleWrites().catch(() => undefined);
    const rules = await this.context.protections();
    this.context.access.assertCurrent(stamp);
    const protectedCategories = [...rules.values()].some((rule) => rule.locked || rule.hidden);
    if (protectedCategories) {
      const authorization = await this.context.access.authorize('보호된 메모를 포함해 내보내기');
      if (authorization === null) {
        return null;
      }
      stamp = authorization;
    }
    const rows = await this.context.db.getAllAsync<PayloadRow>(
      'SELECT payload FROM notes WHERE purged = 0',
    );
    this.context.access.assertCurrent(stamp);
    return rows.map((row) => noteSchema.parse(JSON.parse(row.payload)));
  }

  async exportBackup(ensureAvailable?: (files: Attachment[]) => Promise<void>) {
    const stamp = this.context.access.stamp();
    const authorized = await this.exportAllNotes();
    if (!authorized) {
      return null;
    }
    await ensureAvailable?.(authorized.flatMap((note) => note.attachments));
    this.context.access.assertCurrent(stamp);
    const files = await this.context.files.backup(authorized.flatMap((note) => note.attachments));
    this.context.access.assertCurrent(stamp);
    const backup = {
      format: 'yeongdu-memo' as const,
      version: 2 as const,
      exportedAt: new Date().toISOString(),
      notes: authorized,
      attachments: files,
    };
    if (authorized.length > MAX_BACKUP_NOTES || files.length > 10_000) {
      throw new BackupImportError(
        'JSON 백업은 메모·첨부 각각 10,000개까지 지원합니다. 서버 DB+첨부 백업을 이용하세요.',
      );
    }
    if (new TextEncoder().encode(JSON.stringify(backup, null, 2)).length > MAX_BACKUP_BYTES) {
      throw new BackupImportError(
        '첨부를 포함한 JSON 백업이 50MiB를 넘습니다. 서버의 첨부 포함 백업을 보관하고 파일은 별도로 내보내 주세요.',
      );
    }
    return backup;
  }
}
