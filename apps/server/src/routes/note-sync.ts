import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  encryptedPushRequestSchema as pushRequestSchema,
  encryptionKeySchema,
  guardedPushResponseSchema,
  guardedPullResponseSchema,
} from '@yeongdu/shared/src/e2ee';
import { checkpointSchema, syncContextSchema } from '@yeongdu/shared/src/sync-safety';
import type { NotesRepository } from '../repositories/notes.js';
/** Register on the authenticated scope, without creating a new Fastify plugin scope. */
export function registerNoteSyncRoutes(protectedRoutes: FastifyInstance, notes: NotesRepository) {
  protectedRoutes.get('/e2ee/key', (request) => {
    notes.assertEncrypted(request.userId!);
    const keyId = notes.key(request.userId!);
    return keyId ? encryptionKeySchema.parse({ version: 1, keyId }) : null;
  });
  protectedRoutes.put('/e2ee/key', (request) => {
    const key = encryptionKeySchema.parse(request.body);
    notes.registerKey(request.userId!, key.keyId);
    return key;
  });
  protectedRoutes.post('/sync/v4/checkpoint', (request) => {
    return checkpointSchema.parse(
      notes.verifyCheckpoint(request.userId!, syncContextSchema.parse(request.body)),
    );
  });
  protectedRoutes.post('/sync/v4/push', (request) => {
    const { operations, witness } = pushRequestSchema
      .extend({ witness: checkpointSchema })
      .parse(request.body);
    return guardedPushResponseSchema.parse(notes.guardedPush(request.userId!, operations, witness));
  });
  protectedRoutes.post('/sync/v4/pull', (request) => {
    const { cursor, witness } = z
      .strictObject({
        cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        witness: checkpointSchema,
      })
      .parse(request.body);
    return guardedPullResponseSchema.parse(notes.guardedPull(request.userId!, cursor, witness));
  });
  const upgradeRequired = (_request: unknown, reply: import('fastify').FastifyReply) =>
    reply.code(426).send({
      code: 'protocol_upgrade_required',
      error: '백업 복구 검사를 지원하는 최신 앱으로 업데이트하세요.',
    });
  protectedRoutes.post('/sync/v2/push', upgradeRequired);
  protectedRoutes.get('/sync/v2/pull', upgradeRequired);
  protectedRoutes.post('/sync/v3/checkpoint', upgradeRequired);
  protectedRoutes.post('/sync/v3/push', upgradeRequired);
  protectedRoutes.post('/sync/v3/pull', upgradeRequired);
}
