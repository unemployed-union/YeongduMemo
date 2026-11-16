import {
  assertCheckpointProgress,
  SyncSafetyError,
  type SyncCheckpoint,
  type SyncContext,
} from '@yeongdu/shared/src/sync-safety';
import type { ServerDatabase } from '../database/index.js';
/** Caller owns any transaction; verification shares the exact same DB connection. */
export class SyncCheckpoints {
  constructor(private db: ServerDatabase) {}
  checkpoint(userId: string): SyncCheckpoint {
    const identity = this.db.sqlite
      .prepare('SELECT server_id, generation FROM sync_identity WHERE id = 1')
      .get() as { server_id: string; generation: string };
    const head = this.db.sqlite
      .prepare('SELECT seq, checkpoint FROM changes WHERE user_id = ? ORDER BY seq DESC LIMIT 1')
      .get(userId) as { seq: number; checkpoint: string } | undefined;
    return {
      serverId: identity.server_id,
      generation: identity.generation,
      head: head?.seq ?? 0,
      token: head?.checkpoint ?? identity.generation,
    };
  }
  verifyCheckpoint(userId: string, context: SyncContext) {
    const current = this.checkpoint(userId);
    if (!context.witness && (context.cursor > 0 || context.knownRevision > 0)) {
      throw new SyncSafetyError('legacy_checkpoint_required');
    }
    assertCheckpointProgress(
      context.witness,
      current,
      Math.max(context.cursor, context.knownRevision),
    );
    const witness = context.witness;
    if (witness) {
      const row =
        witness.head === 0
          ? null
          : (this.db.sqlite
              .prepare('SELECT checkpoint FROM changes WHERE user_id = ? AND seq = ?')
              .get(userId, witness.head) as { checkpoint: string } | undefined);
      const token = witness.head === 0 ? current.generation : row?.checkpoint;
      if (token !== witness.token) {
        throw new SyncSafetyError('history_diverged');
      }
    }
    return current;
  }
}
