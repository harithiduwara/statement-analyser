import { describe, expect, it } from 'vitest';
import { formatMoney, parseAmount, roundMoney, sumMoney } from '@/lib/money';
import { maskCardNumber, scrubPan } from '@/lib/mask';

describe('parseAmount', () => {
  it('reads a plain debit', () => {
    expect(parseAmount('12,450.00')?.value).toBe(12_450);
    expect(parseAmount('12,450.00')?.isCredit).toBe(false);
  });

  it('reads a CR suffix as a credit', () => {
    for (const input of ['85,000.00CR', '85,000.00 CR', '85,000.00cr']) {
      const parsed = parseAmount(input);
      expect(parsed?.value, input).toBe(-85_000);
      expect(parsed?.isCredit, input).toBe(true);
    }
  });

  it('reads parentheses and leading minus as credits', () => {
    expect(parseAmount('(1,234.56)')?.value).toBe(-1_234.56);
    expect(parseAmount('-1,234.56')?.value).toBe(-1_234.56);
    expect(parseAmount('1,234.56-')?.value).toBe(-1_234.56);
  });

  it('returns undefined rather than zero for a non-amount', () => {
    for (const input of ['', '  ', 'LKR', 'SUBTOTAL', '12/03/26', undefined, null]) {
      expect(parseAmount(input), String(input)).toBeUndefined();
    }
  });

  it('does not read a date as an amount', () => {
    expect(parseAmount('06/04/2026')).toBeUndefined();
  });
});

describe('money arithmetic', () => {
  it('rounds to the printed precision', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(sumMoney([95_595.05, -85_080])).toBe(10_515.05);
  });

  it('formats credits in parentheses and zero as a dash', () => {
    expect(formatMoney(1_234.5)).toBe('1,234.50');
    expect(formatMoney(-1_234.5)).toBe('(1,234.50)');
    expect(formatMoney(0)).toBe('-');
  });
});

describe('card masking', () => {
  it('keeps only the last four digits', () => {
    expect(maskCardNumber('40463300****2470')).toBe('2470');
    expect(maskCardNumber('4046 3300 XXXX 2470')).toBe('2470');
    expect(maskCardNumber('4046-3300-1111-2470')).toBe('2470');
  });

  it('returns undefined when there is nothing to mask', () => {
    expect(maskCardNumber('')).toBeUndefined();
    expect(maskCardNumber('abc')).toBeUndefined();
  });

  it('scrubs PAN-shaped runs from free text', () => {
    expect(scrubPan('card 4046330011112470 used')).toBe('card ****2470 used');
    expect(scrubPan('card 4046 3300 1111 2470')).toBe('card ****2470');
  });

  it('leaves a transaction reference alone', () => {
    // Seylan prints a twelve-digit auth reference on every row. It is not a
    // card number -- the shortest of those is thirteen digits -- and blanking
    // it would destroy the only per-row identifier the statement gives.
    expect(scrubPan('ref 074512')).toBe('ref 074512');
    expect(scrubPan('010249370770 CEFT PAYMENT')).toBe('010249370770 CEFT PAYMENT');
  });
});
