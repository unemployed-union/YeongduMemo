import { registerNoteSyncRoutes } from './routes/note-sync.js';
import { registerAttachmentRoutes } from './routes/attachments.js';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { healthSchema, loginSchema, refreshSchema, tokenSchema } from '@yeongdu/shared';
import { encryptedNoteSchema as noteSchema } from '@yeongdu/shared/src/e2ee';
import { openDatabase } from './database/index.js';
import { AuthService } from './services/auth.js';
import { NotesRepository, OperationReuseError } from './repositories/notes.js';
import { AttachmentsRepository } from './repositories/attachments.js';
import { FileBlobStore, type BlobStore } from './storage/blobs.js';
import { dirname, join } from 'node:path';
import { SyncSafetyError } from '@yeongdu/shared/src/sync-safety';

export async function createApp(
  options: {
    databasePath?: string;
    logger?: boolean;
    trustProxy?: string[];
    now?: () => number;
    blobStore?: BlobStore;
    attachmentQuotaBytes?: number;
  } = {},
) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 12 * 1024 * 1024,
    trustProxy: options.trustProxy?.length ? options.trustProxy : false,
  });
  const db = await openDatabase(options.databasePath ?? ':memory:');
  const auth = new AuthService(db, options.now);
  let attachments: AttachmentsRepository;
  try {
    attachments = new AttachmentsRepository(
      db,
      options.blobStore ??
        new FileBlobStore(join(dirname(options.databasePath ?? './data/memo.db'), 'attachments')),
      options.attachmentQuotaBytes,
    );
  } catch (error) {
    db.sqlite.close();
    throw error;
  }
  const notes = new NotesRepository(db, (userId, ids, keyId) =>
    attachments.assertReady(userId, ids, keyId),
  );
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.addHook('onClose', () => {
    db.sqlite.close();
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SyncSafetyError) {
      return reply.code(409).send({ error: error.message, code: error.code });
    }
    if (error instanceof ZodError)
      return reply.code(400).send({ error: '요청 형식이 올바르지 않습니다.' });
    if (error instanceof OperationReuseError) return reply.code(409).send({ error: error.message });
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    if (status >= 500) app.log.error({ statusCode: status }, 'Request failed');
    return reply
      .code(status)
      .send({ error: status >= 500 ? '서버 오류가 발생했습니다.' : '요청을 처리할 수 없습니다.' });
  });
  app.get('/health', () => healthSchema.parse({ status: 'ok', version: '0.1.0' }));
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { email, password } = loginSchema.parse(request.body);
      const tokens = await auth.login(email, password);
      if (!tokens) return reply.code(401).send({ error: '이메일 또는 비밀번호를 확인하세요.' });
      reply.header('Cache-Control', 'no-store');
      return tokenSchema.parse(tokens);
    },
  );
  app.post(
    '/auth/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    (request, reply) => {
      const { refreshToken } = refreshSchema.parse(request.body);
      const tokens = auth.refresh(refreshToken);
      if (!tokens)
        return reply.code(401).send({ error: '세션이 만료되었습니다. 다시 로그인하세요.' });
      reply.header('Cache-Control', 'no-store');
      return tokenSchema.parse(tokens);
    },
  );
  await app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', async (request, reply) => {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const userId = auth.authenticate(token);
      if (!userId) return reply.code(401).send({ error: '인증이 필요합니다.' });
      request.userId = userId;
      reply.header('Cache-Control', 'no-store');
    });
    protectedRoutes.post('/auth/logout', (request, reply) => {
      auth.logout(request.headers.authorization!.slice(7));
      return reply.code(204).send();
    });
    registerNoteSyncRoutes(protectedRoutes, notes);
    registerAttachmentRoutes(protectedRoutes, notes, attachments);
    protectedRoutes.post('/sync/push', (_request, reply) =>
      reply.code(426).send({ error: '종단 간 암호화를 지원하는 앱으로 업그레이드하세요.' }),
    );
    protectedRoutes.get('/sync/pull', (_request, reply) =>
      reply.code(426).send({ error: '종단 간 암호화를 지원하는 앱으로 업그레이드하세요.' }),
    );
    protectedRoutes.get('/notes', (request) =>
      noteSchema.array().parse(notes.list(request.userId!)),
    );
  });
  return { app, db, auth, notes, attachments };
}
declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}
