import { beforeEach, describe, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({
  events: [] as string[],
  tokens: vi.fn(),
  logout: vi.fn(),
  update: vi.fn(),
  setState: vi.fn(),
}));
vi.mock('../apps/mobile/src/services/api', () => ({
  ApiClient: class {
    logout = session.logout;
  },
}));
vi.mock('../apps/mobile/src/services/encryption', () => ({
  createNoteEncryption: vi.fn(),
  saveRecoveryKey: vi.fn(),
}));
vi.mock('../apps/mobile/src/storage/secure', () => ({
  readTokens: session.tokens,
  writeTokens: vi.fn(),
}));
vi.mock('../apps/mobile/src/services/runtime', () => ({
  gate: {},
  settleSync: async () => {
    session.events.push('settle');
  },
  updateSettings: session.update,
  useRuntime: { setState: session.setState },
}));
import { disconnectServer } from '../apps/mobile/src/services/server-connection';

beforeEach(() => {
  vi.clearAllMocks();
  session.events.length = 0;
  session.tokens.mockImplementation(async () => {
    session.events.push('tokens');
    return { userId: 'user' };
  });
  session.logout.mockImplementation(async () => {
    session.events.push('logout');
  });
  session.update.mockImplementation(async () => {
    session.events.push('settings');
  });
  session.setState.mockImplementation(() => {
    session.events.push('status');
  });
});
describe('settings disconnection ordering', () => {
  it('waits for sync and server logout before clearing the URL or reporting local storage', async () => {
    expect(await disconnectServer('https://memo.example.com')).toBe(true);
    expect(session.events).toEqual(['settle', 'tokens', 'logout', 'settings', 'status']);
    expect(session.update).toHaveBeenCalledWith({ serverUrl: '' });
    expect(session.setState).toHaveBeenCalledWith({ syncStatus: '로그아웃 · 로컬에 저장' });
  });
  it('preserves settings on no session or failed logout', async () => {
    session.tokens.mockResolvedValueOnce(null);
    expect(await disconnectServer('https://memo.example.com')).toBe(false);
    expect(session.logout).not.toHaveBeenCalled();
    session.logout.mockRejectedValueOnce(new Error('offline'));
    await expect(disconnectServer('https://memo.example.com')).rejects.toThrow('offline');
    expect(session.update).not.toHaveBeenCalled();
    expect(session.setState).not.toHaveBeenCalled();
  });
});
