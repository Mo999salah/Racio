export type StoredObject = {
  key: string;
  contentType: string;
  size: number;
};

export type StoredObjectRef = {
  key: string;
  modifiedAt: Date;
};

export interface PrivateStorage {
  put(key: string, content: Uint8Array, contentType: string): Promise<StoredObject>;
  /** Streams bounded chunks to the final object; used to keep export memory bounded. */
  putChunks(
    key: string,
    chunks: AsyncIterable<Uint8Array>,
    contentType: string,
  ): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /**
   * Bounded listing of objects under a key prefix, newest first. Used only by
   * cleanup reconcilers that compare stored objects against live database
   * references; callers must never render keys to clients.
   */
  list(prefix: string): Promise<StoredObjectRef[]>;
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
      // Overwrite-safe: storage keys are random UUIDs for uploads and
      // deterministic per export id for exports, so a retry rewrites the
      // same key instead of failing or duplicating an artifact.
      await writeFile(target, content, { flag: 'w', mode: 0o600 });
      return { key, contentType, size: content.byteLength };
    },
    async putChunks(key, chunks, contentType) {
      assertSafeStorageKey(key);
      const target = join(root, key);
      await mkdir(dirname(target), { recursive: true });
      const handle = await open(target, 'w', 0o600);
      try {
        let size = 0;
        for await (const chunk of chunks) {
          if (chunk.byteLength === 0) continue;
          await handle.writeFile(chunk);
          size += chunk.byteLength;
        }
        return { key, contentType, size };
      } finally {
        await handle.close();
      }
    },
    async get(key) {
      assertSafeStorageKey(key);
      return new Uint8Array(await readFile(join(root, key)));
    },
    async delete(key) {
      assertSafeStorageKey(key);
      await unlink(join(root, key));
    },
    async list(prefix) {
      assertSafeStorageKey(prefix);
      const base = join(root, prefix);
      let items;
      try {
        items = await readdir(base, { withFileTypes: true, recursive: true });
      } catch {
        return [];
      }
      const refs: StoredObjectRef[] = [];
      for (const item of items) {
        if (!item.isFile()) continue;
        const relativePath = join(item.parentPath ?? item.path, item.name).slice(base.length + 1);
        if (!relativePath) continue;
        const key = `${prefix}/${relativePath.replaceAll('\\', '/')}`;
        const statResult = await statSafe(join(root, key));
        if (statResult) refs.push({ key, modifiedAt: statResult.mtime });
      }
      refs.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
      return refs;
    },
  };
}

export function createRandomStorageKey(
  prefix = 'statements',
  extension: 'csv' | 'xlsx' | 'pdf' = 'csv',
): string {
  return `${prefix}/${randomUUID()}.${extension}`;
}

export const storageBoundary = {
  local: 'private-local-adapter',
  s3: 'reserved-for-s3-compatible-adapter',
} as const;
import { randomUUID } from 'node:crypto';
import { open, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';

async function statSafe(path: string) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}
