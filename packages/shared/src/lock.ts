export type LockPolicy = 'immediate' | '30s' | 'restart';

export class AccessGate {
  private unlocked = false;
  private backgroundAt: number | null = null;
  enabled = false;
  policy: LockPolicy = 'immediate';
  isUnlocked() {
    return this.unlocked;
  }
  unlock() {
    this.unlocked = true;
  }
  lock() {
    this.unlocked = false;
  }
  assertAccess = () => {
    if (!this.unlocked) throw new Error('잠금을 해제하세요.');
  };
  background(now: number) {
    this.backgroundAt ??= now;
    if (this.enabled && this.policy === 'immediate') this.lock();
  }
  foreground(now: number) {
    if (
      this.enabled &&
      this.policy === '30s' &&
      this.backgroundAt !== null &&
      now - this.backgroundAt >= 30_000
    )
      this.lock();
    this.backgroundAt = null;
  }
}
