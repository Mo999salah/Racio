import { describe, expect, it } from 'vitest';
import {
  addMoney,
  isNegative,
  isNonNegativeDecimal,
  isZero,
  maxMoney,
  percentOf,
  percentReached,
  subtractMoney,
} from '../src/money';

describe('money arithmetic', () => {
  it('adds scale-6 decimals exactly', () => {
    expect(addMoney('1.5', '2.25')).toBe('3.75');
    expect(addMoney('0.000001', '0.000002')).toBe('0.000003');
    expect(addMoney('1000', '0')).toBe('1000');
  });

  it('subtracts scale-6 decimals exactly', () => {
    expect(subtractMoney('10', '3.4')).toBe('6.6');
    expect(subtractMoney('5', '8')).toBe('-3');
  });

  it('detects zero and negative', () => {
    expect(isZero('0')).toBe(true);
    expect(isZero('0.000000')).toBe(true);
    expect(isZero('0.000001')).toBe(false);
    expect(isNegative('-0.000001')).toBe(true);
    expect(isNegative('0.000001')).toBe(false);
  });

  it('picks the larger amount', () => {
    expect(maxMoney('1.5', '2.25')).toBe('2.25');
    expect(maxMoney('3', '2')).toBe('3');
  });

  it('validates non-negative decimals', () => {
    expect(isNonNegativeDecimal('12.340006')).toBe(true);
    expect(isNonNegativeDecimal('-1')).toBe(false);
    expect(isNonNegativeDecimal('abc')).toBe(false);
  });
});

describe('percentOf', () => {
  it('computes two-digit percentages from scaled integers', () => {
    expect(percentOf('12450', '20000')).toBe('62.25');
    expect(percentOf('12', '20')).toBe('60');
    expect(percentOf('1', '3')).toBe('33.33');
    expect(percentOf('100', '50')).toBe('200');
  });

  it('returns "0" for a non-positive total', () => {
    expect(percentOf('10', '0')).toBe('0');
  });

  it('preserves exact decimal parts', () => {
    expect(percentOf('2.34', '3.456')).toBe('67.7');
  });
});

describe('percentReached', () => {
  it('compares percentages on scaled integers', () => {
    expect(percentReached('800', '1000', 80)).toBe(true);
    expect(percentReached('799.99', '1000', 80)).toBe(false);
    expect(percentReached('1000', '1000', 100)).toBe(true);
    expect(percentReached('1000.000001', '1000', 100)).toBe(true);
    expect(percentReached('10', '0', 80)).toBe(false);
  });
});
