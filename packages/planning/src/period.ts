/**
 * Deterministic calendar-period handling for budgets.
 *
 * Booking dates are date-only strings (`YYYY-MM-DD`) and are never UTC-shifted.
 * Only "today" is derived from the user's IANA timezone; all period arithmetic
 * is then pure calendar math on the date-only strings, so a transaction booked
 * on 2026-08-31 stays on 2026-08-31 regardless of the user's timezone.
 */

export type PeriodType = 'weekly' | 'monthly' | 'yearly' | 'custom';

export type PeriodBounds = {
  start: string;
  end: string;
  previousStart: string | null;
  previousEnd: string | null;
};

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const parsed = parseDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return isoDate(parsed);
}

function dayOfWeek(date: string): number {
  return parseDate(date).getUTCDay();
}

function daysInclusiveBetween(from: string, to: string): number {
  const milliseconds = parseDate(to).getTime() - parseDate(from).getTime();
  return Math.round(milliseconds / 86_400_000) + 1;
}

function monthStart(year: number, monthIndexZeroBased: number): string {
  return isoDate(new Date(Date.UTC(year, monthIndexZeroBased, 1)));
}

function monthEnd(year: number, monthIndexZeroBased: number): string {
  return isoDate(new Date(Date.UTC(year, monthIndexZeroBased + 1, 0)));
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

function monthIndexOf(date: string): number {
  return Number(date.slice(5, 7)) - 1;
}

/** The current calendar date in the user's IANA timezone, as `YYYY-MM-DD`. */
export function todayForTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}

export function currentPeriodBounds(
  period: PeriodType,
  today: string,
  customStart?: string | null,
  customEnd?: string | null,
): PeriodBounds {
  switch (period) {
    case 'weekly': {
      const mondayOffset = (dayOfWeek(today) + 6) % 7;
      const start = addDays(today, -mondayOffset);
      const end = addDays(start, 6);
      return {
        start,
        end,
        previousStart: addDays(start, -7),
        previousEnd: addDays(start, -1),
      };
    }
    case 'monthly': {
      const year = yearOf(today);
      const month = monthIndexOf(today);
      const start = monthStart(year, month);
      const end = monthEnd(year, month);
      return {
        start,
        end,
        previousStart: monthStart(year, month - 1),
        previousEnd: monthEnd(year, month - 1),
      };
    }
    case 'yearly': {
      const year = yearOf(today);
      return {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
        previousStart: `${year - 1}-01-01`,
        previousEnd: `${year - 1}-12-31`,
      };
    }
    case 'custom': {
      if (!customStart || !customEnd) {
        throw new Error('A custom budget requires both start and end dates.');
      }
      return { start: customStart, end: customEnd, previousStart: null, previousEnd: null };
    }
  }
}

/** Days remaining in the current period, inclusive of today, never negative. */
export function daysRemaining(today: string, end: string): number {
  if (today > end) return 0;
  return daysInclusiveBetween(today, end);
}

export function isPeriodEnded(today: string, end: string): boolean {
  return today > end;
}

/** Deterministic dedupe key for a period, used by budget alert events. */
export function periodKey(period: PeriodType, bounds: PeriodBounds): string {
  switch (period) {
    case 'weekly':
      return `w:${bounds.start}`;
    case 'monthly':
      return `m:${bounds.start}`;
    case 'yearly':
      return `y:${bounds.start}`;
    case 'custom':
      return `c:${bounds.start}:${bounds.end}`;
  }
}
