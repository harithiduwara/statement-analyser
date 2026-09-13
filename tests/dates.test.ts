import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween, monthKey, parseDate, resolveYearlessDate } from '@/lib/dates';

describe('parseDate', () => {
  it('reads day-first numeric dates', () => {
    expect(parseDate('06/04/2026')).toBe('2026-04-06');
    expect(parseDate('15/03/26')).toBe('2026-03-15');
    expect(parseDate('06-04-2026')).toBe('2026-04-06');
  });

  it('reads alphabetic month forms', () => {
    expect(parseDate('06 MAR 2026')).toBe('2026-03-06');
    expect(parseDate('6 March 2026')).toBe('2026-03-06');
    expect(parseDate('MAR 06, 2026')).toBe('2026-03-06');
  });

  it('rejects impossible calendar dates instead of rolling them over', () => {
    expect(parseDate('31/02/26')).toBeUndefined();
    expect(parseDate('00/04/26')).toBeUndefined();
    expect(parseDate('06/13/26')).toBeUndefined();
  });

  it('returns undefined for non-dates', () => {
    expect(parseDate('12,450.00')).toBeUndefined();
    expect(parseDate('SUBTOTAL')).toBeUndefined();
  });

  it('handles statement dates that drift across the start of a month', () => {
    // Nothing may key off "the 6th"; each of these is an ordinary cycle date.
    expect(parseDate('06/04/2026')).toBe('2026-04-06');
    expect(parseDate('07/05/2026')).toBe('2026-05-07');
    expect(parseDate('08/06/2026')).toBe('2026-06-08');
  });
});

describe('date arithmetic', () => {
  it('resolves a yearless row against the statement date', () => {
    expect(resolveYearlessDate(28, 12, '2027-01-06')).toBe('2026-12-28');
    expect(resolveYearlessDate(3, 1, '2027-01-06')).toBe('2027-01-03');
  });

  it('counts days and months', () => {
    expect(daysBetween('2026-03-06', '2026-04-06')).toBe(31);
    expect(monthKey('2026-03-15')).toBe('2026-03');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});
