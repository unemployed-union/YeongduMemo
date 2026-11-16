import { describe, expect, it } from 'vitest';
import { confirmRecoveryKey } from '@yeongdu/shared/src/recovery-key';

describe('recovery key backup confirmation', () => {
  const key = 'a7'.repeat(32);
  it('requires an explicit backup acknowledgement and matching separately entered key', () => {
    expect(() => confirmRecoveryKey(key, { confirmation: key, backedUp: false })).toThrow('보관');
    expect(() =>
      confirmRecoveryKey(key, { confirmation: 'b8'.repeat(32), backedUp: true }),
    ).toThrow('일치');
    expect(() => confirmRecoveryKey(key, { confirmation: 'wrong', backedUp: true })).toThrow();
    expect(confirmRecoveryKey(key, { confirmation: key.toUpperCase(), backedUp: true })).toBe(key);
  });
  it('never includes either secret in validation messages', () => {
    try {
      confirmRecoveryKey(key, { confirmation: 'b8'.repeat(32), backedUp: true });
    } catch (error) {
      expect(String(error)).not.toContain(key);
      expect(String(error)).not.toContain('b8'.repeat(32));
    }
  });
});
