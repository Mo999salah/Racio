import { z } from 'zod';
import { accountTypes, isFullLookingAccountIdentifier, isFullLookingIban } from '@racio/domain';

export const parserDirectionSchema = z.enum(['credit', 'debit', 'unknown']);

export const parsedTransactionCandidateSchema = z.object({
  sourceRow: z.number().int().positive().optional(),
  sourcePage: z.number().int().positive().optional(),
  bookingDate: z.string().date().optional(),
  valueDate: z.string().date().optional(),
  rawDescription: z.string().min(1),
  normalizedDescription: z.string().min(1).optional(),
  amount: z
    .string()
    .regex(/^-?\d{1,14}(?:\.\d{1,6})?$/u)
    .optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  direction: parserDirectionSchema.optional(),
  balanceAfter: z
    .string()
    .regex(/^-?\d{1,14}(?:\.\d{1,6})?$/u)
    .optional(),
  counterparty: z.string().min(1).optional(),
  confidence: z.object({
    overall: z.number().min(0).max(1),
    fields: z.record(z.number().min(0).max(1)).optional(),
  }),
  warnings: z.array(z.string()),
});

export const parserResultSchema = z.object({
  contractVersion: z.literal('racio.parser.v1'),
  source: z.object({
    filename: z.string().min(1),
    mediaType: z.string().min(1),
  }),
  candidates: z.array(parsedTransactionCandidateSchema),
  warnings: z.array(z.string()),
});

export type ParsedTransactionCandidate = z.infer<typeof parsedTransactionCandidateSchema>;
export type ParserResult = z.infer<typeof parserResultSchema>;

export function parseParserResult(input: unknown): ParserResult {
  return parserResultSchema.parse(input);
}

export const csvMappingStatusSchema = z.enum(['confident', 'ambiguous', 'invalid']);
export const csvColumnIndexSchema = z.number().int().nonnegative().nullable();
export const csvMappingSchema = z
  .object({
    headerRow: z.number().int().nonnegative(),
    bookingDate: csvColumnIndexSchema,
    valueDate: csvColumnIndexSchema,
    description: csvColumnIndexSchema,
    amount: csvColumnIndexSchema,
    debit: csvColumnIndexSchema,
    credit: csvColumnIndexSchema,
    currency: csvColumnIndexSchema,
    balance: csvColumnIndexSchema,
    counterparty: csvColumnIndexSchema,
    transactionIdentifier: csvColumnIndexSchema,
    decimalSeparator: z.enum(['.', ',']).nullable(),
    thousandsSeparator: z.enum(['.', ',', ' ']).nullable(),
    dateFormat: z.string().max(40).nullable(),
  })
  .strict();

export const parsedCsvCandidateSchema = z
  .object({
    sourceRow: z.number().int().positive(),
    rawPayload: z.record(z.string()),
    rawDescription: z.string(),
    rawBookingDate: z.string().nullable(),
    rawValueDate: z.string().nullable(),
    rawAmount: z.string().nullable(),
    rawCurrency: z.string().nullable(),
    rawBalance: z.string().nullable(),
    bookingDate: z.string().date().nullable(),
    valueDate: z.string().date().nullable(),
    amount: z
      .string()
      .regex(/^\d{1,14}(?:\.\d{1,6})?$/u)
      .nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .nullable(),
    direction: parserDirectionSchema,
    balanceAfter: z
      .string()
      .regex(/^-?\d{1,14}(?:\.\d{1,6})?$/u)
      .nullable(),
    counterparty: z.string().nullable(),
    bankTransactionId: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    fieldConfidence: z.record(z.number().min(0).max(1)),
    warnings: z.array(z.string()),
  })
  .strict();

export const parserResultV2Schema = z
  .object({
    contractVersion: z.literal('racio.parser.v2'),
    source: z.object({
      filename: z.string().min(1),
      mediaType: z.string().min(1),
      encoding: z.string().min(1),
      delimiter: z.string().length(1),
      quoteChar: z.string().length(1),
      headerRow: z.number().int().nonnegative(),
      detectedLanguage: z.string().nullable(),
      decimalSeparator: z.enum(['.', ',']).nullable(),
      thousandsSeparator: z.enum(['.', ',', ' ']).nullable(),
      dateFormat: z.string().nullable(),
    }),
    mapping: z.object({
      status: csvMappingStatusSchema,
      columns: csvMappingSchema,
      confidence: z.number().min(0).max(1),
      warnings: z.array(z.string()),
    }),
    candidates: z.array(parsedCsvCandidateSchema),
    warnings: z.array(z.string()),
  })
  .strict();

export type CsvMapping = z.infer<typeof csvMappingSchema>;
export type ParsedCsvCandidate = z.infer<typeof parsedCsvCandidateSchema>;
export type ParserResultV2 = z.infer<typeof parserResultV2Schema>;

export function parseParserResultV2(input: unknown): ParserResultV2 {
  return parserResultV2Schema.parse(input);
}

export const importUploadSchema = z
  .object({
    accountId: z.string().trim().min(1).max(200),
    retainOriginalFile: z.boolean().default(false),
    reprocess: z.boolean().default(false),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export const importMappingPatchSchema = z.object({ mapping: csvMappingSchema }).strict();
export const importRowCorrectionSchema = z
  .object({
    bookingDate: z.string().date().nullable().optional(),
    valueDate: z.string().date().nullable().optional(),
    description: z.string().trim().max(20_000).nullable().optional(),
    amount: z
      .string()
      .regex(/^\d{1,14}(?:\.\d{1,6})?$/u)
      .nullable()
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .nullable()
      .optional(),
    direction: parserDirectionSchema.optional(),
    balanceAfter: z
      .string()
      .regex(/^-?\d{1,14}(?:\.\d{1,6})?$/u)
      .nullable()
      .optional(),
    counterparty: z.string().trim().max(1_000).nullable().optional(),
    bankTransactionId: z.string().trim().max(500).nullable().optional(),
    action: z.enum(['save', 'exclude', 'restore', 'mark-reviewed']).default('save'),
  })
  .strict();
export const importConfirmSchema = z
  .object({
    confirmMismatch: z.boolean().default(false),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export const phase5DecimalSchema = z
  .string()
  .regex(/^\d{1,14}(?:\.\d{1,6})?$/u, 'Use a decimal value with up to 6 places.');
export const categoryKindSchema = z.enum(['expense', 'income', 'transfer', 'neutral']);
export const categoryStatusSchema = z.enum(['active', 'archived']);
export const categoryCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    kind: categoryKindSchema,
    parentId: z.string().trim().min(1).max(200).nullable().optional(),
    iconKey: z.string().trim().max(80).nullable().optional(),
    colourKey: z.string().trim().max(80).nullable().optional(),
  })
  .strict();
export const categoryPatchSchema = categoryCreateSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one category field is required.');
export const categoryActionSchema = z.object({ action: z.enum(['archive', 'restore']) }).strict();

export const tagCreateSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export const tagPatchSchema = tagCreateSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'A tag name is required.');
export const tagActionSchema = z.object({ action: z.enum(['archive', 'restore']) }).strict();

export const transactionListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    accountId: z.string().trim().min(1).max(200).optional(),
    institutionId: z.string().trim().min(1).max(200).optional(),
    direction: parserDirectionSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
    primaryCategoryId: z.string().trim().min(1).max(200).optional(),
    secondaryCategoryId: z.string().trim().min(1).max(200).optional(),
    tagId: z.string().trim().min(1).max(200).optional(),
    reviewed: z.enum(['true', 'false']).optional(),
    categorised: z.enum(['true', 'false']).optional(),
    statementId: z.string().trim().min(1).max(200).optional(),
    search: z.string().trim().max(100).optional(),
    amountExact: phase5DecimalSchema.optional(),
    amountMin: phase5DecimalSchema.optional(),
    amountMax: phase5DecimalSchema.optional(),
    includeArchived: z.enum(['true', 'false']).default('false'),
    sort: z
      .enum([
        'bookingDateDesc',
        'bookingDateAsc',
        'amountAsc',
        'amountDesc',
        'descriptionAsc',
        'descriptionDesc',
      ])
      .default('bookingDateDesc'),
  })
  .strict()
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
    message: 'dateFrom must be before dateTo',
  })
  .refine((value) => !value.amountMin || !value.amountMax || value.amountMin <= value.amountMax, {
    message: 'amountMin must be before amountMax',
  })
  .refine(
    (value) =>
      Boolean(value.currency) || (!value.amountExact && !value.amountMin && !value.amountMax),
    'A currency is required when filtering by amount.',
  );

export const transactionMetadataPatchSchema = z
  .object({
    userDescription: z.string().max(20_000).nullable().optional(),
    userCounterparty: z.string().max(1_000).nullable().optional(),
    userNote: z.string().max(4_000).nullable().optional(),
    reviewed: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No editable transaction fields supplied.');

export const transactionClassificationPatchSchema = z
  .object({
    primaryCategoryId: z.string().trim().min(1).max(200).nullable().optional(),
    secondaryCategoryIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    tagIds: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No classification fields supplied.');

export const transactionBulkActionSchema = z
  .object({
    transactionIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    action: z.enum([
      'set-primary-category',
      'add-secondary-category',
      'remove-secondary-category',
      'add-tag',
      'remove-tag',
      'mark-reviewed',
      'mark-unreviewed',
    ]),
    categoryId: z.string().trim().min(1).max(200).optional(),
    tagId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const categoryAction = value.action.includes('category');
    const tagAction = value.action.includes('tag');
    if (categoryAction && !value.categoryId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryId'],
        message: 'Category required.',
      });
    if (tagAction && !value.tagId)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tagId'], message: 'Tag required.' });
  });

export const ruleConditionSchema = z
  .object({
    field: z.enum([
      'account',
      'institution',
      'direction',
      'currency',
      'description',
      'counterparty',
      'amount',
      'booking_day',
      'existing_tag',
      'uncategorised_only',
      'statement_source_type',
    ]),
    operator: z.enum(['equals', 'contains', 'starts_with', 'minimum', 'maximum']),
    value: z.string().trim().min(1).max(1_000),
  })
  .strict();
export const ruleConditionsSchema = z
  .object({ version: z.literal(1), items: z.array(ruleConditionSchema).max(10) })
  .strict();
export const ruleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('primary_category'), categoryId: z.string().trim().min(1).max(200) }),
  z.object({
    type: z.literal('secondary_category'),
    categoryId: z.string().trim().min(1).max(200),
  }),
  z.object({ type: z.literal('add_tag'), tagId: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('mark_reviewed') }),
]);
export const ruleActionsSchema = z
  .object({ version: z.literal(1), items: z.array(ruleActionSchema).min(1).max(10) })
  .strict();
export const classificationRuleCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    enabled: z.boolean().default(true),
    priority: z.number().int().min(0).max(10_000).default(100),
    conditions: ruleConditionsSchema,
    actions: ruleActionsSchema,
    matchMode: z.enum(['all', 'any']).default('all'),
    applyScope: z.enum(['future_only', 'historical_and_future']).default('future_only'),
  })
  .strict();
export const classificationRulePatchSchema = classificationRuleCreateSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No rule fields supplied.');
export const ruleActionRequestSchema = z
  .object({ action: z.enum(['enable', 'disable', 'archive', 'restore']) })
  .strict();
export const rulePreviewRequestSchema = z.object({}).strict();
export const historicalRuleApplySchema = z
  .object({
    confirm: z.literal(true),
    previewHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export const ruleRevertSchema = z.object({ confirm: z.literal(true) }).strict();

export const savedViewFiltersSchema = z
  .object({
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    accountId: z.string().trim().min(1).max(200).optional(),
    institutionId: z.string().trim().min(1).max(200).optional(),
    direction: parserDirectionSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
    primaryCategoryId: z.string().trim().min(1).max(200).optional(),
    secondaryCategoryId: z.string().trim().min(1).max(200).optional(),
    tagId: z.string().trim().min(1).max(200).optional(),
    reviewed: z.enum(['true', 'false']).optional(),
    categorised: z.enum(['true', 'false']).optional(),
    statementId: z.string().trim().min(1).max(200).optional(),
    search: z.string().trim().max(100).optional(),
    amountExact: phase5DecimalSchema.optional(),
    amountMin: phase5DecimalSchema.optional(),
    amountMax: phase5DecimalSchema.optional(),
    includeArchived: z.enum(['true', 'false']).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.currency) || (!value.amountExact && !value.amountMin && !value.amountMax),
    'A currency is required when saving amount filters.',
  );
export const savedViewSortSchema = z
  .object({
    field: z.enum(['bookingDate', 'amount', 'description']),
    direction: z.enum(['asc', 'desc']),
  })
  .strict();
export const savedViewCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    filters: savedViewFiltersSchema,
    sort: savedViewSortSchema,
    columnPreferences: z
      .array(
        z.enum(['date', 'description', 'amount', 'currency', 'direction', 'category', 'reviewed']),
      )
      .max(20)
      .nullable()
      .optional(),
    isDefault: z.boolean().default(false),
  })
  .strict();
export const savedViewPatchSchema = savedViewCreateSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No saved-view fields supplied.');

export const merchantStatusSchema = z.enum(['active', 'archived', 'merged']);
export const merchantSourceSchema = z.enum(['manual', 'alias', 'import', 'system']);
export const merchantCreateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    notes: z.string().max(4_000).nullable().optional(),
  })
  .strict();
export const merchantPatchSchema = merchantCreateSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No merchant fields supplied.');
export const merchantActionSchema = z.object({ action: z.enum(['archive', 'restore']) }).strict();
export const merchantAliasMatchTypeSchema = z.enum([
  'exact_normalized_description',
  'normalized_description_contains',
  'normalized_description_starts_with',
  'exact_counterparty',
  'counterparty_contains',
]);
export const merchantAliasCreateSchema = z
  .object({
    rawPattern: z.string().trim().min(1).max(240),
    matchType: merchantAliasMatchTypeSchema,
    enabled: z.boolean().default(true),
    priority: z.number().int().min(-1_000_000).max(1_000_000).default(100),
  })
  .strict();
export const merchantAliasPatchSchema = merchantAliasCreateSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No alias fields supplied.');
export const merchantAliasActionSchema = z
  .object({ action: z.enum(['enable', 'disable', 'archive', 'restore']) })
  .strict();
export const aliasPreviewRequestSchema = z.object({}).strict();
export const historicalAliasApplySchema = z
  .object({ confirm: z.literal(true), previewHash: z.string().regex(/^[a-f0-9]{64}$/u) })
  .strict();
export const merchantMergeSchema = z
  .object({ targetMerchantId: z.string().trim().min(1).max(200), confirm: z.literal(true) })
  .strict();
export const merchantUnmergeSchema = z.object({ confirm: z.literal(true) }).strict();

export const splitAmountSchema = phase5DecimalSchema.refine((value) => value !== '0', {
  message: 'Split amount must be positive.',
});
export const transactionSplitSchema = z
  .object({
    id: z.string().trim().min(1).max(200).optional(),
    position: z.number().int().min(0).max(49),
    amount: splitAmountSchema,
    currencyCode: z.string().regex(/^[A-Z]{3}$/u),
    description: z.string().max(20_000).nullable().optional(),
    primaryCategoryId: z.string().trim().min(1).max(200).nullable().optional(),
    secondaryCategoryIds: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    tagIds: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
    note: z.string().max(4_000).nullable().optional(),
  })
  .strict();
export const transactionSplitsReplaceSchema = z
  .object({ splits: z.array(transactionSplitSchema).max(50) })
  .strict();
export const transactionMerchantPatchSchema = z
  .object({ merchantId: z.string().trim().min(1).max(200).nullable() })
  .strict();

export const transferStatusSchema = z.enum(['suggested', 'confirmed', 'rejected', 'unlinked']);
export const transferSourceSchema = z.enum(['system', 'manual']);
export const transferListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
    status: transferStatusSchema.optional(),
    accountId: z.string().trim().min(1).max(200).optional(),
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
  })
  .strict()
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
    message: 'dateFrom must be before dateTo',
  });
export const transferActionSchema = z
  .object({ action: z.enum(['confirm', 'reject', 'unlink']) })
  .strict();
export const manualTransferLinkSchema = z
  .object({
    outgoingTransactionId: z.string().trim().min(1).max(200),
    incomingTransactionId: z.string().trim().min(1).max(200),
  })
  .strict();

export const localeSchema = z.enum(['ar', 'en', 'tr']);
export const interfaceModeSchema = z.enum(['easy', 'advanced']);
export const appearanceSchema = z.enum(['system', 'light', 'dark']);

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((value) => {
    try {
      new Intl.NumberFormat('en', { style: 'currency', currency: value }).format(0);
      return value !== 'XXX';
    } catch {
      return false;
    }
  }, 'Use a supported ISO 4217 currency code.');

const timeZoneSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid IANA time zone.');

export const preferenceSchema = z
  .object({
    locale: localeSchema,
    timeZone: timeZoneSchema,
    interfaceMode: interfaceModeSchema,
    appearance: appearanceSchema,
    baseCurrency: currencyCodeSchema.nullable(),
  })
  .strict();

export const preferencePatchSchema = preferenceSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one preference is required.');

export type UserPreferences = z.infer<typeof preferenceSchema>;
export type UserPreferencesPatch = z.infer<typeof preferencePatchSchema>;
export const sessionIdSchema = z.string().min(1);

const optionalUrlSchema = z.string().trim().url().max(2048).nullable().optional();

const maskedAccountIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !isFullLookingAccountIdentifier(value), 'Use a masked account identifier.');

const maskedIbanSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !isFullLookingIban(value), 'Use a masked IBAN.');

export const institutionCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    countryCode: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/u),
    websiteUrl: optionalUrlSchema,
    logoUrl: optionalUrlSchema,
  })
  .strict();

export const institutionPatchSchema = institutionCreateSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one institution field is required.');

export const financialAccountCreateSchema = z
  .object({
    institutionId: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(160),
    accountType: z.enum(accountTypes),
    currencyCode: currencyCodeSchema,
    maskedAccountIdentifier: maskedAccountIdentifierSchema.nullable().optional(),
    maskedIban: maskedIbanSchema.nullable().optional(),
  })
  .strict();

export const financialAccountPatchSchema = financialAccountCreateSchema
  .omit({ institutionId: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one account field is required.');

export const financialAccountActionSchema = z
  .object({ action: z.enum(['archive', 'restore']) })
  .strict();

export const includeArchivedSchema = z.enum(['true', 'false']).default('false');

export type InstitutionCreate = z.infer<typeof institutionCreateSchema>;
export type InstitutionPatch = z.infer<typeof institutionPatchSchema>;
export type FinancialAccountCreate = z.infer<typeof financialAccountCreateSchema>;
export type FinancialAccountPatch = z.infer<typeof financialAccountPatchSchema>;

export type CategoryCreate = z.infer<typeof categoryCreateSchema>;
export type CategoryPatch = z.infer<typeof categoryPatchSchema>;
export type TagCreate = z.infer<typeof tagCreateSchema>;
export type TagPatch = z.infer<typeof tagPatchSchema>;
export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;
export type TransactionMetadataPatch = z.infer<typeof transactionMetadataPatchSchema>;
export type TransactionClassificationPatch = z.infer<typeof transactionClassificationPatchSchema>;
export type TransactionBulkAction = z.infer<typeof transactionBulkActionSchema>;
export type ClassificationRuleCreate = z.infer<typeof classificationRuleCreateSchema>;
export type ClassificationRulePatch = z.infer<typeof classificationRulePatchSchema>;
export type ClassificationRulePreviewRequest = z.infer<typeof rulePreviewRequestSchema>;
export type ClassificationRuleHistoricalApply = z.infer<typeof historicalRuleApplySchema>;
export type ClassificationRuleRevert = z.infer<typeof ruleRevertSchema>;
export type SavedViewCreate = z.infer<typeof savedViewCreateSchema>;
export type SavedViewPatch = z.infer<typeof savedViewPatchSchema>;
export type MerchantCreate = z.infer<typeof merchantCreateSchema>;
export type MerchantPatch = z.infer<typeof merchantPatchSchema>;
export type MerchantAliasCreate = z.infer<typeof merchantAliasCreateSchema>;
export type MerchantAliasPatch = z.infer<typeof merchantAliasPatchSchema>;
export type HistoricalAliasApply = z.infer<typeof historicalAliasApplySchema>;
export type MerchantMerge = z.infer<typeof merchantMergeSchema>;
export type MerchantUnmerge = z.infer<typeof merchantUnmergeSchema>;
export type TransactionSplit = z.infer<typeof transactionSplitSchema>;
export type TransactionSplitsReplace = z.infer<typeof transactionSplitsReplaceSchema>;
export type TransactionMerchantPatch = z.infer<typeof transactionMerchantPatchSchema>;
export type TransferListQuery = z.infer<typeof transferListQuerySchema>;
export type ManualTransferLink = z.infer<typeof manualTransferLinkSchema>;
