import type { Money, Statement } from '@/domain/types';
import { monthKey } from '@/lib/dates';
import { roundMoney } from '@/lib/money';
import type { CycleDecomposition } from './decomposition';

/**
 * Money in and money out, per calendar month.
 *
 * Out is true charges -- real spending, with a reversed-and-rebooked purchase
 * removed, so a single month is not inflated by both an origination and its
 * reversal. In is the payments that settle the account (the `payment` class),
 * not refunds or reversals, so it reads as "what you paid the card". Net is
 * what the month got you: positive paid the balance down, negative grew it.
 *
 * Statements for several cards in the same calendar month are summed, so the
 * figures are the household's month, not one card's.
 */

export interface MonthFlow {
  /** `YYYY-MM`. */
  month: string;
  moneyIn: Money;
  moneyOut: Money;
  /** moneyIn − moneyOut. */
  net: Money;
}

export function monthlyFlow(
  statements: readonly Statement[],
  decomposition: readonly CycleDecomposition[],
): MonthFlow[] {
  const inByMonth = new Map<string, number>();
  const outByMonth = new Map<string, number>();

  for (const d of decomposition) {
    const m = monthKey(d.statementDate);
    outByMonth.set(m, (outByMonth.get(m) ?? 0) + d.trueCharges);
  }

  for (const s of statements) {
    const m = monthKey(s.statementDate);
    let paid = 0;
    for (const t of s.transactions) {
      if (t.classification === 'payment') paid += Math.abs(t.amount);
    }
    inByMonth.set(m, (inByMonth.get(m) ?? 0) + paid);
  }

  const months = [...new Set([...inByMonth.keys(), ...outByMonth.keys()])].sort();
  return months.map((month) => {
    const moneyIn = roundMoney(inByMonth.get(month) ?? 0);
    const moneyOut = roundMoney(outByMonth.get(month) ?? 0);
    return { month, moneyIn, moneyOut, net: roundMoney(moneyIn - moneyOut) };
  });
}
