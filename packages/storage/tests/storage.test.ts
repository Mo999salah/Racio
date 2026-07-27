import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalPrivateStorage, createRandomStorageKey } from '../src/index';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('private local storage', () => {
  it('writes and reads opaque keys without exposing the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'racio-storage-'));
    roots.push(root);
    const storage = createLocalPrivateStorage({ rootDirectory: root });
    const key = createRandomStorageKey();
    await storage.put(key, new TextEncoder().encode('private'), 'text/csv');
    expect(new TextDecoder().decode(await storage.get(key))).toBe('private');
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toBeTruthy();
  });

  it('rejects traversal keys', async () => {
    const storage = createLocalPrivateStorage({ rootDirectory: 'C:\\temp\\racio' });
    await expect(storage.get('../outside.csv')).rejects.toThrow('Unsafe storage key.');
  });
});
