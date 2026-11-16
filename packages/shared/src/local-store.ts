import { migrateLocalDatabase, type LocalDatabase, type SqlExecutor } from './local-database';
export type { LocalDatabase, SqlExecutor } from './local-database';
import {
  categoryNameSchema,
  noteSchema,
  operationSchema,
  type Note,
  type Operation,
  type PushResult,
} from './index';
import { encryptedOperationSchema, type EncryptedOperation } from './e2ee';
import { LocalAttachments } from './local-attachments';
import { attachmentMarkup, type Attachment, type Digest } from './attachments';
import type { BackupImportPlan } from './backup';
import { LocalBackups } from './local-backups';
import { LocalSyncState } from './local-sync-state';
import type { SyncCheckpoint, SyncContext, SyncIssue } from './sync-safety';
import {
  CategoryAccess,
  CategoryAccessError,
  categoryProtectionSchema,
  type CategoryAuthenticator,
  type CategoryDetails,
  type CategoryProtection,
  type CategoryProtections,
} from './category-access';

type PayloadRow = { payload: string };
export type NoteFilter = 'notes' | 'favorites' | 'archive' | 'trash';
// undefined selects all categories; null selects uncategorized notes.
export type CategoryFilter = string | null | undefined;
export interface SyncStore {
  syncContext(): Promise<SyncContext>;
  recordSyncCheckpoint(checkpoint: SyncCheckpoint): Promise<void>;
  blockSync(issue: SyncIssue): Promise<void>;
  pending(): Promise<Operation[]>;
  acknowledge(sent: Operation, result: PushResult): Promise<void>;
  applyRemote(notes: Note[], cursor: number, checkpoint?: SyncCheckpoint): Promise<void>;
  cursor(): Promise<number>;
}

export class LocalStore {
  private writes: Promise<unknown> = Promise.resolve();
  private categoryAccess: CategoryAccess;
  private files: LocalAttachments;
  private backups: LocalBackups;
  private syncState: LocalSyncState;
  /** Machine transport capability; never pass this interface to a screen. */
  readonly synchronization: SyncStore;
  constructor(
    private db: LocalDatabase,
    private uuid: () => string,
    private clientId: string,
    private assertAccess: () => void = () => undefined,
    authenticateCategory: CategoryAuthenticator = async () => false,
    onCategoryAccessRevoked: () => void = () => undefined,
    digestAttachment: Digest = async () => {
      throw new Error('첨부파일 무결성 검사기가 필요합니다.');
    },
  ) {
    this.files = new LocalAttachments(db, assertAccess, digestAttachment);
    this.categoryAccess = new CategoryAccess(authenticateCategory, assertAccess, () => {
      this.backups.revoke();
      onCategoryAccessRevoked();
    });
    this.syncState = new LocalSyncState(db, assertAccess, () => this.writes);
    this.backups = new LocalBackups({
      db,
      uuid,
      files: this.files,
      access: this.categoryAccess,
      assertAccess,
      settleWrites: () => this.writes,
      transaction: (task) => this.transaction(task),
      protections: (tx) => this.protections(tx),
      write: (tx, note) => this.write(tx, note),
      queue: (tx, note, revision) => this.queue(tx, note, revision),
    });
    this.synchronization = {
      syncContext: () => this.syncContext(),
      recordSyncCheckpoint: (checkpoint) => this.recordSyncCheckpoint(checkpoint),
      blockSync: (issue) => this.blockSync(issue),
      pending: () => this.pendingOperations(),
      acknowledge: (sent, result) => this.acknowledge(sent, result),
      applyRemote: (notes, cursor, checkpoint) => this.applyRemote(notes, cursor, checkpoint),
      cursor: () => this.cursor(),
    };
  }

  async syncIssue(): Promise<SyncIssue | null> {
    return this.syncState.syncIssue();
  }

  async syncContext(): Promise<SyncContext> {
    return this.syncState.syncContext();
  }

  async recordSyncCheckpoint(checkpoint: SyncCheckpoint) {
    await this.transaction((tx) => this.syncState.writeCheckpoint(tx, checkpoint));
  }

  async blockSync(issue: SyncIssue) {
    await this.transaction((tx) => this.syncState.blockSync(tx, issue));
  }

  private async protections(tx: SqlExecutor = this.db): Promise<CategoryProtections> {
    // Fetch only metadata: category menus must not transfer every Markdown body over the bridge.
    const rows = await tx.getAllAsync<{
      category: string | null;
      protection: string | null;
      protection_type: string | null;
    }>(`SELECT json_extract(payload, '$.category') AS category,
      json_extract(payload, '$.categoryProtection') AS protection,
      json_type(payload, '$.categoryProtection') AS protection_type
      FROM notes WHERE purged = 0`);
    const rules: CategoryProtections = new Map();
    for (const row of rows) {
      if (row.category === null) {
        continue;
      }
      const category = categoryNameSchema.parse(row.category);
      const protection =
        row.protection_type === null
          ? { locked: false, hidden: false }
          : categoryProtectionSchema.parse(JSON.parse(row.protection ?? 'null'));
      const previous = rules.get(category);
      rules.set(category, {
        locked: !!previous?.locked || protection.locked,
        hidden: !!previous?.hidden || protection.hidden,
      });
    }
    return rules;
  }

  private revokeChangedProtection(before: CategoryProtections, after: CategoryProtections) {
    const names = new Set([...before.keys(), ...after.keys()]);
    for (const name of names) {
      const left = before.get(name);
      const right = after.get(name);
      if (!!left?.locked !== !!right?.locked || !!left?.hidden !== !!right?.hidden) {
        this.categoryAccess.reset();
        return;
      }
    }
  }

  categoryAccessVersion() {
    return this.categoryAccess.stamp();
  }

  async canAccessCategory(name: string | null) {
    const category = name === null ? null : categoryNameSchema.parse(name);
    this.assertAccess();
    const stamp = this.categoryAccess.stamp();
    const rules = await this.protections();
    this.categoryAccess.assertCurrent(stamp);
    return this.categoryAccess.canRead(category, rules);
  }

  private assertCategory(name: string | null, rules: CategoryProtections) {
    if (!this.categoryAccess.canRead(name, rules)) {
      throw new CategoryAccessError();
    }
  }

  relockCategories() {
    this.categoryAccess.reset();
  }

  async authorizeCategoryManagement() {
    return this.categoryAccess.authorizeManagement();
  }

  endCategoryManagement() {
    this.categoryAccess.endManagement();
  }

  async unlockCategory(name: string) {
    const category = categoryNameSchema.parse(name);
    return this.categoryAccess.unlock(category);
  }

  async unlockNoteCategory(id: string) {
    this.assertAccess();
    const stamp = this.categoryAccess.stamp();
    const row = await this.db.getFirstAsync<PayloadRow>(
      'SELECT payload FROM notes WHERE id = ?',
      id,
    );
    this.categoryAccess.assertCurrent(stamp);
    const note = row ? noteSchema.parse(JSON.parse(row.payload)) : null;
    if (!note || note.category === null) {
      return false;
    }
    return this.unlockCategory(note.category);
  }

  async categorySettings(): Promise<CategoryDetails[]> {
    this.categoryAccess.assertManagement();
    const stamp = this.categoryAccess.stamp();
    await this.writes.catch(() => undefined);
    const rules = await this.protections();
    this.categoryAccess.assertCurrent(stamp);
    this.categoryAccess.assertManagement();
    return [...rules.keys()]
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .map((name) => ({
        name,
        locked: rules.get(name)?.locked ?? false,
        hidden: rules.get(name)?.hidden ?? false,
        unlocked: this.categoryAccess.isUnlocked(name),
      }));
  }

  async setCategoryProtection(name: string, protection: CategoryProtection) {
    this.categoryAccess.assertManagement();
    const stamp = this.categoryAccess.stamp();
    const category = categoryNameSchema.parse(name);
    const rule = categoryProtectionSchema.parse(protection);
    await this.transaction(async (tx) => {
      this.categoryAccess.assertCurrent(stamp);
      this.categoryAccess.assertManagement();
      const rows = await tx.getAllAsync<PayloadRow>('SELECT payload FROM notes WHERE purged = 0');
      for (const row of rows) {
        const note = noteSchema.parse(JSON.parse(row.payload));
        if (note.category !== category) {
          continue;
        }
        const queued = await tx.getFirstAsync<PayloadRow>(
          'SELECT payload FROM outbox WHERE note_id = ?',
          note.id,
        );
        const baseRevision = queued
          ? operationSchema.parse(JSON.parse(queued.payload)).baseRevision
          : note.revision;
        const changed = { ...note, categoryProtection: rule, updatedAt: new Date().toISOString() };
        await this.write(tx, changed);
        await this.queue(tx, changed, baseRevision);
      }
      this.categoryAccess.assertCurrent(stamp);
    });
    this.categoryAccess.assertCurrent(stamp);
    this.categoryAccess.reset(true);
  }

  async migrate() {
    await migrateLocalDatabase(this.db);
  }

  private transaction<T>(task: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const work = this.writes
      .catch(() => undefined)
      .then(async () => {
        this.assertAccess();
        let result!: T;
        await this.db.withExclusiveTransactionAsync(async (tx) => {
          result = await task(tx);
        });
        return result;
      });
    this.writes = work;
    return work;
  }

  private async write(tx: SqlExecutor, note: Note) {
    noteSchema.parse(note);
    await tx.runAsync(
      `INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at,
      pinned=excluded.pinned, archived=excluded.archived, favorite=excluded.favorite,
      deleted_at=excluded.deleted_at, purged=excluded.purged`,
      note.id,
      JSON.stringify(note),
      note.updatedAt,
      +note.pinned,
      +note.archived,
      +note.favorite,
      note.deletedAt,
      +note.purged,
    );
  }

  private async queue(tx: SqlExecutor, note: Note, baseRevision: number) {
    const operation: Operation = {
      operationId: this.uuid(),
      clientId: this.clientId,
      baseRevision,
      note,
    };
    // A superseded operation is no longer retried. In-flight requests keep their own body.
    await tx.runAsync(
      "DELETE FROM encrypted_outbox WHERE json_extract(payload, '$.note.id') = ?",
      note.id,
    );
    await tx.runAsync(
      'INSERT INTO outbox VALUES (?, ?) ON CONFLICT(note_id) DO UPDATE SET payload=excluded.payload',
      note.id,
      JSON.stringify(operation),
    );
  }

  async save(draft: Note): Promise<Note> {
    const stamp = this.categoryAccess.stamp();
    const result = await this.transaction((tx) => this.saveInTransaction(tx, draft, stamp));
    this.categoryAccess.assertCurrent(stamp);
    return result;
  }

  private async saveInTransaction(tx: SqlExecutor, draft: Note, stamp: number): Promise<Note> {
    const current = await tx.getFirstAsync<PayloadRow>(
      'SELECT payload FROM notes WHERE id = ?',
      draft.id,
    );
    const rules = await this.protections(tx);
    this.categoryAccess.assertCurrent(stamp);
    if (current) {
      this.assertCategory(noteSchema.parse(JSON.parse(current.payload)).category, rules);
    }
    const revision = current
      ? noteSchema.parse(JSON.parse(current.payload)).revision
      : draft.revision;
    const saved = noteSchema.parse({ ...draft, revision, updatedAt: new Date().toISOString() });
    this.assertCategory(saved.category, rules);
    // UI drafts cannot turn off protection, or carry a source category's flags to another one.
    saved.categoryProtection =
      saved.category === null
        ? { locked: false, hidden: false }
        : (rules.get(saved.category) ?? { locked: false, hidden: false });
    if (saved.purged) {
      saved.title = '';
      saved.body = '';
      saved.attachments = [];
      saved.category = null;
      saved.categoryProtection = { locked: false, hidden: false };
      saved.deletedAt ??= new Date().toISOString();
    }
    await this.write(tx, saved);
    const queued = await tx.getFirstAsync<PayloadRow>(
      'SELECT payload FROM outbox WHERE note_id = ?',
      draft.id,
    );
    const base = queued ? operationSchema.parse(JSON.parse(queued.payload)).baseRevision : revision;
    await this.queue(tx, saved, base);
    this.categoryAccess.assertCurrent(stamp);
    return saved;
  }

  async attachFile(draft: Note, file: Attachment, chunks: string[], offset: number): Promise<Note> {
    const stamp = this.categoryAccess.stamp();
    const saved = await this.transaction(async (tx) => {
      if (draft.deletedAt || draft.purged) {
        throw new Error('휴지통 메모에는 첨부할 수 없습니다.');
      }
      const position = Math.max(0, Math.min(offset, draft.body.length));
      const before = draft.body.slice(0, position);
      const after = draft.body.slice(position);
      const markup = attachmentMarkup(file);
      const body = before + (before && !before.endsWith('\n') ? '\n' : '') + markup + '\n' + after;
      const next = await this.saveInTransaction(
        tx,
        { ...draft, body, attachments: [...draft.attachments, file] },
        stamp,
      );
      await this.files.write(tx, file, chunks);
      this.categoryAccess.assertCurrent(stamp);
      return next;
    });
    return saved;
  }

  async attachmentData(noteId: string, attachmentId: string) {
    const stamp = this.categoryAccess.stamp();
    const note = await this.get(noteId);
    const file = note?.attachments.find((item) => item.id === attachmentId);
    if (!file || note?.purged) {
      throw new Error('이 메모에서 첨부파일에 접근할 수 없습니다.');
    }
    const chunks = await this.files.read(file);
    this.categoryAccess.assertCurrent(stamp);
    return { file, chunks };
  }

  /** Machine-only attachment transport, like synchronization; never expose it to UI. */
  async transportAttachment(file: Attachment) {
    return this.files.read(file);
  }

  async receiveAttachment(
    file: Attachment,
    chunks: string[],
    upload?: { manifest: { keyId: string }; chunks: string[] },
  ) {
    await this.transaction((tx) => this.files.receive(tx, file, chunks, upload));
  }

  async attachmentUpload(
    file: Attachment,
    keyId: string,
    prepare: () => Promise<unknown>,
  ): Promise<unknown> {
    return this.transaction((tx) => this.files.upload(tx, file, keyId, prepare));
  }

  async hasAttachmentUpload(id: string) {
    return this.files.hasUpload(id);
  }

  async exportBackup(ensureAvailable?: (files: Attachment[]) => Promise<void>) {
    return this.backups.exportBackup(ensureAvailable);
  }

  async get(id: string): Promise<Note | null> {
    const stamp = this.categoryAccess.stamp();
    this.assertAccess();
    await this.writes.catch(() => undefined);
    this.assertAccess();
    const row = await this.db.getFirstAsync<PayloadRow>(
      'SELECT payload FROM notes WHERE id = ?',
      id,
    );
    const rules = await this.protections();
    this.categoryAccess.assertCurrent(stamp);
    const note = row ? noteSchema.parse(JSON.parse(row.payload)) : null;
    if (note) {
      this.assertCategory(note.category, rules);
    }
    return note;
  }

  async list(filter: NoteFilter, search = '', category?: CategoryFilter): Promise<Note[]> {
    const stamp = this.categoryAccess.stamp();
    this.assertAccess();
    await this.writes.catch(() => undefined);
    this.assertAccess();
    const rows = await this.db.getAllAsync<PayloadRow>(
      'SELECT payload FROM notes WHERE purged = 0 ORDER BY pinned DESC, updated_at DESC',
    );
    const query = search.trim().toLocaleLowerCase();
    const rules = await this.protections();
    this.categoryAccess.assertCurrent(stamp);
    return rows
      .map((row) => noteSchema.parse(JSON.parse(row.payload)))
      .filter((note) => {
        if (!this.categoryAccess.canRead(note.category, rules)) {
          return false;
        }
        if (
          note.category !== null &&
          rules.get(note.category)?.hidden &&
          category !== note.category
        ) {
          return false;
        }
        if (filter === 'trash' ? !note.deletedAt : !!note.deletedAt) return false;
        if (filter === 'archive' && !note.archived) return false;
        if ((filter === 'notes' || filter === 'favorites') && note.archived) return false;
        if (filter === 'favorites' && !note.favorite) return false;
        if (category !== undefined && note.category !== category) {
          return false;
        }
        return !query || `${note.title}\n${note.body}`.toLocaleLowerCase().includes(query);
      });
  }

  async categories(): Promise<string[]> {
    this.assertAccess();
    const stamp = this.categoryAccess.stamp();
    await this.writes.catch(() => undefined);
    const rules = await this.protections();
    this.categoryAccess.assertCurrent(stamp);
    return [...rules.keys()]
      .filter((name) => this.categoryAccess.canList(name, rules))
      .sort((left, right) => left.localeCompare(right, 'ko'));
  }

  async categoryStatuses(): Promise<CategoryDetails[]> {
    const stamp = this.categoryAccess.stamp();
    const names = await this.categories();
    const rules = await this.protections();
    this.categoryAccess.assertCurrent(stamp);
    return names
      .filter((name) => this.categoryAccess.canList(name, rules))
      .map((name) => ({
        name,
        locked: rules.get(name)?.locked ?? false,
        hidden: rules.get(name)?.hidden ?? false,
        unlocked: this.categoryAccess.isUnlocked(name),
      }));
  }

  async pending(): Promise<Operation[]> {
    const stamp = this.categoryAccess.stamp();
    const operations = await this.pendingOperations();
    const rules = await this.protections();
    this.categoryAccess.assertCurrent(stamp);
    for (const operation of operations) {
      this.assertCategory(operation.note.category, rules);
    }
    return operations;
  }

  private async pendingOperations(): Promise<Operation[]> {
    this.assertAccess();
    await this.writes.catch(() => undefined);
    this.assertAccess();
    const rows = await this.db.getAllAsync<PayloadRow>(
      'SELECT payload FROM outbox ORDER BY rowid LIMIT 50',
    );
    return rows.map((row) => operationSchema.parse(JSON.parse(row.payload)));
  }

  async acknowledge(sent: Operation, result: PushResult) {
    return this.transaction(async (tx) => {
      const protectionBefore = await this.protections(tx);
      const previous = await tx.getFirstAsync<PayloadRow>(
        'SELECT payload FROM notes WHERE id = ?',
        sent.note.id,
      );
      await tx.runAsync('DELETE FROM encrypted_outbox WHERE operation_id = ?', sent.operationId);
      const row = await tx.getFirstAsync<PayloadRow>(
        'SELECT payload FROM outbox WHERE note_id = ?',
        sent.note.id,
      );
      const current = row ? operationSchema.parse(JSON.parse(row.payload)) : null;
      const editedDuringFlight = current && current.operationId !== sent.operationId;
      if (result.conflict) {
        await this.write(tx, result.canonical);
        const copy = editedDuringFlight
          ? {
              ...result.conflict,
              ...current.note,
              id: result.conflict.id,
              revision: result.conflict.revision,
              conflictOf: sent.note.id,
              title: result.conflict.title,
              deletedAt: null,
              purged: false,
              archived: false,
            }
          : result.conflict;
        await this.write(tx, copy);
        await tx.runAsync('DELETE FROM outbox WHERE note_id = ?', sent.note.id);
        if (editedDuringFlight) await this.queue(tx, copy, result.conflict.revision);
      } else if (editedDuringFlight) {
        const latest = { ...current.note, revision: result.canonical.revision };
        await this.write(tx, latest);
        await this.queue(tx, latest, result.canonical.revision);
      } else {
        await this.write(tx, result.canonical);
        await tx.runAsync('DELETE FROM outbox WHERE note_id = ?', sent.note.id);
      }
      const protectionAfter = await this.protections(tx);
      this.revokeChangedProtection(protectionBefore, protectionAfter);
      const target = result.canonical.category;
      const previousCategory = previous
        ? noteSchema.parse(JSON.parse(previous.payload)).category
        : null;
      if (previous && previousCategory !== target && target !== null) {
        const rule = protectionAfter.get(target);
        if (rule?.locked || rule?.hidden) {
          this.categoryAccess.reset();
        }
      }
    });
  }

  async applyRemote(notes: Note[], cursor: number, checkpoint?: SyncCheckpoint) {
    return this.transaction(async (tx) => {
      const protectionBefore = await this.protections(tx);
      const movedCategories: string[] = [];
      for (const remote of notes) {
        const pending = await tx.getFirstAsync<PayloadRow>(
          'SELECT payload FROM outbox WHERE note_id = ?',
          remote.id,
        );
        if (pending) continue;
        const row = await tx.getFirstAsync<PayloadRow>(
          'SELECT payload FROM notes WHERE id = ?',
          remote.id,
        );
        const existing = row ? noteSchema.parse(JSON.parse(row.payload)) : null;
        if (!existing || existing.revision < remote.revision) {
          await this.write(tx, remote);
          if (existing && existing.category !== remote.category && remote.category !== null) {
            movedCategories.push(remote.category);
          }
        }
      }
      await tx.runAsync(
        "INSERT INTO metadata VALUES ('cursor', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        String(cursor),
      );
      if (checkpoint) {
        await this.syncState.writeCheckpoint(tx, checkpoint);
      }
      const protectionAfter = await this.protections(tx);
      this.revokeChangedProtection(protectionBefore, protectionAfter);
      if (
        movedCategories.some((name) => {
          const rule = protectionAfter.get(name);
          return rule?.locked || rule?.hidden;
        })
      ) {
        this.categoryAccess.reset();
      }
    });
  }

  async cursor() {
    return this.syncState.cursor();
  }

  async encryptedOperation(
    operation: Operation,
    encrypt: () => Promise<EncryptedOperation>,
  ): Promise<EncryptedOperation> {
    return this.transaction(async (tx) => {
      const row = await tx.getFirstAsync<PayloadRow>(
        'SELECT payload FROM encrypted_outbox WHERE operation_id = ?',
        operation.operationId,
      );
      if (row) {
        return encryptedOperationSchema.parse(JSON.parse(row.payload));
      }
      const encrypted = await encrypt();
      this.assertAccess();
      await tx.runAsync(
        'INSERT INTO encrypted_outbox VALUES (?, ?)',
        operation.operationId,
        JSON.stringify(encrypted),
      );
      return encrypted;
    });
  }

  async bindAccount(identity: string) {
    return this.transaction(async (tx) => {
      const row = await tx.getFirstAsync<{ value: string }>(
        "SELECT value FROM metadata WHERE key='account'",
      );
      if (row && row.value !== identity)
        throw new Error(
          '이 DB는 다른 서버/계정에 연결되어 있습니다. 먼저 내보내기로 보관하세요. 계정 전환은 지원하지 않습니다.',
        );
      await tx.runAsync("INSERT OR IGNORE INTO metadata VALUES ('account', ?)", identity);
    });
  }

  async accountIdentity(): Promise<string | null> {
    this.assertAccess();
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM metadata WHERE key='account'",
    );
    this.assertAccess();
    return row?.value ?? null;
  }

  async prepareBackupImport(text: string): Promise<BackupImportPlan> {
    return this.backups.prepareBackupImport(text);
  }

  discardBackupImport(plan: BackupImportPlan) {
    this.backups.discardBackupImport(plan);
  }

  async importBackup(plan: BackupImportPlan): Promise<BackupImportPlan> {
    return this.backups.importBackup(plan);
  }

  async exportNotes(): Promise<Note[]> {
    const stamp = this.categoryAccess.stamp();
    this.assertAccess();
    await this.writes.catch(() => undefined);
    this.assertAccess();
    const rows = await this.db.getAllAsync<PayloadRow>(
      'SELECT payload FROM notes WHERE purged = 0',
    );
    const rules = await this.protections();
    this.categoryAccess.assertCurrent(stamp);
    return rows.map((row) => {
      const note = noteSchema.parse(JSON.parse(row.payload));
      this.assertCategory(note.category, rules);
      return note;
    });
  }

  async exportAllNotes(): Promise<Note[] | null> {
    return this.backups.exportAllNotes();
  }
}
