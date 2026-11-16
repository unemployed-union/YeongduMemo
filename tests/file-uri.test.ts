import { describe, expect, it } from 'vitest';
import { fileUriFromPath } from '../apps/mobile/src/storage/file-uri';

describe('SQLite paths used by FileSystem', () => {
  it('converts the Android native database directory into an absolute file URI', () => {
    const directory = '/data/user/0/xyz.yeongdu.memo/files/SQLite';
    const uri = fileUriFromPath(directory);

    expect(uri).toBe('file:///data/user/0/xyz.yeongdu.memo/files/SQLite');
    expect(new URL(uri).protocol).toBe('file:');
    expect(new URL(uri).pathname).toBe(directory);
  });

  it('preserves already encoded file URIs such as iOS database directories', () => {
    const uri = 'file:///var/mobile/Containers/Data/My%20App/Documents/SQLite/';
    expect(fileUriFromPath(uri)).toBe(uri);
  });

  it('encodes spaces, hash characters and Unicode without changing the target path', () => {
    const path = '/data/메모 저장소/#vault/SQLite';
    const uri = fileUriFromPath(path);

    expect(decodeURIComponent(new URL(uri).pathname)).toBe(path);
    expect(new URL(uri).hash).toBe('');
  });

  it('rejects relative paths and non-file URI schemes', () => {
    expect(() => fileUriFromPath('SQLite')).toThrow('절대 경로');
    expect(() => fileUriFromPath('https://example.com/SQLite')).toThrow('절대 경로');
  });
});
