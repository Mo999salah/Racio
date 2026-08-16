import { describe, expect, it } from 'vitest';
import {
  currentPeriodBounds,
  daysRemaining,
  isPeriodEnded,
  periodKey,
  todayForTimeZone,
} from '../src/period';

describe('todayForTimeZone', () => {
  it('returns the calendar date in the requested IANA timezone', () => {
    const now = new Date('2026-08-16T23:30:00Z');
    expect(todayForTimeZone('UTC', now)).toBe('2026-08-16');
    expect(todayForTimeZone('Asia/Tokyo', now)).toBe('2026-08-17');
    expect(todayForTimeZone('America/New_York', now)).toBe('2026-08-16');
  });

  it('keeps the calendar date stable across DST boundaries', () => {
    // US DST starts 2026-03-08 (02:00 EST -> 03:00 EDT) and ends
    // 2026-11-01 (02:00 EDT -> 01:00 EST). The date-only "today" must not
    // shift by the lost/gained hour.
    expect(todayForTimeZone('America/New_York', new Date('2026-03-08T06:59:59Z'))).toBe(
      '2026-03-08',
    );
    expect(todayForTimeZone('America/New_York', new Date('2026-03-08T07:00:00Z'))).toBe(
      '2026-03-08',
    );
    expect(todayForTimeZone('America/New_York', new Date('2026-03-08T08:00:00Z'))).toBe(
      '2026-03-08',
    );
    expect(todayForTimeZone('America/New_York', new Date('2026-11-01T05:59:59Z'))).toBe(
      '2026-11-01',
    );
    expect(todayForTimeZone('America/New_York', new Date('2026-11-01T06:00:00Z'))).toBe(
      '2026-11-01',
    );
  });
});

describe('weekly periods', () => {
  it('starts on Monday regardless of locale', () => {
    // Sunday
    expect(currentPeriodBounds('weekly', '2026-08-16')).toMatchObject({
      start: '2026-08-10',
      end: '2026-08-16',
      previousStart: '2026-08-03',
      previousEnd: '2026-08-09',
    });
    // Monday
    expect(currentPeriodBounds('weekly', '2026-08-17')).toMatchObject({
      start: '2026-08-17',
      end: '2026-08-23',
      previousStart: '2026-08-10',
      previousEnd: '2026-08-16',
    });
  });
});

describe('monthly periods', () => {
  it('uses the calendar month', () => {
    expect(currentPeriodBounds('monthly', '2026-08-17')).toMatchObject({
      start: '2026-08-01',
      end: '2026-08-31',
      previousStart: '2026-07-01',
      previousEnd: '2026-07-31',
    });
  });

  it('handles February leap years', () => {
    expect(currentPeriodBounds('monthly', '2024-02-10')).toMatchObject({
      start: '2024-02-01',
      end: '2024-02-29',
    });
    expect(currentPeriodBounds('monthly', '2025-02-10')).toMatchObject({
      start: '2025-02-01',
      end: '2025-02-28',
    });
  });
});

describe('yearly periods', () => {
  it('uses the calendar year', () => {
    expect(currentPeriodBounds('yearly', '2026-08-17')).toMatchObject({
      start: '2026-01-01',
      end: '2026-12-31',
      previousStart: '2025-01-01',
      previousEnd: '2025-12-31',
    });
  });
});

describe('custom periods', () => {
  it('uses the explicit range and has no previous period', () => {
    expect(currentPeriodBounds('custom', '2026-08-17', '2026-05-01', '2026-05-31')).toEqual({
      start: '2026-05-01',
      end: '2026-05-31',
      previousStart: null,
      previousEnd: null,
    });
  });

  it('requires both dates', () => {
    expect(() => currentPeriodBounds('custom', '2026-08-17')).toThrow();
  });
});

describe('daysRemaining and period end', () => {
  it('counts days inclusively', () => {
    expect(daysRemaining('2026-08-17', '2026-08-23')).toBe(7);
    expect(daysRemaining('2026-08-23', '2026-08-23')).toBe(1);
    expect(daysRemaining('2026-08-24', '2026-08-23')).toBe(0);
  });

  it('detects ended periods', () => {
    expect(isPeriodEnded('2026-08-24', '2026-08-23')).toBe(true);
    expect(isPeriodEnded('2026-08-23', '2026-08-23')).toBe(false);
  });
});

describe('periodKey', () => {
  it('produces deterministic dedupe keys', () => {
    expect(periodKey('monthly', currentPeriodBounds('monthly', '2026-08-17'))).toBe('m:2026-08-01');
    expect(periodKey('weekly', currentPeriodBounds('weekly', '2026-08-17'))).toBe('w:2026-08-17');
    expect(periodKey('yearly', currentPeriodBounds('yearly', '2026-08-17'))).toBe('y:2026-01-01');
    expect(
      periodKey('custom', currentPeriodBounds('custom', '2026-08-17', '2026-05-01', '2026-05-31')),
    ).toBe('c:2026-05-01:2026-05-31');
  });
});
