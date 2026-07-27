import { decimalToScaledInteger, normalizeTransactionDescription } from './index';

export type RuleField =
  | 'account'
  | 'institution'
  | 'direction'
  | 'currency'
  | 'description'
  | 'counterparty'
  | 'amount'
  | 'booking_day'
  | 'existing_tag'
  | 'uncategorised_only'
  | 'statement_source_type';

export type RuleOperator = 'equals' | 'contains' | 'starts_with' | 'minimum' | 'maximum';

export type RuleCondition = {
  field: RuleField;
  operator: RuleOperator;
  value: string;
};

export type RuleAction =
  | { type: 'primary_category'; categoryId: string }
  | { type: 'secondary_category'; categoryId: string }
  | { type: 'add_tag'; tagId: string }
  | { type: 'mark_reviewed' };

export type RuleDocument = {
  conditions: { version: 1; items: RuleCondition[] };
  actions: { version: 1; items: RuleAction[] };
  matchMode: 'all' | 'any';
};

export type ClassifiableTransaction = {
  id: string;
  financialAccountId: string;
  institutionId: string;
  bookingDate: string;
  amount: string;
  currencyCode: string;
  direction: 'credit' | 'debit' | 'unknown';
  rawDescription: string;
  importedDescription: string;
  userDescription: string | null;
  counterparty: string | null;
  userCounterparty: string | null;
  userNote: string | null;
  primaryCategoryId: string | null;
  tagIds: string[];
  sourceType: string;
  reviewed: boolean;
};

export type RuleMatch = {
  matches: boolean;
  matchedConditions: RuleCondition[];
  reason: string;
};

export type MergedRuleActions = {
  primaryCategoryId: string | null;
  secondaryCategoryIds: string[];
  tagIds: string[];
  markReviewed: boolean;
};

function textValue(value: string | null | undefined): string {
  return normalizeTransactionDescription(value ?? '');
}

function conditionMatches(transaction: ClassifiableTransaction, condition: RuleCondition): boolean {
  const expected = textValue(condition.value);
  switch (condition.field) {
    case 'account':
      return condition.operator === 'equals' && transaction.financialAccountId === condition.value;
    case 'institution':
      return condition.operator === 'equals' && transaction.institutionId === condition.value;
    case 'direction':
      return condition.operator === 'equals' && transaction.direction === condition.value;
    case 'currency':
      return condition.operator === 'equals' && transaction.currencyCode === condition.value;
    case 'description': {
      const actual = textValue(
        transaction.userDescription ??
          transaction.importedDescription ??
          transaction.rawDescription,
      );
      if (condition.operator === 'equals') return actual === expected;
      if (condition.operator === 'contains') return actual.includes(expected);
      if (condition.operator === 'starts_with') return actual.startsWith(expected);
      return false;
    }
    case 'counterparty': {
      const actual = textValue(transaction.userCounterparty ?? transaction.counterparty);
      if (condition.operator === 'equals') return actual === expected;
      if (condition.operator === 'contains') return actual.includes(expected);
      if (condition.operator === 'starts_with') return actual.startsWith(expected);
      return false;
    }
    case 'amount': {
      const actual = decimalToScaledInteger(transaction.amount);
      const target = decimalToScaledInteger(condition.value);
      if (condition.operator === 'equals') return actual === target;
      if (condition.operator === 'minimum') return actual >= target;
      if (condition.operator === 'maximum') return actual <= target;
      return false;
    }
    case 'booking_day':
      return (
        condition.operator === 'equals' &&
        transaction.bookingDate.slice(8, 10) === condition.value.padStart(2, '0')
      );
    case 'existing_tag':
      return condition.operator === 'equals' && transaction.tagIds.includes(condition.value);
    case 'uncategorised_only':
      return (
        condition.operator === 'equals' &&
        condition.value === 'true' &&
        !transaction.primaryCategoryId
      );
    case 'statement_source_type':
      return condition.operator === 'equals' && transaction.sourceType === condition.value;
  }
}

export function validateRuleDocument(document: RuleDocument): string[] {
  const errors: string[] = [];
  const amountConditions = document.conditions.items.filter((item) => item.field === 'amount');
  if (amountConditions.length) {
    const currencyCondition = document.conditions.items.find(
      (item) => item.field === 'currency' && item.operator === 'equals',
    );
    if (!currencyCondition) errors.push('amount_condition_requires_currency');
    for (const condition of amountConditions) {
      try {
        decimalToScaledInteger(condition.value);
      } catch {
        errors.push('invalid_amount_condition');
      }
    }
  }
  for (const condition of document.conditions.items) {
    if (condition.field === 'booking_day' && !/^(?:0?[1-9]|[12]\d|3[01])$/u.test(condition.value))
      errors.push('invalid_booking_day');
    if (condition.field === 'uncategorised_only' && condition.value !== 'true')
      errors.push('invalid_uncategorised_condition');
    if (
      [
        'account',
        'institution',
        'direction',
        'currency',
        'existing_tag',
        'statement_source_type',
      ].includes(condition.field) &&
      condition.operator !== 'equals'
    )
      errors.push('invalid_exact_condition_operator');
    if (
      ['description', 'counterparty'].includes(condition.field) &&
      !['equals', 'contains', 'starts_with'].includes(condition.operator)
    )
      errors.push('invalid_text_condition_operator');
    if (
      condition.field === 'amount' &&
      !['equals', 'minimum', 'maximum'].includes(condition.operator)
    )
      errors.push('invalid_amount_condition_operator');
  }
  return [...new Set(errors)];
}

export function matchClassificationRule(
  transaction: ClassifiableTransaction,
  document: RuleDocument,
): RuleMatch {
  const validationErrors = validateRuleDocument(document);
  if (validationErrors.length) {
    return { matches: false, matchedConditions: [], reason: validationErrors.join(',') };
  }
  const results = document.conditions.items.map((condition) => ({
    condition,
    matched: conditionMatches(transaction, condition),
  }));
  const matches =
    document.matchMode === 'all'
      ? results.every((item) => item.matched)
      : results.some((item) => item.matched);
  return {
    matches,
    matchedConditions: results.filter((item) => item.matched).map((item) => item.condition),
    reason: matches ? 'all_conditions_matched' : 'condition_not_matched',
  };
}

export function mergeRuleActions(actions: RuleAction[]): MergedRuleActions {
  let primaryCategoryId: string | null = null;
  const secondaryCategoryIds: string[] = [];
  const tagIds: string[] = [];
  let markReviewed = false;
  for (const action of actions) {
    if (action.type === 'primary_category' && primaryCategoryId === null)
      primaryCategoryId = action.categoryId;
    if (action.type === 'secondary_category' && !secondaryCategoryIds.includes(action.categoryId))
      secondaryCategoryIds.push(action.categoryId);
    if (action.type === 'add_tag' && !tagIds.includes(action.tagId)) tagIds.push(action.tagId);
    if (action.type === 'mark_reviewed') markReviewed = true;
  }
  return { primaryCategoryId, secondaryCategoryIds, tagIds, markReviewed };
}
