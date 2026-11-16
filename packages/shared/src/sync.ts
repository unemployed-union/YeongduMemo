import { pullResponseSchema, pushResponseSchema, type Operation } from './index';
import type { SyncStore } from './local-store';
import {
  assertCheckpointProgress,
  checkpointSchema,
  SyncSafetyError,
  type SyncCheckpoint,
  type SyncContext,
} from './sync-safety';

export interface SyncTransport {
  checkpoint(context: SyncContext): Promise<unknown>;
  push(operations: Operation[], witness: SyncCheckpoint): Promise<unknown>;
  pull(cursor: number, witness: SyncCheckpoint): Promise<unknown>;
}

export async function verifySyncStart(
  local: SyncStore,
  check: (context: SyncContext) => Promise<unknown>,
) {
  try {
    const context = await local.syncContext();
    if (!context.witness && (context.cursor > 0 || context.knownRevision > 0)) {
      throw new SyncSafetyError('legacy_checkpoint_required');
    }
    const witness = checkpointSchema.parse(await check(context));
    assertCheckpointProgress(
      context.witness,
      witness,
      Math.max(context.cursor, context.knownRevision),
    );
    await local.recordSyncCheckpoint(witness);
    return witness;
  } catch (error) {
    if (error instanceof SyncSafetyError && error.code !== 'protocol_upgrade_required') {
      await local.blockSync(error.code);
    }
    throw error;
  }
}
export class SyncService {
  private running: Promise<void> | null = null;
  constructor(
    private local: SyncStore,
    private transport: SyncTransport,
  ) {}

  sync(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run() {
    try {
      await this.runChecked();
    } catch (error) {
      if (error instanceof SyncSafetyError && error.code !== 'protocol_upgrade_required') {
        await this.local.blockSync(error.code);
      }
      throw error;
    }
  }

  private async runChecked() {
    let witness = await verifySyncStart(this.local, (context) =>
      this.transport.checkpoint(context),
    );
    // Bound each run; new keystrokes cannot keep a foreground sync alive indefinitely.
    for (let batch = 0; batch < 20; batch++) {
      const pending = await this.local.pending();
      if (!pending.length) break;
      const response = pushResponseSchema
        .extend({ checkpoint: checkpointSchema })
        .parse(await this.transport.push(pending, witness));
      assertCheckpointProgress(witness, response.checkpoint);
      if (response.results.length !== pending.length) throw new Error('동기화 응답 누락');
      const revision = Math.max(
        ...response.results.flatMap((result) => [
          result.canonical.revision,
          result.conflict?.revision ?? 0,
        ]),
      );
      assertCheckpointProgress(witness, response.checkpoint, revision);
      await this.local.recordSyncCheckpoint(response.checkpoint);
      witness = response.checkpoint;
      for (const operation of pending) {
        const result = response.results.find((item) => item.operationId === operation.operationId);
        if (!result || result.canonical.id !== operation.note.id)
          throw new Error('동기화 응답 ID 불일치');
        await this.local.acknowledge(operation, result);
      }
    }
    let more = true;
    while (more) {
      const cursor = await this.local.cursor();
      const page = pullResponseSchema
        .extend({ checkpoint: checkpointSchema })
        .parse(await this.transport.pull(cursor, witness));
      assertCheckpointProgress(
        witness,
        page.checkpoint,
        Math.max(cursor, ...page.notes.map((note) => note.revision)),
      );
      if (page.cursor < cursor || (page.hasMore && page.cursor === cursor))
        throw new Error('잘못된 동기화 cursor');
      if (
        page.cursor > page.checkpoint.head ||
        (!page.hasMore && page.cursor !== page.checkpoint.head)
      ) {
        throw new SyncSafetyError('server_regressed');
      }
      await this.local.applyRemote(page.notes, page.cursor, page.checkpoint);
      witness = page.checkpoint;
      more = page.hasMore;
    }
  }
}
