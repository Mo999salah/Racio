export type StoredObject = {
  key: string;
  contentType: string;
  size: number;
};

export interface PrivateStorage {
  put(key: string, content: Uint8Array, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export type S3CompatibleStorageOptions = {
  endpoint: string;
  bucket: string;
  region: string;
};

export type LocalStorageOptions = {
  rootDirectory: string;
};

/** Adapters are deliberately unimplemented until the upload phase. */
function assertSafeStorageKey(key: string): void {
  if (!key || isAbsolute(key) || key.includes('\\') || key.includes('\0')) {
    throw new Error('Unsafe storage key.');
  }
  const normalized = normalize(key);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    relative('.', normalized).startsWith('..')
  ) {
    throw new Error('Unsafe storage key.');
  }
}

export function createLocalPrivateStorage(options: LocalStorageOptions): PrivateStorage {
  const root = normalize(options.rootDirectory);
  return {
    async put(key, content, contentType) {
      assertSafeStorageKey(key);
      const target = join(root, key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, { flag: 'wx', mode: 0o600 });
      return { key, contentType, size: content.byteLength };
    },
    async get(key) {
      assertSafeStorageKey(key);
      return new Uint8Array(await readFile(join(root, key)));
    },
    async delete(key) {
      assertSafeStorageKey(key);
      await unlink(join(root, key));
    },
  };
}

export function createRandomStorageKey(prefix = 'statements'): string {
  return `${prefix}/${randomUUID()}.csv`;
}

export const storageBoundary = {
  local: 'private-local-adapter',
  s3: 'reserved-for-s3-compatible-adapter',
} as const;
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
