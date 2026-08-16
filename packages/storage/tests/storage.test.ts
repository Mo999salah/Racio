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

  it('creates opaque source-specific workbook keys', () => {
    expect(createRandomStorageKey('statements', 'xlsx')).toMatch(/^statements\/[0-9a-f-]+\.xlsx$/u);
  });

  it('streams chunks to an object with the correct size', async () => {
    const root = await mkdtemp(join(tmpdir(), 'racio-storage-'));
    roots.push(root);
    const storage = createLocalPrivateStorage({ rootDirectory: root });
    const key = 'exports/demo.csv';
    async function* chunks() {
      yield new TextEncoder().encode('header\r\n');
      yield new TextEncoder().encode('a,1\r\n');
      yield new TextEncoder().encode('b,2\r\n');
    }
    const stored = await storage.putChunks(key, chunks(), 'text/csv');
    expect(stored.size).toBe('header\r\na,1\r\nb,2\r\n'.length);
    expect(new TextDecoder().decode(await storage.get(key))).toBe('header\r\na,1\r\nb,2\r\n');
    await storage.delete(key);
  });

  it('overwrites an existing key on retry without duplicate artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'racio-storage-'));
    roots.push(root);
    const storage = createLocalPrivateStorage({ rootDirectory: root });
    const key = 'exports/retry.csv';
    await storage.put(key, new TextEncoder().encode('first'), 'text/csv');
    await storage.put(key, new TextEncoder().encode('second'), 'text/csv');
    expect(new TextDecoder().decode(await storage.get(key))).toBe('second');
  });

  it('lists objects under a prefix without crossing boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'racio-storage-'));
    roots.push(root);
    const storage = createLocalPrivateStorage({ rootDirectory: root });
    await storage.put('exports/a.csv', new TextEncoder().encode('a'), 'text/csv');
    await storage.put('exports/nested/b.csv', new TextEncoder().encode('b'), 'text/csv');
    await storage.put('statements/c.csv', new TextEncoder().encode('c'), 'text/csv');

    const exportsRefs = await storage.list('exports');
    expect(exportsRefs.map((ref) => ref.key).sort()).toEqual([
      'exports/a.csv',
      'exports/nested/b.csv',
    ]);

    const allRefs = await storage.list('exports/nested');
    expect(allRefs.map((ref) => ref.key)).toEqual(['exports/nested/b.csv']);

    const empty = await storage.list('nonexistent');
    expect(empty).toEqual([]);
  });

  it('rejects listing with a traversal prefix', async () => {
    const storage = createLocalPrivateStorage({ rootDirectory: 'C:\\temp\\racio' });
    await expect(storage.list('../outside')).rejects.toThrow('Unsafe storage key.');
  });
});
