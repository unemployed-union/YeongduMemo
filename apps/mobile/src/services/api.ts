import { normalizeServerUrl, tokenSchema, type Tokens } from '@yeongdu/shared';
import { encryptionKeySchema, type EncryptedOperation } from '@yeongdu/shared/src/e2ee';
import { readTokens, writeTokens, deleteTokens } from '../storage/secure';
import type { BlobManifest } from '@yeongdu/shared/src/attachments';
import { z } from 'zod';
import {
  syncIssueSchema,
  SyncSafetyError,
  type SyncCheckpoint,
  type SyncContext,
} from '@yeongdu/shared/src/sync-safety';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ApiClient {
  readonly base: string;
  private refreshing: Promise<Tokens> | null = null;
  constructor(url: string) {
    this.base = normalizeServerUrl(url, __DEV__);
  }

  private async request(
    path: string,
    method: string,
    body?: unknown,
    token?: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      return await fetch(`${this.base}${path}`, {
        method,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async check(response: Response) {
    if (!response.ok) {
      if (response.status === 409 || response.status === 426) {
        const body: unknown = await response
          .clone()
          .json()
          .catch(() => null);
        const code = syncIssueSchema.safeParse(
          typeof body === 'object' && body !== null && 'code' in body ? body.code : null,
        );
        if (code.success) {
          throw new SyncSafetyError(code.data);
        }
      }
      // Read only known status messages; never display an arbitrary response body.
      let message = `서버 요청 실패 (${response.status})`;
      if (response.status === 409) {
        message =
          '암호화 키 또는 기존 서버 데이터 전환 상태를 확인하세요. 평문 DB는 e2ee:migrate로 먼저 전환해야 합니다.';
      }
      throw new ApiError(
        response.status,
        response.status === 401 ? '세션이 만료되었습니다. 다시 로그인하세요.' : message,
      );
    }
    return response;
  }

  async login(email: string, password: string): Promise<Tokens> {
    const response = await this.check(
      await this.request('/auth/login', 'POST', { email, password }),
    );
    return tokenSchema.parse(await response.json());
  }

  private refresh(tokens: Tokens) {
    this.refreshing ??= (async () => {
      const response = await this.request('/auth/refresh', 'POST', {
        refreshToken: tokens.refreshToken,
      });
      if (response.status === 401) await deleteTokens();
      await this.check(response);
      const next = tokenSchema.parse(await response.json());
      await writeTokens(next);
      return next;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async authorized(path: string, method: string, body?: unknown) {
    let tokens = await readTokens();
    if (!tokens) throw new ApiError(401, '서버에 로그인하세요.');
    if (tokens.expiresAt < Date.now() + 30_000) tokens = await this.refresh(tokens);
    let response = await this.request(path, method, body, tokens.accessToken);
    if (response.status === 401) {
      tokens = await this.refresh(tokens);
      response = await this.request(path, method, body, tokens.accessToken);
    }
    return this.check(response);
  }
  async encryptionKey(tokens?: Tokens) {
    const response = tokens
      ? await this.check(await this.request('/e2ee/key', 'GET', undefined, tokens.accessToken))
      : await this.authorized('/e2ee/key', 'GET');
    return encryptionKeySchema.nullable().parse(await response.json());
  }
  async registerEncryptionKey(keyId: string, tokens: Tokens) {
    await this.check(
      await this.request('/e2ee/key', 'PUT', { version: 1, keyId }, tokens.accessToken),
    );
  }
  async checkpoint(context: SyncContext) {
    try {
      return (await this.authorized('/sync/v4/checkpoint', 'POST', context)).json();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new SyncSafetyError('protocol_upgrade_required');
      }
      throw error;
    }
  }
  async push(operations: EncryptedOperation[], witness: SyncCheckpoint) {
    return (await this.authorized('/sync/v4/push', 'POST', { operations, witness })).json();
  }
  async pull(cursor: number, witness: SyncCheckpoint) {
    return (await this.authorized('/sync/v4/pull', 'POST', { cursor, witness })).json();
  }
  async logout() {
    await this.authorized('/auth/logout', 'POST');
    await deleteTokens();
  }
  private async attachmentRequest(path: string, method: string, body?: unknown) {
    try {
      return await this.authorized(`/attachments/v1/${path}`, method, body);
    } catch (error) {
      if (error instanceof ApiError) {
        const messages: Record<number, string> = {
          404: '첨부파일 또는 API가 없습니다. 서버 버전과 백업을 확인하세요.',
          409: '첨부파일 상태가 다릅니다. 원본을 유지하고 다시 시도하세요.',
          413: '첨부파일 또는 계정 저장 용량 한도를 초과했습니다.',
          503: '첨부 저장소를 사용할 수 없습니다. 관리자에게 설정과 백업 확인을 요청하세요.',
        };
        if (messages[error.status]) {
          throw new ApiError(error.status, messages[error.status]!);
        }
      }
      throw error;
    }
  }
  async stageAttachment(manifest: BlobManifest, witness: SyncCheckpoint) {
    return (await this.attachmentRequest('stage', 'POST', { manifest, witness })).json();
  }
  async putAttachmentChunk(id: string, index: number, data: string, witness: SyncCheckpoint) {
    await this.attachmentRequest(`${id}/chunks/${index}`, 'PUT', { data, witness });
  }
  async commitAttachment(id: string, witness: SyncCheckpoint) {
    await this.attachmentRequest(`${id}/commit`, 'POST', { witness });
  }
  async attachmentManifest(id: string) {
    try {
      return await (await this.attachmentRequest(id, 'GET')).json();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }
  async attachmentChunk(id: string, index: number) {
    return z
      .object({ data: z.string().max(400_000) })
      .parse(await (await this.attachmentRequest(`${id}/chunks/${index}`, 'GET')).json()).data;
  }
}
