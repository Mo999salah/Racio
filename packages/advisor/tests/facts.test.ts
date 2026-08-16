import { describe, expect, it } from 'vitest';
import {
  formatAmountForLocale,
  renderAnswer,
  validateExplanation,
  type AdvisorFact,
} from '../src/facts';

function fact(id: string, amount: string, currency: string): AdvisorFact {
  return {
    id,
    tool: 'get_period_summary',
    label: `Fact ${id}`,
    value: { kind: 'money', amount, currency },
  };
}

function textFact(id: string, value: string): AdvisorFact {
  return { id, tool: 'get_alert_summary', label: `Fact ${id}`, value: { kind: 'text', value } };
}

describe('fact validation', () => {
  it('accepts placeholders and citations that exist', () => {
    const facts = new Map([['fact-1', fact('fact-1', '100', 'TRY')]]);
    expect(validateExplanation('Spent {{fact:1}}.', ['fact-1'], facts)).toEqual({ ok: true });
  });

  it('rejects an unknown fact placeholder', () => {
    const facts = new Map([['fact-1', fact('fact-1', '100', 'TRY')]]);
    const result = validateExplanation('Spent {{fact:99}}.', ['fact-1'], facts);
    expect(result.ok).toBe(false);
  });

  it('rejects citations for facts that do not exist', () => {
    const facts = new Map([['fact-1', fact('fact-1', '100', 'TRY')]]);
    const result = validateExplanation('Fine.', ['fact-99'], facts);
    expect(result.ok).toBe(false);
  });

  it('rejects an empty answer', () => {
    const facts = new Map([['fact-1', fact('fact-1', '100', 'TRY')]]);
    const result = validateExplanation('', ['fact-1'], facts);
    expect(result.ok).toBe(false);
  });

  it('rejects an answer that cites no fact at all', () => {
    const facts = new Map([['fact-1', fact('fact-1', '100', 'TRY')]]);
    const result = validateExplanation('I made this number up: 42 TRY', [], facts);
    expect(result.ok).toBe(false);
  });
});

describe('answer rendering', () => {
  it('renders placeholders with exact server-side values', () => {
    const facts = new Map([
      ['fact-1', fact('fact-1', '4250.50', 'TRY')],
      ['fact-2', textFact('fact-2', 'over budget')],
    ]);
    const rendered = renderAnswer('You spent {{fact:1}} and you are {{fact:2}}.', facts, 'en');
    expect(rendered).toBe('You spent 4,250.50 TRY and you are over budget.');
  });

  it('formats amounts with locale grouping and explicit currency code', () => {
    expect(formatAmountForLocale('4250.5', 'en')).toBe('4,250.5');
    expect(formatAmountForLocale('-1200.00', 'en')).toBe('-1,200');
  });

  it('keeps multi-currency values separate with their codes', () => {
    const facts = new Map([
      ['fact-1', fact('fact-1', '1000', 'TRY')],
      ['fact-2', fact('fact-2', '50', 'USD')],
    ]);
    const rendered = renderAnswer('TRY: {{fact:1}}; USD: {{fact:2}}.', facts, 'en');
    expect(rendered).toBe('TRY: 1,000 TRY; USD: 50 USD.');
  });
});
