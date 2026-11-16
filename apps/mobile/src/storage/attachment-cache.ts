import { Directory, File, Paths } from 'expo-file-system';

/** Run before presenting the vault; includes shares interrupted before finally cleanup. */
export function cleanupAttachmentCache() {
  for (const item of Paths.cache.list()) {
    if (!(item instanceof File)) {
      continue;
    }
    const attachmentShare = /^memo-attachment-share-[a-f0-9-]+(?:\.[a-z0-9]{1,10})?$/i.test(
      item.name,
    );
    const backupShare = /^yeongdu-memo-\d+\.json$/.test(item.name);
    if (attachmentShare || backupShare) {
      item.delete();
    }
  }
  for (const name of ['ImageManipulator', 'ImagePicker']) {
    const directory = new Directory(Paths.cache, name);
    if (directory.exists) {
      directory.delete();
    }
  }
}

export function deleteOwnCache(uri: string) {
  if (uri.startsWith(Paths.cache.uri.replace(/\/$/, '') + '/')) {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  }
}
