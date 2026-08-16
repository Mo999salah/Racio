import type { AdvisorContext } from '@racio/contracts';
import type { UserPreferences } from '@racio/contracts';
import { resolvePhraseDateRange, type ResolvedDateRange } from './date';

export type AdvisorTopic =
  | 'period_summary'
  | 'category_breakdown'
  | 'merchant_breakdown'
  | 'account_overview'
  | 'budget_status'
  | 'goal_progress'
  | 'alert_summary'
  | 'uncategorized_allocations'
  | 'reconciliation_status'
  | 'search_transactions'
  | 'unsupported';

export type AdvisorPlan = {
  topic: AdvisorTopic;
  toolNames: string[];
  /** Explicitly resolved date scope, or null when no deterministic scope is
   * available (see `needsClarification`). Never silently defaults. */
  dateRange: ResolvedDateRange | null;
  currency: string | null;
  accountId: string | null;
  comparePrevious: boolean;
  searchText: string | null;
  maxResults: number;
  /** Deterministic mutation-proposal intent (never auto-executed). */
  proposalIntent: 'create_budget' | null;
  /** True when the question is temporally ambiguous for the planned tools and
   * no explicit phrase or validated context date range resolved the scope. */
  needsClarification: boolean;
};

/** Topics whose tools report over a period; an explicit date scope is required. */
const PERIOD_SENSITIVE_TOPICS: ReadonlySet<AdvisorTopic> = new Set<AdvisorTopic>([
  'period_summary',
  'category_breakdown',
  'merchant_breakdown',
  'uncategorized_allocations',
  'search_transactions',
]);

export function topicRequiresDateRange(topic: AdvisorTopic): boolean {
  return PERIOD_SENSITIVE_TOPICS.has(topic);
}

function isSpendingLike(message: string): boolean {
  return /\bspend|\bspending|\bincome|\bearned?|\bcash flow|\bhow much did i|\boutflow|\binflow|(المصاريف|المصروفات|الإنفاق|إنفاق|الدخل|التدفق)|\bharcama|\bgelir|\bgider/iu.test(
    message,
  );
}

type OwnedReference = { id: string; name: string };

const CURRENCY_WORDS: Record<string, string> = {
  TRY: 'TRY',
  TL: 'TRY',
  LIRA: 'TRY',
  'TURKISH LIRA': 'TRY',
  USD: 'USD',
  'US DOLLAR': 'USD',
  DOLLAR: 'USD',
  EUR: 'EUR',
  EURO: 'EUR',
  GBP: 'GBP',
  AED: 'AED',
  SAR: 'SAR',
  EGP: 'EGP',
  CHF: 'CHF',
  JPY: 'JPY',
  CAD: 'CAD',
  ليرة: 'TRY',
  دولار: 'USD',
  يورو: 'EUR',
  ريال: 'SAR',
  جنيه: 'EGP',
};

const CURRENCY_PATTERN =
  /\b(TRY|TL|LIRA|TURKISH\s+LIRA|USD|US\s+DOLLAR|DOLLAR|EUR|EURO|GBP|AED|SAR|EGP|CHF|JPY|CAD)\b|(ليرة|دولار|يورو|ريال|جنيه)/iu;

const COMPARE_PATTERN =
  /\b(compare|comparison|versus|vs\.?|increased?|decreased?|changed?|more than|less than|than last|year-over-year|month-over-month)\b|(مقارنة|قارن|ارتفع|انخفض|أكثر من|أقل من|مقابل)|\b(karşılaştır|karşılaştırma|artış|azalış|arttı|azaldı)\b/iu;

const CREATE_BUDGET_PATTERN =
  /\b(create|set|make|add|start) (a )?budget\b|\bcreate budget\b|(أنشئ ميزانية|أضف ميزانية|إضافة ميزانية|إنشاء ميزانية)|\b(bütçe oluştur|yeni bütçe ekle)\b/iu;

const TOPIC_PATTERNS: Array<{ topic: AdvisorTopic; pattern: RegExp }> = [
  {
    topic: 'reconciliation_status',
    pattern:
      /\breconcil|\bmismatch|\bstatement.*(match|balance)|\bclosing balance|\bopening balance|(مطابقة|تسوية|عدم تطابق|رصيد افتتاحي|رصيد ختامي)|\b(mutabakat|mutabakat hatası|uyumsuzluk)\b/iu,
  },
  {
    topic: 'budget_status',
    pattern: /\bbudget|\bbudgets|\bbütçe|\bbutce|(ميزانية|الميزانية)/iu,
  },
  {
    topic: 'goal_progress',
    pattern:
      /\bgoal|\bgoals|\bsavings goal|\btarget date|\bhedef|\btasarruf|(هدف|أهداف|الهدف|هدف الادخار|الادخار)/iu,
  },
  {
    topic: 'alert_summary',
    pattern: /\balert|\balerts|\bnotification|\bbildirim|\buyarı|(تنبيه|تنبيهات|إشعار|اشعار)/iu,
  },
  {
    topic: 'uncategorized_allocations',
    pattern:
      /\buncategor|\bunclassified|\bno category|\bkategorize edilmemiş|\bsınıflandırılmamış|(غير مصنف|غير مصنفة|بدون تصنيف)/iu,
  },
  {
    topic: 'merchant_breakdown',
    pattern:
      /\bmerchant|\bmerchants|\bvendor|\bstore|\bshop|\bsatıcı|\bişyeri|(تاجر|تجار|المتاجر|محل|محلات)/iu,
  },
  {
    topic: 'category_breakdown',
    pattern:
      /\bcategor(ies|y)\b|\bspending by category|\bbiggest spending|\btop categor|\bkategori|(التصنيف|تصنيف|فئة|الفئات|أكبر فئات)/iu,
  },
  {
    topic: 'account_overview',
    pattern:
      /\baccount|\baccounts|\bbalance|\bposition|\bhesap|\bbakiye|(الحساب|الحسابات|الرصيد|رصيد)/iu,
  },
  {
    topic: 'search_transactions',
    pattern:
      /\bshow me|\brecent (transactions|purchases|\b)\b|\bfind (a |the )?transaction|\blast transactions|\bgöster|\bson işlem|(أرني|اعرض|آخر المعاملات|أحدث المعاملات)/iu,
  },
];

/**
 * Deterministic application planner: natural-language question -> validated
 * filters -> approved tools. The model never chooses tools or supplies
 * identifiers; every filter below originates from the message or the
 * authenticated session and is re-validated before execution.
 */
export function planAdvisorRequest(
  message: string,
  context: AdvisorContext | undefined,
  preferences: UserPreferences,
  ownedAccounts: OwnedReference[],
  currenciesInUse: string[],
  now: Date = new Date(),
): AdvisorPlan {
  const timeZone = preferences.timeZone;

  // Date scope: an explicit validated context range wins, then an explicit
  // phrase in the message (resolved server-side in the user timezone). When
  // neither exists and the planned tools report over a period, the question is
  // temporally ambiguous and `needsClarification` is set instead of inventing
  // a silent default.
  let dateRange: ResolvedDateRange | null = null;
  let dateResolved = false;
  if (context?.dateRange) {
    dateRange = { key: 'context', from: context.dateRange.from, to: context.dateRange.to };
    dateResolved = true;
  } else {
    const phrase = resolvePhraseDateRange(message, preferences.locale, timeZone, now);
    if (phrase) {
      dateRange = phrase;
      dateResolved = true;
    }
  }

  let currency: string | null = null;
  const currencyMatch = message.match(CURRENCY_PATTERN);
  if (currencyMatch && currencyMatch[1]) {
    const code = CURRENCY_WORDS[currencyMatch[1].toUpperCase()] ?? currencyMatch[1].toUpperCase();
    if (currenciesInUse.includes(code)) currency = code;
  }
  if (context?.currency) currency = context.currency;

  let accountId: string | null = null;
  if (context?.accountId) {
    accountId = context.accountId;
  } else {
    const match = ownedAccounts.find((account) =>
      message.toLocaleLowerCase('en-US').includes(account.name.toLocaleLowerCase('en-US')),
    );
    if (match) accountId = match.id;
  }

  const comparePrevious = COMPARE_PATTERN.test(message);

  let topic: AdvisorTopic = 'period_summary';
  for (const entry of TOPIC_PATTERNS) {
    if (entry.pattern.test(message)) {
      topic = entry.topic;
      break;
    }
  }

  if (topic === 'period_summary') {
    if (!isSpendingLike(message) && /\b(what|why|when|where|which|how)\b/i.test(message))
      topic = 'unsupported';
  } else if (topic === 'account_overview' && isSpendingLike(message)) {
    // "How much did I spend from my Checking account?" is a spending question
    // scoped to an account, not a state/balance question.
    topic = 'period_summary';
  }

  const needsClarification = topicRequiresDateRange(topic) && !dateResolved;

  const toolNames = toolNamesFor(topic, comparePrevious);

  const proposalIntent =
    CREATE_BUDGET_PATTERN.test(message) && topic === 'budget_status'
      ? ('create_budget' as const)
      : null;

  return {
    topic,
    toolNames,
    dateRange,
    currency,
    accountId,
    comparePrevious,
    searchText: null,
    maxResults: 20,
    proposalIntent,
    needsClarification,
  };
}

export function toolNamesFor(topic: AdvisorTopic, comparePrevious: boolean): string[] {
  switch (topic) {
    case 'period_summary':
      return comparePrevious ? ['get_period_summary', 'compare_periods'] : ['get_period_summary'];
    case 'category_breakdown':
      return ['get_category_breakdown'];
    case 'merchant_breakdown':
      return ['get_merchant_breakdown'];
    case 'account_overview':
      return ['get_account_overview'];
    case 'budget_status':
      return ['get_budget_status'];
    case 'goal_progress':
      return ['get_goal_progress'];
    case 'alert_summary':
      return ['get_alert_summary'];
    case 'uncategorized_allocations':
      return ['get_uncategorized_allocations'];
    case 'reconciliation_status':
      return ['get_reconciliation_status'];
    case 'search_transactions':
      return ['search_transactions'];
    case 'unsupported':
      return [];
    default:
      return [];
  }
}
