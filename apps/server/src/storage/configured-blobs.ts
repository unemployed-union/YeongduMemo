import { dirname, join } from 'node:path';
import { FileBlobStore, S3BlobStore } from './blobs.js';
import type { readConfig } from '../config/index.js';

export function configuredBlobStore(config: ReturnType<typeof readConfig>) {
  if (config.ATTACHMENT_STORAGE === 'filesystem') {
    return new FileBlobStore(
      config.ATTACHMENT_PATH ?? join(dirname(config.DATABASE_PATH), 'attachments'),
    );
  }
  if (!config.S3_BUCKET) {
    throw new Error('S3_BUCKET 설정이 필요합니다.');
  }
  if (config.S3_ENDPOINT) {
    const endpoint = new URL(config.S3_ENDPOINT);
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      !['https:', 'http:'].includes(endpoint.protocol)
    ) {
      throw new Error('S3 endpoint에는 인증 정보·query·fragment 없는 HTTP(S) 주소를 사용하세요.');
    }
  }
  return new S3BlobStore({
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    prefix: config.S3_PREFIX,
    forcePathStyle: config.S3_FORCE_PATH_STYLE === 'true',
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
  });
}
