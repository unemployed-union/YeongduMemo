import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app';

describe('extracted route registration scope', () => {
  it('runs the existing authentication hook before all extracted note and attachment handlers', async () => {
    const server = await createApp();
    try {
      const id = randomUUID();
      const routes = [
        ['GET', '/e2ee/key'],
        ['PUT', '/e2ee/key'],
        ['POST', '/sync/v4/checkpoint'],
        ['POST', '/sync/v4/push'],
        ['POST', '/sync/v4/pull'],
        ['POST', '/sync/v3/push'],
        ['GET', '/sync/v2/pull'],
        ['POST', '/attachments/v1/stage'],
        ['PUT', `/attachments/v1/${id}/chunks/0`],
        ['POST', `/attachments/v1/${id}/commit`],
        ['GET', `/attachments/v1/${id}`],
        ['GET', `/attachments/v1/${id}/chunks/0`],
      ] as const;
      for (const [method, url] of routes) {
        const response = await server.app.inject({
          method,
          url,
          ...(method === 'GET' ? {} : { payload: {} }),
        });
        expect(response.statusCode, url).toBe(401);
        expect(response.json(), url).toEqual({ error: '인증이 필요합니다.' });
      }
      expect(server.db.sqlite.prepare('SELECT COUNT(*) AS count FROM notes').get()).toEqual({
        count: 0,
      });
      expect(server.db.sqlite.prepare('SELECT COUNT(*) AS count FROM attachments').get()).toEqual({
        count: 0,
      });
    } finally {
      await server.app.close();
    }
  });
});
