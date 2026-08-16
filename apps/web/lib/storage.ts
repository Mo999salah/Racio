import { createLocalPrivateStorage, type PrivateStorage } from '@racio/storage';

let cachedStorage: PrivateStorage | undefined;

/** Lazily created so importing the module never requires environment values. */
export function getPrivateStorage(): PrivateStorage {
  cachedStorage ??= createLocalPrivateStorage({
    rootDirectory: process.env.LOCAL_STORAGE_PATH ?? './uploads',
  });
  return cachedStorage;
}
