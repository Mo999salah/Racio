import { describe, expect, it } from 'vitest';
import {
  inspectPostgresError,
  isPostgresUniqueViolation,
  isPostgresUniqueViolationOn,
} from '../src/postgres-errors';

describe('inspectPostgresError', () => {
  it('recognizes a direct PostgreSQL unique-constraint error', () => {
    const error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'financial_accounts_user_institution_unique',
    });
    expect(inspectPostgresError(error)).toEqual({
      code: '23505',
      constraintName: 'financial_accounts_user_institution_unique',
    });
    expect(isPostgresUniqueViolation(error)).toBe(true);
  });

  it('reads constraint_name in addition to code', () => {
    const error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'x',
    });
    expect(inspectPostgresError(error).constraintName).toBe('x');
  });

  it('falls back to the pg driver constraint field', () => {
    const error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'financial_accounts_user_institution_unique',
    });
    expect(inspectPostgresError(error).constraintName).toBe(
      'financial_accounts_user_institution_unique',
    );
  });

  it('recognizes a Drizzle-wrapped error through cause', () => {
    const cause = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint_name: 'financial_accounts_user_institution_unique',
    });
    const wrapped = Object.assign(new Error('Failed query: insert ...'), { cause });
    expect(isPostgresUniqueViolation(wrapped)).toBe(true);
    expect(isPostgresUniqueViolationOn(wrapped, 'financial_accounts_user_institution_unique')).toBe(
      true,
    );
  });

  it('does not classify a non-unique PostgreSQL error as a unique violation', () => {
    const error = Object.assign(new Error('foreign key'), { code: '23503' });
    expect(isPostgresUniqueViolation(error)).toBe(false);
    expect(inspectPostgresError(error)).toEqual({ code: '23503' });
  });

  it('does not classify a generic Error as a unique violation', () => {
    expect(isPostgresUniqueViolation(new Error('boom'))).toBe(false);
    expect(inspectPostgresError(new Error('boom'))).toEqual({});
  });

  it('handles unknown and nullish inputs', () => {
    expect(isPostgresUniqueViolation(undefined)).toBe(false);
    expect(isPostgresUniqueViolation(null)).toBe(false);
    expect(isPostgresUniqueViolation('text')).toBe(false);
    expect(isPostgresUniqueViolation(42)).toBe(false);
    expect(inspectPostgresError(undefined)).toEqual({});
    expect(inspectPostgresError(null)).toEqual({});
  });

  it('requires the constraint name when one is provided', () => {
    const error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'some_other_unique',
    });
    expect(isPostgresUniqueViolationOn(error, 'financial_accounts_user_institution_unique')).toBe(
      false,
    );
  });

  it('walks nested causes up to the bounded depth', () => {
    const cause = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint_name: 'merchants_user_normalized_name_unique',
    });
    let error: unknown = cause;
    for (let i = 0; i < 3; i += 1) error = Object.assign(new Error('wrap'), { cause: error });
    expect(isPostgresUniqueViolation(error)).toBe(true);
    expect(inspectPostgresError(error).constraintName).toBe(
      'merchants_user_normalized_name_unique',
    );
  });

  it('returns empty info for an error with a non-PostgreSQL code string', () => {
    const error = Object.assign(new Error('custom'), { code: 'E_NOPE' });
    expect(inspectPostgresError(error)).toEqual({});
    expect(isPostgresUniqueViolation(error)).toBe(false);
  });
});
