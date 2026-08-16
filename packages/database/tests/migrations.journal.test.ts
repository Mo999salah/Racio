import { describe, expect, it } from 'vitest';
import {
  EXPECTED_MIGRATION_COUNT,
  expectedMigrationCount,
  expectedMigrationTags,
} from '../src/migrations';

describe('migration journal contract', () => {
  it('keeps the compiled expected count in sync with the journal', () => {
    expect(EXPECTED_MIGRATION_COUNT).toBe(expectedMigrationCount());
  });

  it('lists the full chain from 0000 to 0013 in order', () => {
    const tags = expectedMigrationTags();
    expect(tags.length).toBe(EXPECTED_MIGRATION_COUNT);
    expect(tags[0]).toBe('0000_rainy_starhawk');
    expect(tags[tags.length - 1]).toMatch(/^0013_/u);
    for (let i = 1; i < tags.length; i += 1) {
      expect(tags[i]?.startsWith(`00${i.toString().padStart(2, '0')}_`)).toBe(true);
    }
  });
});
