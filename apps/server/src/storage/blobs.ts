import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { BlobManifest } from '@yeongdu/shared/src/attachments';

export interface BlobStore {
  readonly identity: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}
export function blobKey(userId: string, manifest: BlobManifest, index: number) {
  const chunk = manifest.chunks[index];
  if (!chunk) {
    throw new Error('잘못된 첨부파일 조각입니다.');
  }
  return `${userId}/${manifest.id}/${index}-${chunk.sha256}.bin`;
}
export function verifyBlob(bytes: Uint8Array, expected: { size: number; sha256: string }) {
  if (
    bytes.length !== expected.size ||
    createHash('sha256').update(bytes).digest('hex') !== expected.sha256
  ) {
    throw new Error('첨부파일 저장소 무결성 검사에 실패했습니다.');
  }
}
export class FileBlobStore implements BlobStore {
  readonly identity = 'filesystem-v1';
  private root: string;
  constructor(directory: string) {
    this.root = resolve(directory);
  }
  private path(key: string) {
    if (!/^[a-f0-9-]+\/[a-f0-9-]+\/\d+-[a-f0-9]{64}\.bin$/.test(key)) {
      throw new Error('잘못된 저장 키입니다.');
    }
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) {
      throw new Error('잘못된 저장 경로입니다.');
    }
    return path;
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
  async put(key: string, bytes: Uint8Array) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600, flush: true });
      try {
        await link(temporary, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        const previous = await readFile(path);
        if (!previous.equals(Buffer.from(bytes))) {
          throw new Error('기존 첨부파일을 덮어쓸 수 없습니다.');
        }
      }
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
    }
  }
}
export interface S3BlobOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  prefix?: string;
  forcePathStyle?: boolean;
}
export class S3BlobStore implements BlobStore {
  readonly identity: string;
  private prefix: string;
  constructor(
    private options: S3BlobOptions,
    private client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle ?? false,
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 30_000 },
    }),
  ) {
    this.prefix = (options.prefix ?? 'yeongdu-memo').replace(/^\/+|\/+$/g, '');
    if (!/^[A-Za-z0-9/_-]*$/.test(this.prefix) || this.prefix.split('/').includes('..')) {
      throw new Error('잘못된 S3 prefix입니다.');
    }
    this.identity = `s3-v1-${createHash('sha256')
      .update(JSON.stringify([options.endpoint ?? 'aws', options.bucket, this.prefix]))
      .digest('hex')}`;
  }
  private key(key: string) {
    if (!/^[a-f0-9-]+\/[a-f0-9-]+\/\d+-[a-f0-9]{64}\.bin$/.test(key)) {
      throw new Error('잘못된 저장 키입니다.');
    }
    return this.prefix ? `${this.prefix}/${key}` : key;
  }
  async get(key: string) {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: this.key(key) }),
      );
      if (!result.Body) {
        throw new Error('S3 응답에 파일이 없습니다.');
      }
      return await result.Body.transformToByteArray();
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404 || (error as Error).name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }
  async put(key: string, bytes: Uint8Array) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: this.key(key),
          Body: bytes,
          ContentType: 'application/octet-stream',
          IfNoneMatch: '*',
        }),
      );
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== 412) {
        throw error;
      }
      const previous = await this.get(key);
      if (!previous || !Buffer.from(previous).equals(Buffer.from(bytes))) {
        throw new Error('기존 S3 첨부파일을 덮어쓸 수 없습니다.');
      }
    }
  }
}
