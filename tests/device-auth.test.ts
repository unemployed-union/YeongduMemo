import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ enrolled: vi.fn(), authenticate: vi.fn() }));
vi.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0 },
  getEnrolledLevelAsync: native.enrolled,
  authenticateAsync: native.authenticate,
}));
import { authenticateDevice, isAuthenticating } from '../apps/mobile/src/services/device-auth';

beforeEach(() => {
  vi.clearAllMocks();
  native.enrolled.mockResolvedValue(1);
  native.authenticate.mockResolvedValue({ success: true });
});
describe('OS authentication boundary (mocked native API)', () => {
  it('fails closed without an enrolled OS credential and releases the in-progress flag', async () => {
    native.enrolled.mockResolvedValueOnce(0);
    await expect(authenticateDevice('test')).rejects.toThrow('기기 설정');
    expect(native.authenticate).not.toHaveBeenCalled();
    expect(isAuthenticating()).toBe(false);
  });
  it('does not overlap prompts and preserves cancellation and explicit passcode fallback', async () => {
    let complete!: (result: { success: boolean }) => void;
    native.authenticate.mockImplementationOnce(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          complete = resolve;
        }),
    );
    const first = authenticateDevice('test');
    await vi.waitFor(() => expect(native.authenticate).toHaveBeenCalledOnce());
    expect(isAuthenticating()).toBe(true);
    expect(await authenticateDevice('overlapping prompt')).toBe(false);
    expect(native.authenticate).toHaveBeenCalledOnce();
    complete({ success: false });
    expect(await first).toBe(false);
    expect(isAuthenticating()).toBe(false);
    expect(native.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false, biometricsSecurityLevel: 'strong' }),
    );
    expect(await authenticateDevice('retry')).toBe(true);
  });
  it('does not swallow native failures and permits a subsequent retry', async () => {
    const failure = new Error('native error');
    native.authenticate.mockRejectedValueOnce(failure);
    await expect(authenticateDevice('test')).rejects.toBe(failure);
    expect(isAuthenticating()).toBe(false);
    expect(await authenticateDevice('retry')).toBe(true);
  });
});
