import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  directory: '/data/user/0/xyz.yeongdu.memo/files/SQLite',
  fileExists: false,
  cipherAvailable: true,
  key: 'a'.repeat(64) as string | null,
  fileUris: [] as string[],
  reader: {
    execAsync: vi.fn(),
    runAsync: vi.fn(),
    getFirstAsync: vi.fn(),
    getAllAsync: vi.fn(),
    closeAsync: vi.fn(),
  },
  writer: {
    execAsync: vi.fn(),
    runAsync: vi.fn(),
    getFirstAsync: vi.fn(),
    getAllAsync: vi.fn(),
    closeAsync: vi.fn(),
  },
  writeSecret: vi.fn(),
}));

vi.mock('expo-file-system', () => ({
  File: class {
    constructor(directory: string) {
      // Match the native FileSystem boundary that rejected the Android SQLite path.
      if (!directory.startsWith('file://')) {
        throw new Error('URI is not absolute');
      }
      native.fileUris.push(directory);
    }

    get exists() {
      return native.fileExists;
    }
  },
}));
vi.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: native.directory,
  openDatabaseAsync: vi.fn(async (_name, options) => {
    return options?.useNewConnection ? native.writer : native.reader;
  }),
}));
vi.mock('expo-crypto', () => ({
  randomUUID: () => 'c583977a-935a-41b9-9cff-8d23fc3fc07d',
  getRandomBytesAsync: vi.fn(),
}));
vi.mock('../apps/mobile/src/storage/secure', () => ({
  readSecret: vi.fn(async (key) => {
    return key === 'database-key' ? native.key : 'c583977a-935a-41b9-9cff-8d23fc3fc07d';
  }),
  writeSecret: native.writeSecret,
}));

import { openVault } from '../apps/mobile/src/storage/database';

beforeEach(() => {
  vi.clearAllMocks();
  native.fileExists = false;
  native.cipherAvailable = true;
  native.key = 'a'.repeat(64);
  native.fileUris = [];
  native.reader.getFirstAsync.mockImplementation(async (sql) => {
    if (sql === 'PRAGMA cipher_version') {
      return native.cipherAvailable ? { cipher_version: '4.0' } : null;
    }
    return { count: 0 };
  });
  native.writer.getFirstAsync.mockResolvedValue({ user_version: 1 });
});

describe('vault startup at native boundaries', () => {
  it('opens the Android vault with a FileSystem URI and keys both database connections', async () => {
    const store = await openVault(() => undefined);

    expect(store).toBeDefined();
    expect(native.fileUris).toEqual([`file://${native.directory}`]);
    expect(native.reader.execAsync.mock.calls[0]?.[0]).toContain('PRAGMA key');
    expect(native.writer.execAsync.mock.calls[0]?.[0]).toContain('PRAGMA key');
    expect(native.writer.execAsync).toHaveBeenCalledWith('COMMIT');
  });

  it('closes the database and refuses startup when SQLCipher is unavailable', async () => {
    native.cipherAvailable = false;

    await expect(openVault(() => undefined)).rejects.toThrow('SQLCipher');
    expect(native.reader.closeAsync).toHaveBeenCalledOnce();
    expect(native.reader.execAsync).not.toHaveBeenCalled();
  });

  it('keeps an existing database intact if its key is missing', async () => {
    native.fileExists = true;
    native.key = null;

    await expect(openVault(() => undefined)).rejects.toThrow('암호화 키를 찾을 수 없습니다');
    expect(native.writeSecret).not.toHaveBeenCalled();
    expect(native.reader.execAsync).not.toHaveBeenCalled();
  });
});
