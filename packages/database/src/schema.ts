import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  type AnyPgColumn,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Non-financial bootstrap table only. The production financial schema is deferred. */
export const systemMetadata = pgTable('system_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  locale: text('locale').notNull().default('en'),
  timeZone: text('time_zone').notNull().default('UTC'),
  interfaceMode: text('interface_mode').notNull().default('easy'),
  appearance: text('appearance').notNull().default('system'),
  baseCurrency: text('base_currency'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const financialAccountType = pgEnum('financial_account_type', [
  'checking',
  'savings',
  'credit',
  'cash',
  'other',
]);

export const financialAccountStatus = pgEnum('financial_account_status', ['active', 'archived']);

export const statementSourceType = pgEnum('statement_source_type', ['csv']);
export const statementProcessingStatus = pgEnum('statement_processing_status', [
  'uploaded',
  'parsing',
  'needs_mapping',
  'needs_review',
  'ready',
  'imported',
  'failed',
]);
export const statementReconciliationStatus = pgEnum('statement_reconciliation_status', [
  'matched',
  'mismatch',
  'unverifiable',
  'not_run',
]);
export const importJobStatus = pgEnum('import_job_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);
export const rawReviewStatus = pgEnum('raw_review_status', [
  'valid',
  'needs_review',
  'invalid',
  'excluded',
  'duplicate_candidate',
]);
export const duplicateStatus = pgEnum('duplicate_status', ['none', 'exact', 'probable']);
export const transactionDirection = pgEnum('transaction_direction', ['credit', 'debit', 'unknown']);
export const statementDuplicateState = pgEnum('statement_duplicate_state', [
  'safe_to_continue',
  'previously_uploaded',
  'previously_imported',
]);
export const finalTransactionStatus = pgEnum('final_transaction_status', ['confirmed', 'archived']);
export const categoryKind = pgEnum('category_kind', ['expense', 'income', 'transfer', 'neutral']);
export const categoryStatus = pgEnum('category_status', ['active', 'archived']);
export const categoryAssignmentRole = pgEnum('category_assignment_role', ['primary', 'secondary']);
export const classificationSource = pgEnum('classification_source', [
  'manual',
  'rule',
  'import',
  'system',
]);
export const classificationRuleMatchMode = pgEnum('classification_rule_match_mode', ['all', 'any']);
export const classificationRuleScope = pgEnum('classification_rule_scope', [
  'future_only',
  'historical_and_future',
]);
export const merchantStatus = pgEnum('merchant_status', ['active', 'archived', 'merged']);
export const merchantSource = pgEnum('merchant_source', ['manual', 'alias', 'import', 'system']);
export const merchantAliasMatchType = pgEnum('merchant_alias_match_type', [
  'exact_normalized_description',
  'normalized_description_contains',
  'normalized_description_starts_with',
  'exact_counterparty',
  'counterparty_contains',
]);
export const transferStatus = pgEnum('transfer_status', [
  'suggested',
  'confirmed',
  'rejected',
  'unlinked',
]);
export const transferSource = pgEnum('transfer_source', ['system', 'manual']);

export const institutions = pgTable(
  'institutions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    countryCode: text('country_code').notNull(),
    websiteUrl: text('website_url'),
    logoUrl: text('logo_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('institutions_user_id_idx').on(table.userId),
    userNormalizedNameUnique: unique('institutions_user_normalized_name_unique').on(
      table.userId,
      table.normalizedName,
    ),
    idUserUnique: unique('institutions_id_user_id_unique').on(table.id, table.userId),
    nameNotEmpty: check('institutions_name_not_empty', sql`length(btrim(${table.name})) > 0`),
    normalizedNameNotEmpty: check(
      'institutions_normalized_name_not_empty',
      sql`length(btrim(${table.normalizedName})) > 0`,
    ),
    countryCodeFormat: check(
      'institutions_country_code_format',
      sql`${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
  }),
);

export const financialAccounts = pgTable(
  'financial_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    institutionId: text('institution_id').notNull(),
    displayName: text('display_name').notNull(),
    accountType: financialAccountType('account_type').notNull(),
    currencyCode: text('currency_code').notNull(),
    maskedAccountIdentifier: text('masked_account_identifier'),
    maskedIban: text('masked_iban'),
    status: financialAccountStatus('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userStatusIdx: index('financial_accounts_user_status_idx').on(table.userId, table.status),
    institutionIdx: index('financial_accounts_institution_id_idx').on(table.institutionId),
    userInstitutionUnique: unique('financial_accounts_user_institution_unique').on(
      table.userId,
      table.institutionId,
    ),
    ownerInstitutionFk: foreignKey({
      columns: [table.institutionId, table.userId],
      foreignColumns: [institutions.id, institutions.userId],
      name: 'financial_accounts_owner_institution_fk',
    }),
    displayNameNotEmpty: check(
      'financial_accounts_display_name_not_empty',
      sql`length(btrim(${table.displayName})) > 0`,
    ),
    currencyCodeFormat: check(
      'financial_accounts_currency_code_format',
      sql`${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
    maskedAccountIdentifierNotFull: check(
      'financial_accounts_masked_account_identifier_not_full',
      sql`${table.maskedAccountIdentifier} IS NULL OR ${table.maskedAccountIdentifier} !~ '^[0-9][0-9 -]{7,}$'`,
    ),
    maskedIbanNotFull: check(
      'financial_accounts_masked_iban_not_full',
      sql`${table.maskedIban} IS NULL OR upper(regexp_replace(${table.maskedIban}, '[ -]', '', 'g')) !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,}$'`,
    ),
    archiveStateConsistent: check(
      'financial_accounts_archive_state_consistent',
      sql`(${table.status} = 'active' AND ${table.archivedAt} IS NULL) OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL)`,
    ),
  }),
);

export const merchants = pgTable(
  'merchants',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    notes: text('notes'),
    status: merchantStatus('status').notNull().default('active'),
    mergedIntoMerchantId: text('merged_into_merchant_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    userStatusIdx: index('merchants_user_status_idx').on(table.userId, table.status),
    normalizedNameUnique: unique('merchants_user_normalized_name_unique').on(
      table.userId,
      table.normalizedName,
    ),
    idUserUnique: unique('merchants_id_user_id_unique').on(table.id, table.userId),
    ownerMergedIntoFk: foreignKey({
      columns: [table.mergedIntoMerchantId, table.userId],
      foreignColumns: [table.id, table.userId],
      name: 'merchants_owner_merged_into_fk',
    }),
    displayNameNotEmpty: check(
      'merchants_display_name_not_empty',
      sql`length(btrim(${table.displayName})) > 0`,
    ),
    normalizedNameNotEmpty: check(
      'merchants_normalized_name_not_empty',
      sql`length(btrim(${table.normalizedName})) > 0`,
    ),
    mergeStateConsistent: check(
      'merchants_merge_state_consistent',
      sql`(${table.status} = 'merged' AND ${table.mergedIntoMerchantId} IS NOT NULL) OR (${table.status} <> 'merged' AND ${table.mergedIntoMerchantId} IS NULL)`,
    ),
    archiveStateConsistent: check(
      'merchants_archive_state_consistent',
      sql`(${table.status} = 'active' AND ${table.archivedAt} IS NULL) OR (${table.status} <> 'active')`,
    ),
  }),
);

export const statements = pgTable(
  'statements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    financialAccountId: text('financial_account_id').notNull(),
    sourceType: statementSourceType('source_type').notNull().default('csv'),
    originalFilename: text('original_filename').notNull(),
    fileSize: integer('file_size').notNull(),
    fileChecksum: text('file_checksum').notNull(),
    storageKey: text('storage_key'),
    retainOriginalFile: boolean('retain_original_file').notNull().default(false),
    processingStatus: statementProcessingStatus('processing_status').notNull().default('uploaded'),
    duplicateState: statementDuplicateState('duplicate_state')
      .notNull()
      .default('safe_to_continue'),
    uploadIdempotencyKey: text('upload_idempotency_key').notNull(),
    mappingSnapshot: jsonb('mapping_snapshot'),
    detectedLanguage: text('detected_language'),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    currencyCode: text('currency_code'),
    openingBalance: numeric('opening_balance', { precision: 20, scale: 6 }),
    closingBalance: numeric('closing_balance', { precision: 20, scale: 6 }),
    reconciliationExpectedClosing: numeric('reconciliation_expected_closing', {
      precision: 20,
      scale: 6,
    }),
    reconciliationStatedClosing: numeric('reconciliation_stated_closing', {
      precision: 20,
      scale: 6,
    }),
    reconciliationDifference: numeric('reconciliation_difference', { precision: 20, scale: 6 }),
    reconciliationTolerance: numeric('reconciliation_tolerance', { precision: 20, scale: 6 })
      .notNull()
      .default('0.000001'),
    reconciliationReason: text('reconciliation_reason'),
    reconciliationStatus: statementReconciliationStatus('reconciliation_status')
      .notNull()
      .default('not_run'),
    confirmationIdempotencyKey: text('confirmation_idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    userCreatedIdx: index('statements_user_created_idx').on(table.userId, table.createdAt),
    accountIdx: index('statements_account_idx').on(table.financialAccountId),
    checksumIdx: index('statements_checksum_idx').on(table.userId, table.fileChecksum),
    statusIdx: index('statements_status_idx').on(table.userId, table.processingStatus),
    idUserUnique: unique('statements_id_user_id_unique').on(table.id, table.userId),
    uploadKeyUnique: unique('statements_user_upload_key_unique').on(
      table.userId,
      table.uploadIdempotencyKey,
    ),
    ownerAccountFk: foreignKey({
      columns: [table.financialAccountId, table.userId],
      foreignColumns: [financialAccounts.id, financialAccounts.userId],
      name: 'statements_owner_account_fk',
    }),
    filenameNotEmpty: check(
      'statements_filename_not_empty',
      sql`length(btrim(${table.originalFilename})) > 0`,
    ),
    checksumFormat: check(
      'statements_checksum_format',
      sql`${table.fileChecksum} ~ '^[a-f0-9]{64}$'`,
    ),
    periodRange: check(
      'statements_period_range',
      sql`${table.periodStart} IS NULL OR ${table.periodEnd} IS NULL OR ${table.periodStart} <= ${table.periodEnd}`,
    ),
  }),
);

export const importJobs = pgTable(
  'import_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    statementId: text('statement_id').notNull(),
    jobType: text('job_type').notNull().default('statement.parse.csv'),
    status: importJobStatus('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    parserVersion: text('parser_version'),
    rowCount: integer('row_count'),
    candidateCount: integer('candidate_count'),
    warningCount: integer('warning_count'),
    errorCode: text('error_code'),
    errorMessageSafe: text('error_message_safe'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => ({
    userStatusIdx: index('import_jobs_user_status_idx').on(table.userId, table.status),
    statementIdx: index('import_jobs_statement_idx').on(table.statementId),
    idUserUnique: unique('import_jobs_id_user_id_unique').on(table.id, table.userId),
    ownerStatementFk: foreignKey({
      columns: [table.statementId, table.userId],
      foreignColumns: [statements.id, statements.userId],
      name: 'import_jobs_owner_statement_fk',
    }),
  }),
);

export const rawTransactions = pgTable(
  'raw_transactions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    statementId: text('statement_id').notNull(),
    financialAccountId: text('financial_account_id').notNull(),
    sourceRow: integer('source_row').notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    rawDescription: text('raw_description').notNull().default(''),
    rawBookingDate: text('raw_booking_date'),
    rawValueDate: text('raw_value_date'),
    rawAmount: text('raw_amount'),
    rawCurrency: text('raw_currency'),
    rawBalance: text('raw_balance'),
    bookingDate: date('booking_date'),
    valueDate: date('value_date'),
    amount: numeric('amount', { precision: 20, scale: 6 }),
    currencyCode: text('currency_code'),
    direction: transactionDirection('direction').notNull().default('unknown'),
    balanceAfter: numeric('balance_after', { precision: 20, scale: 6 }),
    counterparty: text('counterparty'),
    bankTransactionId: text('bank_transaction_id'),
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    fieldConfidence: jsonb('field_confidence'),
    warnings: jsonb('warnings').notNull().default([]),
    userCorrections: jsonb('user_corrections').notNull().default([]),
    reviewStatus: rawReviewStatus('review_status').notNull().default('needs_review'),
    duplicateStatus: duplicateStatus('duplicate_status').notNull().default('none'),
    duplicateFingerprint: text('duplicate_fingerprint'),
    duplicateMatchReasons: jsonb('duplicate_match_reasons'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statementReviewIdx: index('raw_transactions_statement_review_idx').on(
      table.statementId,
      table.reviewStatus,
    ),
    fingerprintIdx: index('raw_transactions_fingerprint_idx').on(
      table.userId,
      table.duplicateFingerprint,
    ),
    statementRowUnique: unique('raw_transactions_statement_row_unique').on(
      table.statementId,
      table.sourceRow,
    ),
    ownerStatementFk: foreignKey({
      columns: [table.statementId, table.userId],
      foreignColumns: [statements.id, statements.userId],
      name: 'raw_transactions_owner_statement_fk',
    }),
    ownerAccountFk: foreignKey({
      columns: [table.financialAccountId, table.userId],
      foreignColumns: [financialAccounts.id, financialAccounts.userId],
      name: 'raw_transactions_owner_account_fk',
    }),
    sourceRowPositive: check('raw_transactions_source_row_positive', sql`${table.sourceRow} > 0`),
  }),
);

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    financialAccountId: text('financial_account_id').notNull(),
    statementId: text('statement_id').notNull(),
    sourceRawTransactionId: text('source_raw_transaction_id').notNull(),
    bookingDate: date('booking_date').notNull(),
    valueDate: date('value_date'),
    amount: numeric('amount', { precision: 20, scale: 6 }).notNull(),
    currencyCode: text('currency_code').notNull(),
    direction: transactionDirection('direction').notNull(),
    balanceAfter: numeric('balance_after', { precision: 20, scale: 6 }),
    rawDescription: text('raw_description').notNull(),
    importedDescription: text('imported_description').notNull().default(''),
    normalizedDescription: text('normalized_description').notNull(),
    counterparty: text('counterparty'),
    userDescription: text('user_description'),
    userCounterparty: text('user_counterparty'),
    userNote: text('user_note'),
    merchantId: text('merchant_id'),
    merchantSource: merchantSource('merchant_source'),
    merchantConfidence: numeric('merchant_confidence', { precision: 5, scale: 4 }),
    merchantUpdatedAt: timestamp('merchant_updated_at', { withTimezone: true }),
    ruleSuppressionIds: jsonb('rule_suppression_ids').notNull().default([]),
    reviewed: boolean('reviewed').notNull().default(false),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedByUserId: text('reviewed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    bankTransactionId: text('bank_transaction_id'),
    sourceType: statementSourceType('source_type').notNull().default('csv'),
    status: finalTransactionStatus('status').notNull().default('confirmed'),
    duplicateFingerprint: text('duplicate_fingerprint'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountDateIdx: index('transactions_account_date_idx').on(
      table.userId,
      table.financialAccountId,
      table.bookingDate,
    ),
    fingerprintIdx: index('transactions_fingerprint_idx').on(
      table.userId,
      table.duplicateFingerprint,
    ),
    sourceUnique: unique('transactions_source_raw_unique').on(table.sourceRawTransactionId),
    idUserUnique: unique('transactions_id_user_id_unique').on(table.id, table.userId),
    ownerAccountFk: foreignKey({
      columns: [table.financialAccountId, table.userId],
      foreignColumns: [financialAccounts.id, financialAccounts.userId],
      name: 'transactions_owner_account_fk',
    }),
    ownerStatementFk: foreignKey({
      columns: [table.statementId, table.userId],
      foreignColumns: [statements.id, statements.userId],
      name: 'transactions_owner_statement_fk',
    }),
    ownerRawFk: foreignKey({
      columns: [table.sourceRawTransactionId, table.userId],
      foreignColumns: [rawTransactions.id, rawTransactions.userId],
      name: 'transactions_owner_raw_fk',
    }),
    ownerMerchantFk: foreignKey({
      columns: [table.merchantId, table.userId],
      foreignColumns: [merchants.id, merchants.userId],
      name: 'transactions_owner_merchant_fk',
    }),
    currencyCodeFormat: check(
      'transactions_currency_code_format',
      sql`${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
  }),
);

export const transactionSplits = pgTable(
  'transaction_splits',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    transactionId: text('transaction_id').notNull(),
    position: integer('position').notNull(),
    amount: numeric('amount', { precision: 20, scale: 6 }).notNull(),
    currencyCode: text('currency_code').notNull(),
    description: text('description'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    transactionPositionUnique: unique('transaction_splits_transaction_position_unique').on(
      table.userId,
      table.transactionId,
      table.position,
    ),
    transactionIdx: index('transaction_splits_transaction_idx').on(
      table.userId,
      table.transactionId,
      table.archivedAt,
    ),
    ownerTransactionFk: foreignKey({
      columns: [table.transactionId, table.userId],
      foreignColumns: [transactions.id, transactions.userId],
      name: 'transaction_splits_owner_transaction_fk',
    }),
    positionRange: check(
      'transaction_splits_position_range',
      sql`${table.position} >= 0 AND ${table.position} < 50`,
    ),
    currencyCodeFormat: check(
      'transaction_splits_currency_code_format',
      sql`${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
  }),
);

export const merchantAliases = pgTable(
  'merchant_aliases',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    merchantId: text('merchant_id').notNull(),
    rawPattern: text('raw_pattern').notNull(),
    normalizedPattern: text('normalized_pattern').notNull(),
    matchType: merchantAliasMatchType('match_type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    userEnabledPriorityIdx: index('merchant_aliases_user_enabled_priority_idx').on(
      table.userId,
      table.enabled,
      table.priority,
      table.createdAt,
      table.id,
    ),
    merchantIdx: index('merchant_aliases_merchant_idx').on(table.userId, table.merchantId),
    patternUnique: unique('merchant_aliases_user_pattern_unique').on(
      table.userId,
      table.merchantId,
      table.matchType,
      table.normalizedPattern,
    ),
    ownerMerchantFk: foreignKey({
      columns: [table.merchantId, table.userId],
      foreignColumns: [merchants.id, merchants.userId],
      name: 'merchant_aliases_owner_merchant_fk',
    }),
    rawPatternNotEmpty: check(
      'merchant_aliases_raw_pattern_not_empty',
      sql`length(btrim(${table.rawPattern})) > 0`,
    ),
    normalizedPatternNotEmpty: check(
      'merchant_aliases_normalized_pattern_not_empty',
      sql`length(btrim(${table.normalizedPattern})) > 0`,
    ),
    priorityRange: check(
      'merchant_aliases_priority_range',
      sql`${table.priority} >= 0 AND ${table.priority} <= 10000`,
    ),
  }),
);

export const merchantMergeEvents = pgTable(
  'merchant_merge_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sourceMerchantId: text('source_merchant_id').notNull(),
    targetMerchantId: text('target_merchant_id').notNull(),
    transactionAssignments: jsonb('transaction_assignments').notNull(),
    aliasAssignments: jsonb('alias_assignments').notNull(),
    sourceStatusBefore: merchantStatus('source_status_before').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    partialUnmerge: boolean('partial_unmerge').notNull().default(false),
  },
  (table) => ({
    userCreatedIdx: index('merchant_merge_events_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
    ownerSourceFk: foreignKey({
      columns: [table.sourceMerchantId, table.userId],
      foreignColumns: [merchants.id, merchants.userId],
      name: 'merchant_merge_events_owner_source_fk',
    }),
    ownerTargetFk: foreignKey({
      columns: [table.targetMerchantId, table.userId],
      foreignColumns: [merchants.id, merchants.userId],
      name: 'merchant_merge_events_owner_target_fk',
    }),
    differentMerchants: check(
      'merchant_merge_events_different_merchants',
      sql`${table.sourceMerchantId} <> ${table.targetMerchantId}`,
    ),
  }),
);

export const internalTransferLinks = pgTable(
  'internal_transfer_links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    outgoingTransactionId: text('outgoing_transaction_id').notNull(),
    incomingTransactionId: text('incoming_transaction_id').notNull(),
    status: transferStatus('status').notNull().default('suggested'),
    matchScore: integer('match_score'),
    matchReasons: jsonb('match_reasons').notNull().default([]),
    source: transferSource('source').notNull().default('system'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pairUnique: unique('internal_transfer_links_pair_unique').on(
      table.userId,
      table.outgoingTransactionId,
      table.incomingTransactionId,
    ),
    userStatusIdx: index('internal_transfer_links_user_status_idx').on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    outgoingIdx: index('internal_transfer_links_outgoing_idx').on(
      table.userId,
      table.outgoingTransactionId,
    ),
    incomingIdx: index('internal_transfer_links_incoming_idx').on(
      table.userId,
      table.incomingTransactionId,
    ),
    confirmedOutgoingUnique: uniqueIndex('internal_transfer_links_confirmed_outgoing_unique')
      .on(table.userId, table.outgoingTransactionId)
      .where(sql`${table.status} = 'confirmed'`),
    confirmedIncomingUnique: uniqueIndex('internal_transfer_links_confirmed_incoming_unique')
      .on(table.userId, table.incomingTransactionId)
      .where(sql`${table.status} = 'confirmed'`),
    ownerOutgoingFk: foreignKey({
      columns: [table.outgoingTransactionId, table.userId],
      foreignColumns: [transactions.id, transactions.userId],
      name: 'internal_transfer_links_owner_outgoing_fk',
    }),
    ownerIncomingFk: foreignKey({
      columns: [table.incomingTransactionId, table.userId],
      foreignColumns: [transactions.id, transactions.userId],
      name: 'internal_transfer_links_owner_incoming_fk',
    }),
    distinctTransactions: check(
      'internal_transfer_links_distinct_transactions',
      sql`${table.outgoingTransactionId} <> ${table.incomingTransactionId}`,
    ),
  }),
);

export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    templateKey: text('template_key'),
    parentId: text('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'set null',
    }),
    kind: categoryKind('kind').notNull(),
    iconKey: text('icon_key'),
    colourKey: text('colour_key'),
    status: categoryStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    userStatusIdx: index('categories_user_status_idx').on(table.userId, table.status),
    userTemplateIdx: index('categories_user_template_idx').on(table.userId, table.templateKey),
    templateUnique: uniqueIndex('categories_user_template_unique')
      .on(table.userId, table.templateKey)
      .where(sql`${table.templateKey} IS NOT NULL`),
    rootNameUnique: uniqueIndex('categories_user_root_name_unique')
      .on(table.userId, table.normalizedName)
      .where(sql`${table.parentId} IS NULL`),
    childNameUnique: uniqueIndex('categories_user_parent_name_unique')
      .on(table.userId, table.parentId, table.normalizedName)
      .where(sql`${table.parentId} IS NOT NULL`),
    idUserUnique: unique('categories_id_user_id_unique').on(table.id, table.userId),
    nameNotEmpty: check('categories_name_not_empty', sql`length(btrim(${table.name})) > 0`),
    normalizedNameNotEmpty: check(
      'categories_normalized_name_not_empty',
      sql`length(btrim(${table.normalizedName})) > 0`,
    ),
    parentNotSelf: check(
      'categories_parent_not_self',
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
    archiveStateConsistent: check(
      'categories_archive_state_consistent',
      sql`(${table.status} = 'active' AND ${table.archivedAt} IS NULL) OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL)`,
    ),
  }),
);

export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    userNameUnique: unique('tags_user_normalized_name_unique').on(
      table.userId,
      table.normalizedName,
    ),
    userArchivedIdx: index('tags_user_archived_idx').on(table.userId, table.archivedAt),
    idUserUnique: unique('tags_id_user_id_unique').on(table.id, table.userId),
    nameNotEmpty: check('tags_name_not_empty', sql`length(btrim(${table.name})) > 0`),
  }),
);

export const classificationRules = pgTable(
  'classification_rules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(100),
    conditionsVersion: integer('conditions_version').notNull().default(1),
    conditions: jsonb('conditions').notNull(),
    actionsVersion: integer('actions_version').notNull().default(1),
    actions: jsonb('actions').notNull(),
    matchMode: classificationRuleMatchMode('match_mode').notNull().default('all'),
    applyScope: classificationRuleScope('apply_scope').notNull().default('future_only'),
    lastAppliedAt: timestamp('last_applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    userEnabledPriorityIdx: index('classification_rules_user_enabled_priority_idx').on(
      table.userId,
      table.enabled,
      table.priority,
      table.createdAt,
      table.id,
    ),
    idUserUnique: unique('classification_rules_id_user_id_unique').on(table.id, table.userId),
    nameNotEmpty: check(
      'classification_rules_name_not_empty',
      sql`length(btrim(${table.name})) > 0`,
    ),
  }),
);

export const transactionCategoryAssignments = pgTable(
  'transaction_category_assignments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    transactionId: text('transaction_id').notNull(),
    categoryId: text('category_id').notNull(),
    role: categoryAssignmentRole('role').notNull(),
    source: classificationSource('source').notNull(),
    ruleId: text('rule_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    transactionIdx: index('transaction_category_assignments_transaction_idx').on(
      table.userId,
      table.transactionId,
      table.role,
    ),
    categoryIdx: index('transaction_category_assignments_category_idx').on(
      table.userId,
      table.categoryId,
    ),
    onePrimary: uniqueIndex('transaction_category_assignments_one_primary')
      .on(table.userId, table.transactionId)
      .where(sql`${table.role} = 'primary'`),
    duplicateAssignment: unique('transaction_category_assignments_unique').on(
      table.userId,
      table.transactionId,
      table.categoryId,
      table.role,
    ),
    ownerTransactionFk: foreignKey({
      columns: [table.transactionId, table.userId],
      foreignColumns: [transactions.id, transactions.userId],
      name: 'transaction_category_assignments_owner_transaction_fk',
    }),
    ownerCategoryFk: foreignKey({
      columns: [table.categoryId, table.userId],
      foreignColumns: [categories.id, categories.userId],
      name: 'transaction_category_assignments_owner_category_fk',
    }),
    ownerRuleFk: foreignKey({
      columns: [table.ruleId, table.userId],
      foreignColumns: [classificationRules.id, classificationRules.userId],
      name: 'transaction_category_assignments_owner_rule_fk',
    }),
  }),
);

export const transactionTags = pgTable(
  'transaction_tags',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    transactionId: text('transaction_id').notNull(),
    tagId: text('tag_id').notNull(),
    source: classificationSource('source').notNull(),
    ruleId: text('rule_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    transactionIdx: index('transaction_tags_transaction_idx').on(table.userId, table.transactionId),
    tagIdx: index('transaction_tags_tag_idx').on(table.userId, table.tagId),
    duplicateAssignment: unique('transaction_tags_unique').on(
      table.userId,
      table.transactionId,
      table.tagId,
    ),
    ownerTransactionFk: foreignKey({
      columns: [table.transactionId, table.userId],
      foreignColumns: [transactions.id, transactions.userId],
      name: 'transaction_tags_owner_transaction_fk',
    }),
    ownerTagFk: foreignKey({
      columns: [table.tagId, table.userId],
      foreignColumns: [tags.id, tags.userId],
      name: 'transaction_tags_owner_tag_fk',
    }),
    ownerRuleFk: foreignKey({
      columns: [table.ruleId, table.userId],
      foreignColumns: [classificationRules.id, classificationRules.userId],
      name: 'transaction_tags_owner_rule_fk',
    }),
  }),
);

export const transactionSplitCategoryAssignments = pgTable(
  'transaction_split_category_assignments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    splitId: text('split_id').notNull(),
    categoryId: text('category_id').notNull(),
    role: categoryAssignmentRole('role').notNull(),
    source: classificationSource('source').notNull(),
    ruleId: text('rule_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    splitIdx: index('transaction_split_category_assignments_split_idx').on(
      table.userId,
      table.splitId,
      table.role,
    ),
    categoryIdx: index('transaction_split_category_assignments_category_idx').on(
      table.userId,
      table.categoryId,
    ),
    onePrimary: uniqueIndex('transaction_split_category_assignments_one_primary')
      .on(table.userId, table.splitId)
      .where(sql`${table.role} = 'primary'`),
    duplicateAssignment: unique('transaction_split_category_assignments_unique').on(
      table.userId,
      table.splitId,
      table.categoryId,
      table.role,
    ),
    ownerSplitFk: foreignKey({
      columns: [table.splitId, table.userId],
      foreignColumns: [transactionSplits.id, transactionSplits.userId],
      name: 'transaction_split_category_assignments_owner_split_fk',
    }),
    ownerCategoryFk: foreignKey({
      columns: [table.categoryId, table.userId],
      foreignColumns: [categories.id, categories.userId],
      name: 'transaction_split_category_assignments_owner_category_fk',
    }),
    ownerRuleFk: foreignKey({
      columns: [table.ruleId, table.userId],
      foreignColumns: [classificationRules.id, classificationRules.userId],
      name: 'transaction_split_category_assignments_owner_rule_fk',
    }),
  }),
);

export const transactionSplitTags = pgTable(
  'transaction_split_tags',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    splitId: text('split_id').notNull(),
    tagId: text('tag_id').notNull(),
    source: classificationSource('source').notNull(),
    ruleId: text('rule_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    splitIdx: index('transaction_split_tags_split_idx').on(table.userId, table.splitId),
    tagIdx: index('transaction_split_tags_tag_idx').on(table.userId, table.tagId),
    duplicateAssignment: unique('transaction_split_tags_unique').on(
      table.userId,
      table.splitId,
      table.tagId,
    ),
    ownerSplitFk: foreignKey({
      columns: [table.splitId, table.userId],
      foreignColumns: [transactionSplits.id, transactionSplits.userId],
      name: 'transaction_split_tags_owner_split_fk',
    }),
    ownerTagFk: foreignKey({
      columns: [table.tagId, table.userId],
      foreignColumns: [tags.id, tags.userId],
      name: 'transaction_split_tags_owner_tag_fk',
    }),
    ownerRuleFk: foreignKey({
      columns: [table.ruleId, table.userId],
      foreignColumns: [classificationRules.id, classificationRules.userId],
      name: 'transaction_split_tags_owner_rule_fk',
    }),
  }),
);

export const classificationEvents = pgTable(
  'classification_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    ruleVersion: integer('rule_version').notNull().default(1),
    previousPrimaryCategoryId: text('previous_primary_category_id'),
    previousPrimarySource: classificationSource('previous_primary_source'),
    resultingPrimaryCategoryId: text('resulting_primary_category_id'),
    secondaryCategoriesAdded: jsonb('secondary_categories_added').notNull().default([]),
    tagsAdded: jsonb('tags_added').notNull().default([]),
    matchedConditions: jsonb('matched_conditions').notNull().default([]),
    reviewedChanged: boolean('reviewed_changed').notNull().default(false),
    previousReviewed: boolean('previous_reviewed'),
    reason: text('reason').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
  },
  (table) => ({
    userAppliedIdx: index('classification_events_user_applied_idx').on(
      table.userId,
      table.appliedAt,
    ),
    transactionIdx: index('classification_events_transaction_idx').on(
      table.userId,
      table.transactionId,
    ),
    ruleTransactionUnique: unique('classification_events_rule_transaction_unique').on(
      table.userId,
      table.ruleId,
      table.transactionId,
    ),
    ownerRuleFk: foreignKey({
      columns: [table.ruleId, table.userId],
      foreignColumns: [classificationRules.id, classificationRules.userId],
      name: 'classification_events_owner_rule_fk',
    }),
    ownerTransactionFk: foreignKey({
      columns: [table.transactionId, table.userId],
      foreignColumns: [transactions.id, transactions.userId],
      name: 'classification_events_owner_transaction_fk',
    }),
  }),
);

export const savedViews = pgTable(
  'saved_views',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    filters: jsonb('filters').notNull(),
    sort: jsonb('sort').notNull(),
    columnPreferences: jsonb('column_preferences'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userUpdatedIdx: index('saved_views_user_updated_idx').on(table.userId, table.updatedAt),
    oneDefault: uniqueIndex('saved_views_one_default_per_user')
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
    nameNotEmpty: check('saved_views_name_not_empty', sql`length(btrim(${table.name})) > 0`),
  }),
);

export const authSchema = { user, session, account, verification };
