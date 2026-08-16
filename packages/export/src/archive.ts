import { strToU8, zipSync } from 'fflate';

/**
 * Structured machine-readable archive.
 *
 * - Schema-versioned (`formatVersion: "1"`); the archive is an export
 *   format, not an import/restore format.
 * - Deterministic entry order, relative paths only, no traversal, no
 *   symlinks, no absolute paths, fixed archive mtime so bytes are stable
 *   for identical content.
 * - Monetary values are canonical decimal strings with explicit currency
 *   codes; JSON timestamps are ISO-8601 UTC.
 */

export const ARCHIVE_FORMAT_VERSION = '1';
export const ARCHIVE_ROOT = 'racio-export';

export type ArchiveResource = {
  fileName: string;
  records: unknown[];
};

export type ArchiveManifest = {
  formatVersion: string;
  generatedAt: string;
  application: 'Racio';
  includedResources: string[];
  locale: string;
  timezone: string;
  counts: Record<string, number>;
};

export function buildArchiveManifest(input: {
  generatedAt: string;
  locale: string;
  timezone: string;
  resources: ArchiveResource[];
}): ArchiveManifest {
  const includedResources = input.resources.map((resource) =>
    resource.fileName.replace(/\.json$/u, ''),
  );
  return {
    formatVersion: ARCHIVE_FORMAT_VERSION,
    generatedAt: input.generatedAt,
    application: 'Racio',
    includedResources,
    locale: input.locale,
    timezone: input.timezone,
    counts: Object.fromEntries(
      input.resources.map((resource) => [resource.fileName, resource.records.length]),
    ),
  };
}

export function buildArchiveZip(input: {
  resources: ArchiveResource[];
  manifest: ArchiveManifest;
}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [`${ARCHIVE_ROOT}/manifest.json`]: strToU8(JSON.stringify(input.manifest, null, 2)),
  };
  for (const resource of input.resources) {
    files[`${ARCHIVE_ROOT}/${resource.fileName}`] = strToU8(
      JSON.stringify({ formatVersion: ARCHIVE_FORMAT_VERSION, records: resource.records }, null, 2),
    );
  }
  return zipSync(files, { level: 6, mtime: new Date(Date.UTC(2000, 0, 1)) });
}
