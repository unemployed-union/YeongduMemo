import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { blobManifestSchema, ATTACHMENT_CHUNK_BYTES } from '@yeongdu/shared/src/attachments';
import { checkpointSchema } from '@yeongdu/shared/src/sync-safety';
import type { NotesRepository } from '../repositories/notes.js';
import type { AttachmentsRepository } from '../repositories/attachments.js';
/** Receives the same authenticated scope as note sync. */
export function registerAttachmentRoutes(
  protectedRoutes: FastifyInstance,
  notes: NotesRepository,
  attachments: AttachmentsRepository,
) {
  const attachmentParams = z.strictObject({ id: z.uuid() });
  const chunkParams = attachmentParams.extend({ index: z.coerce.number().int().min(0).max(79) });
  const witnessBody = z.strictObject({ witness: checkpointSchema });
  protectedRoutes.post('/attachments/v1/stage', (request) => {
    const { witness, manifest } = witnessBody
      .extend({ manifest: blobManifestSchema })
      .parse(request.body);
    notes.verifyCheckpoint(request.userId!, { witness, cursor: 0, knownRevision: 0 });
    return attachments.stage(request.userId!, manifest);
  });
  protectedRoutes.put(
    '/attachments/v1/:id/chunks/:index',
    { bodyLimit: 400_000 },
    async (request) => {
      const { id, index } = chunkParams.parse(request.params);
      const { witness, data } = witnessBody
        .extend({
          data: z
            .string()
            .max(Math.ceil((ATTACHMENT_CHUNK_BYTES + 28) / 3) * 4)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        })
        .parse(request.body);
      notes.verifyCheckpoint(request.userId!, { witness, cursor: 0, knownRevision: 0 });
      await attachments.put(request.userId!, id, index, Buffer.from(data, 'base64'));
      return { ok: true };
    },
  );
  protectedRoutes.post('/attachments/v1/:id/commit', async (request) => {
    const { id } = attachmentParams.parse(request.params);
    const { witness } = witnessBody.parse(request.body);
    notes.verifyCheckpoint(request.userId!, { witness, cursor: 0, knownRevision: 0 });
    await attachments.commit(request.userId!, id);
    // Recheck after storage I/O; no note is published until a later guarded push.
    notes.verifyCheckpoint(request.userId!, { witness, cursor: 0, knownRevision: 0 });
    return { ok: true };
  });
  protectedRoutes.get('/attachments/v1/:id', (request) =>
    attachments.getManifest(request.userId!, attachmentParams.parse(request.params).id),
  );
  protectedRoutes.get('/attachments/v1/:id/chunks/:index', async (request) => {
    const { id, index } = chunkParams.parse(request.params);
    return {
      data: Buffer.from(await attachments.get(request.userId!, id, index)).toString('base64'),
    };
  });
}
