/**
 * Deterministic date-range resolution for the advisor. Phrases are resolved
 * server-side in the user's IANA timezone; the model never invents date
 * boundaries. Supports English, Arabic, and Turkish phrase sets that mirror
 * the localized suggested questions.
 */

export type ResolvedDateRange = {
  key: string;
  from: string;
  to: string;
};

function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function shiftDays(value: Date, days: number): Date {
  const result = startOfDay(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function previousMonthBounds(today: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  return { from, to };
}

function monthBounds(year: number, month: number): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, month, 1)),
    to: new Date(Date.UTC(year, month + 1, 0)),
  };
}

function mondayOfWeek(value: Date): Date {
  const day = value.getUTCDay();
  const offset = (day === 0 ? 7 : day) - 1;
  return shiftDays(value, -offset);
}

export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export const CLARIFICATION_OPTION_IDS = ['thisMonth', 'lastMonth', 'last30', 'ytd'] as const;
export type ClarificationOptionId = (typeof CLARIFICATION_OPTION_IDS)[number];

export type ClarificationOption = {
  id: ClarificationOptionId;
  label: string;
  dateRange: { from: string; to: string };
};

/**
 * Deterministic clarification options for temporally ambiguous questions.
 * Every option is resolved server-side in the user's IANA timezone; the model
 * never invents the clarification scope. Labels are localized by the caller.
 */
export function buildClarificationOptions(
  timeZone: string,
  labels: Record<ClarificationOptionId, string>,
  now: Date = new Date(),
): ClarificationOption[] {
  const today = todayInTimeZone(timeZone, now);
  const todayDate = parseDate(today);
  const thisMonthFrom = iso(
    new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1)),
  );
  const previous = previousMonthBounds(todayDate);
  const last30From = iso(shiftDays(todayDate, -29));
  const ytdFrom = iso(new Date(Date.UTC(todayDate.getUTCFullYear(), 0, 1)));
  return [
    { id: 'thisMonth', label: labels.thisMonth, dateRange: { from: thisMonthFrom, to: today } },
    {
      id: 'lastMonth',
      label: labels.lastMonth,
      dateRange: { from: iso(previous.from), to: iso(previous.to) },
    },
    { id: 'last30', label: labels.last30, dateRange: { from: last30From, to: today } },
    { id: 'ytd', label: labels.ytd, dateRange: { from: ytdFrom, to: today } },
  ];
}

type PhraseDefinition = {
  key: string;
  patterns: Record<string, RegExp>;
};

const PHRASES: PhraseDefinition[] = [
  {
    key: 'thisMonth',
    patterns: {
      en: /\bthis month\b/i,
      tr: /\bbu ay\b/i,
      ar: /هذا الشهر|الشهر الحالي/u,
    },
  },
  {
    key: 'lastMonth',
    patterns: {
      en: /\blast month\b/i,
      tr: /\bgeçen ay\b|\bgecen ay\b/i,
      ar: /الشهر الماضي|الشهر السابق/u,
    },
  },
  {
    key: 'thisWeek',
    patterns: {
      en: /\bthis week\b/i,
      tr: /\bbu hafta\b/i,
      ar: /هذا الأسبوع|هذا الاسبوع/u,
    },
  },
  {
    key: 'lastWeek',
    patterns: {
      en: /\blast week\b/i,
      tr: /\bgeçen hafta\b|\bgecen hafta\b/i,
      ar: /الأسبوع الماضي|الاسبوع الماضي/u,
    },
  },
  {
    key: 'last7',
    patterns: {
      en: /\blast 7 days\b|\blast seven days\b/i,
      tr: /\bson 7 gün\b/i,
      ar: /آخر 7 أيام|آخر ٧ أيام|خلال 7 أيام|خلال ٧ أيام/u,
    },
  },
  {
    key: 'last14',
    patterns: {
      en: /\blast 14 days\b/i,
      tr: /\bson 14 gün\b/i,
      ar: /آخر 14 يوم|آخر ١٤ يوم/u,
    },
  },
  {
    key: 'last30',
    patterns: {
      en: /\blast 30 days\b|\blast thirty days\b|\bpast 30 days\b/i,
      tr: /\bson 30 gün\b/i,
      ar: /آخر 30 يوم|آخر ٣٠ يوم|خلال 30 يوم|خلال ٣٠ يوم/u,
    },
  },
  {
    key: 'last90',
    patterns: {
      en: /\blast 90 days\b|\blast quarter\b/i,
      tr: /\bson 90 gün\b/i,
      ar: /آخر 90 يوم|آخر ٩٠ يوم/u,
    },
  },
  {
    key: 'thisYear',
    patterns: {
      en: /\bthis year\b|\bthis calendar year\b/i,
      tr: /\bbu yıl\b|\bbu yil\b/i,
      ar: /هذه السنة|هذه السنه|هذا العام/u,
    },
  },
  {
    key: 'ytd',
    patterns: {
      en: /\byear to date\b|\bytd\b/i,
      tr: /\byıl başından beri\b|\byil basindan beri\b|\bytd\b/i,
      ar: /منذ بداية العام|من بداية السنة|منذ بداية السنة/u,
    },
  },
  {
    key: 'lastYear',
    patterns: {
      en: /\blast year\b|\blast calendar year\b/i,
      tr: /\bgeçen yıl\b|\bgecen yil\b/i,
      ar: /السنة الماضية|السنه الماضيه|العام الماضي/u,
    },
  },
];

/**
 * Resolves a date phrase in the message to explicit boundaries, or null when
 * no phrase is present (caller then applies a default range).
 */
export function resolvePhraseDateRange(
  message: string,
  locale: string,
  timeZone: string,
  now: Date = new Date(),
): ResolvedDateRange | null {
  const today = todayInTimeZone(timeZone, now);
  const todayDate = parseDate(today);
  for (const phrase of PHRASES) {
    const pattern = phrase.patterns[locale] ?? phrase.patterns.en!;
    if (pattern.test(message)) {
      switch (phrase.key) {
        case 'thisMonth': {
          const { from } = monthBounds(todayDate.getUTCFullYear(), todayDate.getUTCMonth());
          return { key: phrase.key, from: iso(from), to: today };
        }
        case 'lastMonth': {
          const { from, to } = previousMonthBounds(todayDate);
          return { key: phrase.key, from: iso(from), to: iso(to) };
        }
        case 'thisWeek': {
          const monday = mondayOfWeek(todayDate);
          return { key: phrase.key, from: iso(monday), to: today };
        }
        case 'lastWeek': {
          const thisMonday = mondayOfWeek(todayDate);
          const lastMonday = shiftDays(thisMonday, -7);
          const lastSunday = shiftDays(thisMonday, -1);
          return { key: phrase.key, from: iso(lastMonday), to: iso(lastSunday) };
        }
        case 'last7':
          return { key: phrase.key, from: iso(shiftDays(todayDate, -6)), to: today };
        case 'last14':
          return { key: phrase.key, from: iso(shiftDays(todayDate, -13)), to: today };
        case 'last30':
          return { key: phrase.key, from: iso(shiftDays(todayDate, -29)), to: today };
        case 'last90':
          return { key: phrase.key, from: iso(shiftDays(todayDate, -89)), to: today };
        case 'thisYear': {
          const from = new Date(Date.UTC(todayDate.getUTCFullYear(), 0, 1));
          return { key: phrase.key, from: iso(from), to: today };
        }
        case 'ytd':
          return {
            key: phrase.key,
            from: iso(new Date(Date.UTC(todayDate.getUTCFullYear(), 0, 1))),
            to: today,
          };
        case 'lastYear': {
          const year = todayDate.getUTCFullYear() - 1;
          return {
            key: phrase.key,
            from: iso(new Date(Date.UTC(year, 0, 1))),
            to: iso(new Date(Date.UTC(year, 11, 31))),
          };
        }
        default:
          return null;
      }
    }
  }
  return null;
}

export function previousRangeOf(current: ResolvedDateRange): ResolvedDateRange {
  const from = parseDate(current.from);
  const to = parseDate(current.to);
  const span = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return {
    key: `previous-${current.key}`,
    from: iso(shiftDays(from, -(span + 1))),
    to: iso(shiftDays(from, -1)),
  };
}
