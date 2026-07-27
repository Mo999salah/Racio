import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/index';

describe('database boundary', () => {
  it('rejects non-PostgreSQL URLs before opening a client', () => {
    expect(() => createDatabase('file:./racio.db')).toThrow(/PostgreSQL/);
  });
});
