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

export const rawWorkbookCellSchema = z
  .object({
    row: z.number().int().positive(),
    column: z.number().int().positive(),
    coordinate: z.string().regex(/^[A-Z]{1,3}[1-9]\d*$/u),
    displayedText: z.string().max(20_000).nullable(),
    rawType: z.enum([
      'blank',
      'string',
      'number',
      'date',
      'boolean',
      'formula_cached',
      'formula_uncached',
      'error',
    ]),
    rawValue: z.string().max(20_000).nullable(),
    numberFormat: z.string().max(500).nullable(),
    formula: z.string().max(2_000).nullable(),
    hasCachedValue: z.boolean().nullable(),
  })
  .strict();

export const xlsxParsedCandidateSchema = parsedCsvCandidateSchema
  .extend({ rawCells: z.array(rawWorkbookCellSchema).max(32) })
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

export const workbookSheetInspectionSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    name: z.string().min(1).max(500),
    index: z.number().int().nonnegative(),
    hidden: z.boolean(),
    veryHidden: z.boolean(),
    estimatedRows: z.number().int().nonnegative(),
    estimatedColumns: z.number().int().nonnegative(),
    populatedCells: z.number().int().nonnegative(),
    mergedRangeCount: z.number().int().nonnegative(),
    formulaCellCount: z.number().int().nonnegative(),
    sampleRows: z.array(z.array(z.string().max(2_000)).max(16)).max(8),
    warnings: z.array(z.string().max(200)).max(100),
  })
  .strict();

export const workbookInspectionSchema = z
  .object({
    contractVersion: z.literal('racio.workbook-inspection.v1'),
    workbookType: z.literal('xlsx'),
    sheetCount: z.number().int().nonnegative(),
    dateSystem: z.enum(['1900', '1904']),
    sheets: z.array(workbookSheetInspectionSchema).max(32),
    workbookWarnings: z.array(z.string().max(200)).max(100),
  })
  .strict();

export const xlsxMappingSchema = csvMappingSchema
  .omit({ headerRow: true })
  .extend({
    sourceType: z.literal('xlsx'),
    selectedSheetId: z.string().trim().min(1).max(200),
    selectedSheetName: z.string().min(1).max(500),
    selectedSheetIndex: z.number().int().nonnegative(),
    headerRow: z.number().int().positive(),
    firstDataRow: z.number().int().positive(),
    lastDataRow: z.number().int().positive().nullable(),
    columnLetters: z.record(z.string().regex(/^[A-Z]{1,3}$/u)).optional(),
    cellTypeHints: z.record(z.string().max(100)).optional(),
    numberFormatHints: z.record(z.string().max(500)).optional(),
  })
  .strict()
  .superRefine((mapping, context) => {
    if (mapping.firstDataRow <= mapping.headerRow)
      context.addIssue({
        code: 'custom',
        path: ['firstDataRow'],
        message: 'The first data row must follow the header row.',
      });
    if (mapping.lastDataRow !== null && mapping.lastDataRow < mapping.firstDataRow)
      context.addIssue({
        code: 'custom',
        path: ['lastDataRow'],
        message: 'The last data row must not precede the first data row.',
      });
  });

export const xlsxParserResultSchema = z
  .object({
    contractVersion: z.literal('racio.parser.v2'),
    source: z
      .object({
        sourceType: z.literal('xlsx'),
        filename: z.string().min(1),
        mediaType: z.string().min(1),
        sheetName: z.string().min(1).max(500),
        sheetIndex: z.number().int().nonnegative(),
        headerRow: z.number().int().positive(),
        firstDataRow: z.number().int().positive(),
        lastDataRow: z.number().int().positive().nullable(),
        workbookDateSystem: z.enum(['1900', '1904']),
        formulaCellCount: z.number().int().nonnegative(),
        mergedRangeCount: z.number().int().nonnegative(),
        detectedLanguage: z.string().nullable(),
      })
      .strict(),
    mapping: z
      .object({
        status: csvMappingStatusSchema,
        columns: xlsxMappingSchema,
        confidence: z.number().min(0).max(1),
        warnings: z.array(z.string()),
      })
      .strict(),
    candidates: z.array(xlsxParsedCandidateSchema),
    warnings: z.array(z.string()),
  })
  .strict();

export type WorkbookInspection = z.infer<typeof workbookInspectionSchema>;
export type WorkbookSheetInspection = z.infer<typeof workbookSheetInspectionSchema>;
export type XlsxMapping = z.infer<typeof xlsxMappingSchema>;
export type XlsxParserResult = z.infer<typeof xlsxParserResultSchema>;

export function parseWorkbookInspection(input: unknown): WorkbookInspection {
  return workbookInspectionSchema.parse(input);
}

export function parseXlsxParserResult(input: unknown): XlsxParserResult {
  return xlsxParserResultSchema.parse(input);
}

export const pdfPageInspectionSchema = z
  .object({
    pageNumber: z.number().int().positive(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    textCharacterCount: z.number().int().nonnegative(),
    wordCount: z.number().int().nonnegative(),
    imageCount: z.number().int().nonnegative(),
    likelyTable: z.boolean(),
    sampleLines: z.array(z.string().max(200)).max(5),
    warnings: z.array(z.string().max(200)).max(100),
  })
  .strict();

export const pdfInspectionSchema = z
  .object({
    contractVersion: z.literal('racio.pdf-inspection.v1'),
    sourceType: z.literal('pdf'),
    pageCount: z.number().int().nonnegative(),
    encrypted: z.boolean(),
    hasUsableText: z.boolean(),
    likelyImageOnly: z.boolean(),
    textUsability: z.enum(['usable', 'mixed', 'image_only', 'none']),
    textCharacterCount: z.number().int().nonnegative(),
    pages: z.array(pdfPageInspectionSchema).max(200),
    documentWarnings: z.array(z.string().max(200)).max(100),
  })
  .strict();

export const pdfBoundingBoxSchema = z
  .object({
    x0: z.number(),
    top: z.number(),
    x1: z.number(),
    bottom: z.number(),
  })
  .strict();

export const pdfStatementMetadataSchema = z
  .object({
    periodStart: z.string().date().nullable(),
    periodEnd: z.string().date().nullable(),
    openingBalance: z
      .string()
      .regex(/^-?\d{1,14}(?:\.\d{1,6})?$/u)
      .nullable(),
    closingBalance: z
      .string()
      .regex(/^-?\d{1,14}(?:\.\d{1,6})?$/u)
      .nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .nullable(),
    institutionNameText: z.string().max(200).nullable(),
    maskedAccountIdentifier: z.string().max(80).nullable(),
  })
  .strict();

export const pdfColumnBandSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    x0: z.number().nonnegative(),
    x1: z.number().nonnegative(),
  })
  .strict();

export const pdfMappingSchema = z
  .object({
    sourceType: z.literal('pdf'),
    pageCount: z.number().int().nonnegative(),
    sourcePages: z.array(z.number().int().positive()).max(200),
    headerLabels: z.array(z.string().max(200)).max(100),
    columnBands: z.array(pdfColumnBandSchema).max(100),
    amountColumnMode: z.enum(['signed', 'debit_credit', 'unknown']),
    lineGroupingStrategy: z.string().min(1).max(100),
    hasYear: z.boolean(),
    decimalSeparator: z.enum(['.', ',']).nullable(),
    thousandsSeparator: z.enum(['.', ',', ' ']).nullable(),
    dateFormat: z.string().max(40).nullable(),
  })
  .strict();

export const pdfParsedCandidateSchema = parsedCsvCandidateSchema
  .extend({
    sourcePage: z.number().int().positive(),
    description: z.string().max(1_000).nullable(),
    rawLines: z.array(z.string().max(2_000)).max(20),
    boundingBox: pdfBoundingBoxSchema.nullable(),
    parserStrategy: z.string().max(100).nullable(),
  })
  .strict();

export const pdfParserResultSchema = z
  .object({
    contractVersion: z.literal('racio.parser.v2'),
    source: z
      .object({
        sourceType: z.literal('pdf'),
        filename: z.string().min(1),
        mediaType: z.string().min(1),
        pageCount: z.number().int().nonnegative(),
        detectedLanguage: z.string().nullable(),
        amountColumnMode: z.enum(['signed', 'debit_credit', 'unknown']),
        hasYear: z.boolean(),
        decimalSeparator: z.enum(['.', ',']).nullable(),
        thousandsSeparator: z.enum(['.', ',', ' ']).nullable(),
        dateFormat: z.string().max(40).nullable(),
      })
      .strict(),
    mapping: z
      .object({
        status: csvMappingStatusSchema,
        columns: pdfMappingSchema,
        confidence: z.number().min(0).max(1),
        warnings: z.array(z.string()),
      })
      .strict(),
    candidates: z.array(pdfParsedCandidateSchema).max(50_000),
    metadata: pdfStatementMetadataSchema.nullable(),
    warnings: z.array(z.string()),
  })
  .strict();

export type PdfInspection = z.infer<typeof pdfInspectionSchema>;
export type PdfPageInspection = z.infer<typeof pdfPageInspectionSchema>;
export type PdfStatementMetadata = z.infer<typeof pdfStatementMetadataSchema>;
export type PdfColumnBand = z.infer<typeof pdfColumnBandSchema>;
export type PdfMapping = z.infer<typeof pdfMappingSchema>;
export type PdfParsedCandidate = z.infer<typeof pdfParsedCandidateSchema>;
export type PdfParserResult = z.infer<typeof pdfParserResultSchema>;

export function parsePdfInspection(input: unknown): PdfInspection {
  return pdfInspectionSchema.parse(input);
}

export function parsePdfParserResult(input: unknown): PdfParserResult {
  return pdfParserResultSchema.parse(input);
}

export const importUploadSchema = z
  .object({
    accountId: z.string().trim().min(1).max(200),
    retainOriginalFile: z.boolean().default(false),
    reprocess: z.boolean().default(false),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export const importMappingPatchSchema = z
  .object({ mapping: z.union([csvMappingSchema, xlsxMappingSchema, pdfMappingSchema]) })
  .strict();
export const xlsxSheetSelectionSchema = z
  .object({
    sheetId: z.string().trim().min(1).max(200),
    sheetIndex: z.number().int().nonnegative(),
    sheetName: z.string().min(1).max(500),
  })
  .strict();
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

export const dashboardQuerySchema = z
  .object({
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    accountId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
    message: 'dateFrom must be before dateTo',
  });

const signedDecimalSchema = z.string().regex(/^-?\d{1,14}(?:\.\d{1,6})?$/u);

export const knownBalanceSourceSchema = z.enum([
  'transaction_balance_after',
  'statement_closing_balance',
]);

export const knownBalanceSchema = z
  .object({
    amount: signedDecimalSchema,
    currency: currencyCodeSchema,
    asOfDate: z.string().date(),
    source: knownBalanceSourceSchema,
    sourceId: z.string(),
  })
  .strict();

export const dashboardCashFlowSchema = z
  .object({
    currency: currencyCodeSchema,
    inflow: phase5DecimalSchema,
    outflow: phase5DecimalSchema,
    net: signedDecimalSchema,
    count: z.number().int().nonnegative(),
    unresolvedCount: z.number().int().nonnegative(),
  })
  .strict();

export const dashboardAccountSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    currency: currencyCodeSchema,
    status: z.enum(['active', 'archived']),
    transactionCount: z.number().int().nonnegative(),
    netActivity: signedDecimalSchema,
    balance: knownBalanceSchema.nullable(),
    hasData: z.boolean(),
  })
  .strict();

export const dashboardCategorySchema = z
  .object({
    currency: currencyCodeSchema,
    name: z.string().nullable(),
    amount: phase5DecimalSchema,
    sharePercent: z.string().regex(/^\d{1,3}(?:\.\d{1,3})?$/u),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const dashboardMerchantSchema = z
  .object({
    currency: currencyCodeSchema,
    name: z.string(),
    amount: phase5DecimalSchema,
    sharePercent: z.string().regex(/^\d{1,3}(?:\.\d{1,3})?$/u),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const dashboardAttentionItemSchema = z
  .object({
    kind: z.enum(['statement_needs_action', 'reconciliation_mismatch']),
    statementId: z.string(),
    filename: z.string(),
    processingStatus: z.string().optional(),
    reconciliationStatus: z.string().optional(),
  })
  .strict();

export const dashboardAttentionSchema = z
  .object({
    unreviewed: z.number().int().nonnegative(),
    statementsNeedingAction: z.number().int().nonnegative(),
    reconciliationMismatch: z.number().int().nonnegative(),
    items: z.array(dashboardAttentionItemSchema).max(8),
  })
  .strict();

export const dashboardSummarySchema = z
  .object({
    period: z
      .object({ from: z.string().date(), to: z.string().date(), isDefault: z.boolean() })
      .strict(),
    hasAccounts: z.boolean(),
    hasTransactions: z.boolean(),
    currencies: z.array(currencyCodeSchema),
    cashFlow: z.array(dashboardCashFlowSchema),
    accounts: z.array(dashboardAccountSchema),
    categories: z.array(dashboardCategorySchema),
    merchants: z.array(dashboardMerchantSchema),
    attention: dashboardAttentionSchema,
  })
  .strict();

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
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type KnownBalance = z.infer<typeof knownBalanceSchema>;
export type KnownBalanceSource = z.infer<typeof knownBalanceSourceSchema>;

// Phase 10: budgets, savings goals, and alerts.

export const budgetPeriodSchema = z.enum(['weekly', 'monthly', 'yearly', 'custom']);

const positiveAmountSchema = phase5DecimalSchema.refine((value) => value !== '0', {
  message: 'Amount must be greater than zero.',
});

const budgetFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    currency: currencyCodeSchema,
    amount: positiveAmountSchema,
    period: budgetPeriodSchema,
    categoryId: z.string().trim().min(1).max(200).nullable().optional(),
    accountId: z.string().trim().min(1).max(200).nullable().optional(),
    startDate: z.string().date().nullable().optional(),
    endDate: z.string().date().nullable().optional(),
    warningThreshold: z.number().int().min(1).max(100).nullable().optional(),
    rolloverEnabled: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .strict();

function budgetPeriodRefinement(
  value: {
    period: z.infer<typeof budgetPeriodSchema>;
    startDate?: string | null;
    endDate?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (value.period === 'custom') {
    if (!value.startDate || !value.endDate)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: 'A custom period requires start and end dates.',
      });
    if (value.startDate && value.endDate && value.startDate > value.endDate)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'The end date must follow the start date.',
      });
  } else if (value.startDate || value.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDate'],
      message: 'Only a custom period carries explicit dates.',
    });
  }
}

export const budgetCreateSchema = budgetFieldsSchema.superRefine(budgetPeriodRefinement);

export const budgetPatchSchema = budgetFieldsSchema
  .partial()
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'At least one budget field is required.',
      });
    budgetPeriodRefinement(
      {
        period: value.period ?? 'monthly',
        startDate: value.startDate,
        endDate: value.endDate,
      },
      ctx,
    );
  });

export const budgetActionSchema = z
  .object({ action: z.enum(['archive', 'restore', 'enable', 'disable']) })
  .strict();

export const goalTrackingModeSchema = z.enum(['manual', 'account_balance']);

const savingsGoalFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    currency: currencyCodeSchema,
    targetAmount: positiveAmountSchema,
    targetDate: z.string().date().nullable().optional(),
    trackingMode: goalTrackingModeSchema,
    accountId: z.string().trim().min(1).max(200).nullable().optional(),
    manualSavedAmount: phase5DecimalSchema.nullable().optional(),
    enabled: z.boolean().default(true),
  })
  .strict();

function goalTrackingRefinement(
  value: {
    trackingMode: z.infer<typeof goalTrackingModeSchema>;
    accountId?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (value.trackingMode === 'account_balance' && !value.accountId)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accountId'],
      message: 'Account-balance tracking requires a linked account.',
    });
  if (value.trackingMode === 'manual' && value.accountId)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accountId'],
      message: 'Manual tracking does not use an account.',
    });
}

export const savingsGoalCreateSchema = savingsGoalFieldsSchema.superRefine(goalTrackingRefinement);

export const savingsGoalPatchSchema = savingsGoalFieldsSchema
  .partial()
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'At least one goal field is required.',
      });
    goalTrackingRefinement(
      { trackingMode: value.trackingMode ?? 'manual', accountId: value.accountId },
      ctx,
    );
  });

export const savingsGoalActionSchema = z
  .object({ action: z.enum(['archive', 'restore']) })
  .strict();

export const goalProgressUpdateSchema = z
  .object({ manualSavedAmount: phase5DecimalSchema })
  .strict();

export const alertEventTypeSchema = z.enum([
  'budget_approaching',
  'budget_exceeded',
  'reconciliation_mismatch',
  'uncategorized_transactions',
  'goal_milestone',
  'goal_deadline',
]);

export const alertRuleTypeSchema = z.enum([
  'uncategorized_transactions',
  'goal_milestone',
  'goal_deadline',
]);

export const alertRuleConfigSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('uncategorized_transactions'),
      threshold: z.number().int().min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('goal_milestone'),
      goalId: z.string().trim().min(1).max(200),
      milestones: z.array(z.number().int().min(1).max(100)).min(1).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal('goal_deadline'),
      goalId: z.string().trim().min(1).max(200),
      daysBefore: z.number().int().min(1).max(365),
    })
    .strict(),
]);

export const alertRuleCreateSchema = z
  .object({
    type: alertRuleTypeSchema,
    config: z.unknown(),
    enabled: z.boolean().default(true),
  })
  .strict();

export const alertRulePatchSchema = z
  .object({
    config: z.unknown().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one rule field is required.');

export const alertRuleActionSchema = z
  .object({ action: z.enum(['enable', 'disable', 'archive', 'restore']) })
  .strict();

export const alertListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
    state: z.enum(['unread', 'read', 'dismissed', 'all']).default('unread'),
  })
  .strict();

export const alertActionSchema = z
  .object({ action: z.enum(['read', 'unread', 'dismiss']) })
  .strict();

export type BudgetPeriod = z.infer<typeof budgetPeriodSchema>;
export type BudgetCreate = z.infer<typeof budgetCreateSchema>;
export type BudgetPatch = z.infer<typeof budgetPatchSchema>;
export type SavingsGoalCreate = z.infer<typeof savingsGoalCreateSchema>;
export type SavingsGoalPatch = z.infer<typeof savingsGoalPatchSchema>;
export type GoalProgressUpdate = z.infer<typeof goalProgressUpdateSchema>;
export type GoalTrackingMode = z.infer<typeof goalTrackingModeSchema>;
export type AlertEventType = z.infer<typeof alertEventTypeSchema>;
export type AlertRuleType = z.infer<typeof alertRuleTypeSchema>;
export type AlertRuleConfig = z.infer<typeof alertRuleConfigSchema>;
export type AlertRuleCreate = z.infer<typeof alertRuleCreateSchema>;
export type AlertRulePatch = z.infer<typeof alertRulePatchSchema>;
export type AlertListQuery = z.infer<typeof alertListQuerySchema>;

// Phase 11: optional AI financial advisor.

export const advisorDateRangeSchema = z
  .object({
    from: z.string().date(),
    to: z.string().date(),
  })
  .strict()
  .refine((value) => value.from <= value.to, 'The end date must follow the start date.');

export const advisorContextSchema = z
  .object({
    dateRange: advisorDateRangeSchema.optional(),
    currency: currencyCodeSchema.optional(),
    accountId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const advisorQuerySchema = z
  .object({
    message: z.string().trim().min(1).max(2_000),
    threadId: z.string().trim().min(1).max(200).optional(),
    context: advisorContextSchema.optional(),
  })
  .strict();

const advisorPositiveAmountSchema = phase5DecimalSchema.refine((value) => value !== '0', {
  message: 'Amount must be greater than zero.',
});

export const advisorProposalSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('categorize_transactions'),
      transactionIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
      categoryId: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal('create_budget'),
      name: z.string().trim().min(1).max(160),
      currency: currencyCodeSchema,
      amount: advisorPositiveAmountSchema,
      period: budgetPeriodSchema,
      categoryId: z.string().trim().min(1).max(200).nullable().optional(),
      accountId: z.string().trim().min(1).max(200).nullable().optional(),
      startDate: z.string().date().nullable().optional(),
      endDate: z.string().date().nullable().optional(),
      warningThreshold: z.number().int().min(1).max(100).nullable().optional(),
      rolloverEnabled: z.boolean().default(false),
    })
    .strict(),
]);

export const advisorProposalRequestSchema = z.object({ proposal: advisorProposalSchema }).strict();

export const advisorConfirmSchema = z
  .object({ proposalId: z.string().trim().min(1).max(200) })
  .strict();

export const advisorThreadDeleteSchema = z
  .object({ threadId: z.string().trim().min(1).max(200) })
  .strict();

export type AdvisorDateRange = z.infer<typeof advisorDateRangeSchema>;
export type AdvisorContext = z.infer<typeof advisorContextSchema>;
export type AdvisorQuery = z.infer<typeof advisorQuerySchema>;
export type AdvisorProposal = z.infer<typeof advisorProposalSchema>;
export type AdvisorProposalRequest = z.infer<typeof advisorProposalRequestSchema>;
export type AdvisorConfirm = z.infer<typeof advisorConfirmSchema>;

export const exportTypeSchema = z.enum([
  'transactions_csv',
  'transactions_xlsx',
  'account_archive',
]);
export const exportStatusSchema = z.enum(['preparing', 'ready', 'failed']);

export const exportTransactionFiltersSchema = z
  .object({
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    accountId: z.string().trim().min(1).max(200).optional(),
    institutionId: z.string().trim().min(1).max(200).optional(),
    direction: parserDirectionSchema.optional(),
    currency: currencyCodeSchema.optional(),
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
    savedViewId: z.string().trim().min(1).max(200).optional(),
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

export const exportRequestSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('transactions_csv'),
      filters: exportTransactionFiltersSchema,
      includeNotes: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      type: z.literal('transactions_xlsx'),
      filters: exportTransactionFiltersSchema,
      includeNotes: z.boolean().default(false),
      includeSplits: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      type: z.literal('account_archive'),
      includeNotes: z.boolean().default(false),
      includeAdvisorConversations: z.boolean().default(false),
    })
    .strict(),
]);

export const exportRecordSchema = z.object({
  id: z.string().min(1),
  type: exportTypeSchema,
  status: exportStatusSchema,
  rowCount: z.number().int().nonnegative().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  checksum: z.string().nullable(),
  errorCode: z.string().nullable(),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  expired: z.boolean(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

export const exportListSchema = z.object({ items: z.array(exportRecordSchema) });

export type ExportType = z.infer<typeof exportTypeSchema>;
export type ExportStatus = z.infer<typeof exportStatusSchema>;
export type ExportTransactionFilters = z.infer<typeof exportTransactionFiltersSchema>;
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportRecord = z.infer<typeof exportRecordSchema>;
