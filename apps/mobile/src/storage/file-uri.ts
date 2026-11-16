/** SQLite exposes native paths on Android; FileSystem requires a file URI. */
export function fileUriFromPath(path: string): string {
  if (path.startsWith('file://')) {
    return path;
  }

  if (!path.startsWith('/')) {
    throw new Error('파일 경로는 절대 경로여야 합니다.');
  }

  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `file://${encodedPath}`;
}
