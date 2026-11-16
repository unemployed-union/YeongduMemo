import type { CategoryProtection } from './index';
export { categoryProtectionSchema, type CategoryProtection } from './index';
export type CategoryProtections = Map<string, CategoryProtection>;
export type CategoryAuthenticator = (message: string) => Promise<boolean>;
export type CategoryDetails = CategoryProtection & { name: string; unlocked: boolean };

export class CategoryAccessError extends Error {
  constructor() {
    super('보호된 카테고리입니다. 인증 후 다시 열어 주세요.');
    this.name = 'CategoryAccessError';
  }
}

/** Grants are memory-only and expire independently of the whole-app lock policy. */
export class CategoryAccess {
  private generation = 0;
  private management = false;
  private unlocked = new Set<string>();

  constructor(
    private authenticate: CategoryAuthenticator,
    private assertAppAccess: () => void,
    private onRevoked: () => void = () => undefined,
  ) {}

  stamp() {
    return this.generation;
  }

  assertCurrent(stamp: number) {
    this.assertAppAccess();
    if (stamp !== this.generation) {
      throw new CategoryAccessError();
    }
  }

  async authorize(message: string): Promise<number | null> {
    this.assertAppAccess();
    const stamp = this.generation;
    const success = await this.authenticate(message);
    this.assertCurrent(stamp);
    return success ? stamp : null;
  }

  async authorizeManagement() {
    const stamp = await this.authorize('카테고리 보호 설정');
    if (stamp === null) {
      return false;
    }
    this.management = true;
    return true;
  }

  assertManagement() {
    this.assertAppAccess();
    if (!this.management) {
      throw new CategoryAccessError();
    }
  }

  endManagement() {
    this.management = false;
  }

  async unlock(name: string) {
    const stamp = await this.authorize('보호된 카테고리 열기');
    if (stamp === null) {
      return false;
    }
    this.unlocked.add(name);
    return true;
  }

  canRead(name: string | null, protections: CategoryProtections) {
    if (name === null) {
      return true;
    }
    const rule = protections.get(name);
    if (!rule) {
      return true;
    }
    if (rule.hidden && !this.unlocked.has(name)) {
      return false;
    }
    return !rule.locked || this.unlocked.has(name);
  }

  canList(name: string, protections: CategoryProtections) {
    return !protections.get(name)?.hidden || this.unlocked.has(name);
  }

  isUnlocked(name: string) {
    return this.unlocked.has(name);
  }

  reset(management = false) {
    this.generation++;
    this.unlocked.clear();
    this.management = management;
    this.onRevoked();
  }
}
