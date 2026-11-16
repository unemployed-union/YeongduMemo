import { z } from 'zod';

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().default('./data/memo.db'),
  // Trust only the explicit proxy CIDRs; never trust arbitrary X-Forwarded-For.
  TRUST_PROXY: z.string().default(''),
  ATTACHMENT_STORAGE: z.enum(['filesystem', 's3']).default('filesystem'),
  ATTACHMENT_PATH: z.string().optional(),
  ATTACHMENT_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024 * 1024),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
  S3_PREFIX: z.string().default('yeongdu-memo'),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
});
export const readConfig = () => envSchema.parse(process.env);
