import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_ROOT,
  buildArchiveManifest,
  buildArchiveZip,
} from '../src/archive';

const resources = [
  {
    fileName: 'transactions.json',
    records: [{ id: 't1', amount_exact: '1234.567890', currency: 'TRY' }],
  },
  { fileName: 'accounts.json', records: [] },
];

const manifest = buildArchiveManifest({
  generatedAt: '2026-08-16T10:00:00.000Z',
  locale: 'en',
  timezone: 'Europe/Istanbul',
  resources,
});

describe('structured archive', () => {
  it('uses a versioned manifest with stable fields', () => {
    expect(manifest.formatVersion).toBe('1');
    expect(manifest.application).toBe('Racio');
    expect(manifest.includedResources).toEqual(['transactions', 'accounts']);
    expect(manifest.locale).toBe('en');
    expect(manifest.timezone).toBe('Europe/Istanbul');
    expect(manifest.counts).toEqual({ 'transactions.json': 1, 'accounts.json': 0 });
  });

  it('builds a zip with deterministic relative paths only', () => {
    const bytes = buildArchiveZip({ resources, manifest });
    const files = unzipSync(bytes);
    const names = Object.keys(files).sort();
    expect(names).toEqual([
      `${ARCHIVE_ROOT}/accounts.json`,
      `${ARCHIVE_ROOT}/manifest.json`,
      `${ARCHIVE_ROOT}/transactions.json`,
    ]);
    for (const name of names) {
      expect(name.startsWith(`${ARCHIVE_ROOT}/`)).toBe(true);
      expect(name).not.toMatch(/^[/\\]/u);
      expect(name).not.toContain('..');
      expect(name).not.toContain('\\');
    }
  });

  it('is byte-stable for identical content', () => {
    const first = buildArchiveZip({ resources, manifest });
    const second = buildArchiveZip({ resources, manifest });
    expect(first).toEqual(second);
  });

  it('wraps resource JSON with the format version', () => {
    const files = unzipSync(buildArchiveZip({ resources, manifest }));
    const parsed = JSON.parse(
      new TextDecoder().decode(files[`${ARCHIVE_ROOT}/transactions.json`]!),
    );
    expect(parsed.formatVersion).toBe(ARCHIVE_FORMAT_VERSION);
    expect(parsed.records[0].amount_exact).toBe('1234.567890');
    expect(parsed.records[0].currency).toBe('TRY');
  });

  it('keeps exact money strings and never JSON-mangles decimals', () => {
    const files = unzipSync(buildArchiveZip({ resources, manifest }));
    const text = new TextDecoder().decode(files[`${ARCHIVE_ROOT}/transactions.json`]!);
    expect(text).toContain('"amount_exact": "1234.567890"');
  });

  it('never includes secret-bearing fields', () => {
    const files = unzipSync(buildArchiveZip({ resources, manifest }));
    const text = Object.values(files)
      .map((value) => new TextDecoder().decode(value))
      .join('\n');
    expect(text.toLowerCase()).not.toContain('password');
    expect(text.toLowerCase()).not.toContain('session');
    expect(text.toLowerCase()).not.toContain('token');
    expect(text.toLowerCase()).not.toContain('storage_key');
    expect(text.toLowerCase()).not.toContain('secret');
  });
});
