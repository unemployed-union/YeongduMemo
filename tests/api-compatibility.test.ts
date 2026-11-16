import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiClient } from '../apps/mobile/src/services/api';
import { SyncService } from '@yeongdu/shared/src/sync';
import { localDevice } from './helpers';

vi.mock('../apps/mobile/src/storage/secure', () => ({
  readTokens: async () => ({ accessToken: 'test-token', expiresAt: Date.now() + 100_000 }),
  writeTokens: vi.fn(),
  deleteTokens: vi.fn(),
}));
beforeEach(() => {
  vi.stubGlobal('__DEV__', false);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mobile sync protocol compatibility', () => {
  it('stops a new app against an older server before push and can retry after an upgrade', async () => {
    const device = localDevice();
    await device.store.migrate();
    const request = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', request);
    const client = new ApiClient('https://memo.example.com');
    const push = vi.fn(async () => {
      throw new Error('unexpected upload');
    });
    const pull = vi.fn(async () => {
      throw new Error('unexpected download');
    });
    try {
      await expect(
        new SyncService(device.store.synchronization, {
          checkpoint: (context) => client.checkpoint(context),
          push,
          pull,
        }).sync(),
      ).rejects.toMatchObject({ code: 'protocol_upgrade_required' });
      expect(push).not.toHaveBeenCalled();
      expect(pull).not.toHaveBeenCalled();
      expect(await device.store.syncIssue()).toBeNull();
      expect(request.mock.calls).toHaveLength(1);
      const checkpoint = {
        serverId: randomUUID(),
        generation: randomUUID(),
        head: 0,
        token: randomUUID(),
      };
      request.mockResolvedValueOnce(new Response(JSON.stringify(checkpoint)));
      expect(await client.checkpoint(await device.store.syncContext())).toEqual(checkpoint);
    } finally {
      device.sqlite.close();
    }
  });

  it('uses fixed safe rollback messages and never displays an arbitrary server error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: 'server_regressed', error: 'sensitive-server-response' }),
            { status: 409 },
          ),
      ),
    );
    const client = new ApiClient('https://memo.example.com');
    const context = { witness: null, cursor: 0, knownRevision: 0 };
    await expect(client.checkpoint(context)).rejects.toMatchObject({ code: 'server_regressed' });
    await expect(client.checkpoint(context)).rejects.not.toThrow('sensitive-server-response');
  });
});
