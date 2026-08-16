import { describe, expect, it } from 'vitest';
import { createCategory, updateCategory, createTag, updateTag } from '../src/index';
import {
  createMerchant,
  updateMerchant,
  createMerchantAlias,
  updateMerchantAlias,
  createManualTransferLink,
  actionInternalTransfer,
} from '../src/phase6';

function drizzleUniqueViolation(constraintName: string, message = 'duplicate key value') {
  const cause = Object.assign(new Error(message), {
    code: '23505',
    constraint_name: constraintName,
    severity: 'ERROR',
  });
  return Object.assign(new Error(`Failed query: insert into ... ${message}`), { cause });
}

function directUniqueViolation(constraintName: string) {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: constraintName,
  });
}

function foreignKeyViolation() {
  return Object.assign(new Error('foreign key violation'), { code: '23503' });
}

function mockInsertThrowing(error: unknown) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.reject(error),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.reject(error),
        }),
      }),
    }),
  };
}

function mockWithExistingRow(error: unknown, row: Record<string, unknown>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([row]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.reject(error),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.reject(error),
        }),
      }),
    }),
  };
}

describe('createCategory conflict mapping', () => {
  it('maps a Drizzle-wrapped unique violation on the root name constraint to CONFLICT', async () => {
    await expect(
      createCategory(
        mockInsertThrowing(drizzleUniqueViolation('categories_user_root_name_unique')) as never,
        'user-a',
        { name: 'Food', kind: 'expense', parentId: null },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('maps a Drizzle-wrapped unique violation on the parent name constraint to CONFLICT', async () => {
    const db = mockWithExistingRow(drizzleUniqueViolation('categories_user_parent_name_unique'), {
      id: 'parent',
      userId: 'user-a',
      name: 'P',
      normalizedName: 'p',
      parentId: null,
    });
    await expect(
      createCategory(db as never, 'user-a', {
        name: 'Food',
        kind: 'expense',
        parentId: 'parent',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('maps a direct PostgreSQL unique violation to CONFLICT', async () => {
    await expect(
      createCategory(
        mockInsertThrowing(directUniqueViolation('categories_user_root_name_unique')) as never,
        'user-a',
        { name: 'Food', kind: 'expense', parentId: null },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('does not map a unique violation on an unrelated constraint', async () => {
    await expect(
      createCategory(
        mockInsertThrowing(drizzleUniqueViolation('categories_id_user_id_unique')) as never,
        'user-a',
        { name: 'Food', kind: 'expense', parentId: null },
      ),
    ).rejects.toMatchObject({ message: /Failed query/ });
  });

  it('does not map a foreign-key violation to CONFLICT', async () => {
    await expect(
      createCategory(mockInsertThrowing(foreignKeyViolation()) as never, 'user-a', {
        name: 'Food',
        kind: 'expense',
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('propagates generic errors unchanged', async () => {
    await expect(
      createCategory(mockInsertThrowing(new Error('boom')) as never, 'user-a', {
        name: 'Food',
        kind: 'expense',
        parentId: null,
      }),
    ).rejects.toThrow('boom');
  });
});

describe('updateCategory conflict mapping', () => {
  it('maps a Drizzle-wrapped root name violation to CONFLICT', async () => {
    const db = mockWithExistingRow(drizzleUniqueViolation('categories_user_root_name_unique'), {
      id: 'cat-a',
      userId: 'user-a',
      name: 'Old',
      normalizedName: 'old',
    });
    await expect(
      updateCategory(db as never, 'user-a', 'cat-a', { name: 'New' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('createTag conflict mapping', () => {
  it('maps a Drizzle-wrapped name violation to CONFLICT', async () => {
    await expect(
      createTag(
        mockInsertThrowing(drizzleUniqueViolation('tags_user_normalized_name_unique')) as never,
        'user-a',
        { name: 'Weekly' },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('does not map a foreign-key violation to CONFLICT', async () => {
    await expect(
      createTag(mockInsertThrowing(foreignKeyViolation()) as never, 'user-a', { name: 'Weekly' }),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('updateTag conflict mapping', () => {
  it('maps a Drizzle-wrapped name violation to CONFLICT', async () => {
    const db = mockWithExistingRow(drizzleUniqueViolation('tags_user_normalized_name_unique'), {
      id: 'tag-a',
      userId: 'user-a',
      name: 'Old',
      normalizedName: 'old',
    });
    await expect(updateTag(db as never, 'user-a', 'tag-a', { name: 'New' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('createMerchant conflict mapping', () => {
  it('maps a Drizzle-wrapped name violation to CONFLICT', async () => {
    await expect(
      createMerchant(
        mockInsertThrowing(
          drizzleUniqueViolation('merchants_user_normalized_name_unique'),
        ) as never,
        'user-a',
        { displayName: 'Coffee', notes: null },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('maps a direct PostgreSQL name violation to CONFLICT', async () => {
    await expect(
      createMerchant(
        mockInsertThrowing(directUniqueViolation('merchants_user_normalized_name_unique')) as never,
        'user-a',
        { displayName: 'Coffee', notes: null },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('does not map an unrelated unique violation', async () => {
    await expect(
      createMerchant(
        mockInsertThrowing(drizzleUniqueViolation('merchants_id_user_id_unique')) as never,
        'user-a',
        { displayName: 'Coffee', notes: null },
      ),
    ).rejects.toMatchObject({ message: /Failed query/ });
  });

  it('does not map a foreign-key violation to CONFLICT', async () => {
    await expect(
      createMerchant(mockInsertThrowing(foreignKeyViolation()) as never, 'user-a', {
        displayName: 'Coffee',
        notes: null,
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('updateMerchant conflict mapping', () => {
  it('maps a Drizzle-wrapped name violation to CONFLICT', async () => {
    const db = mockWithExistingRow(
      drizzleUniqueViolation('merchants_user_normalized_name_unique'),
      { id: 'm-a', userId: 'user-a', displayName: 'Old', normalizedName: 'old', status: 'active' },
    );
    await expect(
      updateMerchant(db as never, 'user-a', 'm-a', { displayName: 'Coffee' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('createMerchantAlias conflict mapping', () => {
  it('maps a Drizzle-wrapped pattern violation to CONFLICT', async () => {
    const db = mockWithExistingRow(drizzleUniqueViolation('merchant_aliases_user_pattern_unique'), {
      id: 'm-a',
      userId: 'user-a',
      displayName: 'C',
      normalizedName: 'c',
      status: 'active',
    });
    await expect(
      createMerchantAlias(db as never, 'user-a', 'm-a', {
        rawPattern: 'Cafe',
        matchType: 'exact_normalized_description',
        enabled: true,
        priority: 100,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('updateMerchantAlias conflict mapping', () => {
  it('maps a Drizzle-wrapped pattern violation to CONFLICT', async () => {
    const db = mockWithExistingRow(drizzleUniqueViolation('merchant_aliases_user_pattern_unique'), {
      id: 'alias-a',
      userId: 'user-a',
      merchantId: 'm-a',
      rawPattern: 'Old',
      normalizedPattern: 'old',
      matchType: 'exact_normalized_description',
      enabled: true,
      priority: 100,
    });
    await expect(
      updateMerchantAlias(db as never, 'user-a', 'alias-a', { rawPattern: 'Cafe' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

function mockTransferLinkConflict(error: unknown) {
  const candidates = [
    {
      id: 'tx-out',
      amount: '100.000000',
      currencyCode: 'USD',
      direction: 'debit' as const,
      bookingDate: '2024-01-01',
      financialAccountId: 'acct-a',
      accountName: 'Account A',
      bankTransactionId: null,
      description: 'transfer out',
      rawDescription: 'transfer out',
      status: 'confirmed',
    },
    {
      id: 'tx-in',
      amount: '100.000000',
      currencyCode: 'USD',
      direction: 'credit' as const,
      bookingDate: '2024-01-01',
      financialAccountId: 'acct-b',
      accountName: 'Account B',
      bankTransactionId: null,
      description: 'transfer in',
      rawDescription: 'transfer in',
      status: 'confirmed',
    },
  ];
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve(candidates),
            }),
          }),
        }),
        where: () => Promise.resolve([]),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.reject(error),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.reject(error),
        }),
      }),
    }),
  };
}

function mockTransferLinkConfirmConflict(error: unknown) {
  const link = {
    id: 'link-a',
    userId: 'user-a',
    outgoingTransactionId: 'tx-out',
    incomingTransactionId: 'tx-in',
    status: 'suggested' as const,
    rejectedAt: null,
  };
  const candidates = [
    {
      id: 'tx-out',
      amount: '100.000000',
      currencyCode: 'USD',
      direction: 'debit' as const,
      bookingDate: '2024-01-01',
      financialAccountId: 'acct-a',
      accountName: 'Account A',
      bankTransactionId: null,
      description: 'transfer out',
      rawDescription: 'transfer out',
      status: 'confirmed',
    },
    {
      id: 'tx-in',
      amount: '100.000000',
      currencyCode: 'USD',
      direction: 'credit' as const,
      bookingDate: '2024-01-01',
      financialAccountId: 'acct-b',
      accountName: 'Account B',
      bankTransactionId: null,
      description: 'transfer in',
      rawDescription: 'transfer in',
      status: 'confirmed',
    },
  ];
  return {
    select: () => ({
      from: () => {
        const whereResult = Object.assign(Promise.resolve([]), {
          limit: () => Promise.resolve([link]),
        });
        return {
          where: () => whereResult,
          innerJoin: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve(candidates),
              }),
            }),
          }),
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.reject(error),
        }),
      }),
    }),
  };
}

describe('createManualTransferLink conflict mapping', () => {
  it('maps a Drizzle-wrapped pair violation to CONFLICT', async () => {
    const db = mockTransferLinkConflict(
      drizzleUniqueViolation('internal_transfer_links_pair_unique'),
    );
    await expect(
      createManualTransferLink(db as never, 'user-a', {
        outgoingTransactionId: 'tx-out',
        incomingTransactionId: 'tx-in',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('maps a confirmed outgoing partial-index violation to CONFLICT', async () => {
    const db = mockTransferLinkConflict(
      drizzleUniqueViolation('internal_transfer_links_confirmed_outgoing_unique'),
    );
    await expect(
      createManualTransferLink(db as never, 'user-a', {
        outgoingTransactionId: 'tx-out',
        incomingTransactionId: 'tx-in',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('actionInternalTransfer confirm conflict mapping', () => {
  it('maps a Drizzle-wrapped confirmed outgoing violation to CONFLICT', async () => {
    const db = mockTransferLinkConfirmConflict(
      drizzleUniqueViolation('internal_transfer_links_confirmed_outgoing_unique'),
    );
    await expect(
      actionInternalTransfer(db as never, 'user-a', 'link-a', 'confirm'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
