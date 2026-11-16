import { z } from 'zod';
import { attachmentSchema, MAX_NOTE_ATTACHMENTS } from './attachments';

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, '카테고리 이름을 입력하세요.')
  .max(40, '카테고리 이름은 40자까지 입력할 수 있습니다.')
  .transform((name) => name.normalize('NFC'));

export const categoryProtectionSchema = z.strictObject({
  locked: z.boolean(),
  hidden: z.boolean(),
});
export type CategoryProtection = z.infer<typeof categoryProtectionSchema>;

export const noteContentSchema = z.object({
  id: z.uuid(),
  title: z.string().max(1000),
  body: z.string().max(1_000_000),
  attachments: z
    .array(attachmentSchema)
    .max(MAX_NOTE_ATTACHMENTS)
    .refine(
      (files) => new Set(files.map((file) => file.id)).size === files.length,
      '메모 안의 첨부 ID가 중복되었습니다.',
    )
    .default(() => []),
  category: categoryNameSchema.nullable().default(null),
  categoryProtection: categoryProtectionSchema.default(() => ({ locked: false, hidden: false })),
  favorite: z.boolean(),
  pinned: z.boolean(),
  archived: z.boolean(),
  deletedAt: z.iso.datetime().nullable(),
  purged: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  conflictOf: z.uuid().nullable(),
});
export const noteSchema = noteContentSchema.extend({ revision: z.number().int().nonnegative() });
export type Note = z.infer<typeof noteSchema>;
export const operationSchema = z.object({
  operationId: z.uuid(),
  clientId: z.uuid(),
  baseRevision: z.number().int().nonnegative(),
  note: noteContentSchema,
});
export type Operation = z.infer<typeof operationSchema>;
export const pushRequestSchema = z.object({ operations: z.array(operationSchema).min(1).max(50) });
export const pushResultSchema = z.object({
  operationId: z.uuid(),
  canonical: noteSchema,
  conflict: noteSchema.nullable(),
});
export type PushResult = z.infer<typeof pushResultSchema>;
export const pushResponseSchema = z.object({ results: z.array(pushResultSchema) });
export const pullResponseSchema = z.object({
  notes: z.array(noteSchema),
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});
export const createUserSchema = loginSchema.extend({ password: z.string().min(12).max(256) });
export const refreshSchema = z.object({ refreshToken: z.string().min(32).max(256) });
export const tokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  userId: z.uuid(),
});
export type Tokens = z.infer<typeof tokenSchema>;
export const errorSchema = z.object({ error: z.string() });
export const healthSchema = z.object({ status: z.literal('ok'), version: z.literal('0.1.0') });

export function blankNote(id: string, now = new Date().toISOString()): Note {
  return {
    id,
    title: '',
    body: '',
    attachments: [],
    category: null,
    categoryProtection: { locked: false, hidden: false },
    favorite: false,
    pinned: false,
    archived: false,
    deletedAt: null,
    purged: false,
    createdAt: now,
    updatedAt: now,
    conflictOf: null,
    revision: 0,
  };
}

export function normalizeServerUrl(input: string, allowDevelopmentHttp = false): string {
  const url = new URL(input.trim());
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('서버 주소는 경로·인증 정보 없는 기본 URL이어야 합니다.');
  }
  if (url.protocol !== 'https:' && !(allowDevelopmentHttp && url.protocol === 'http:')) {
    throw new Error('HTTPS 주소를 입력하세요. HTTP는 개발 빌드에서만 허용됩니다.');
  }
  return url.origin;
}
