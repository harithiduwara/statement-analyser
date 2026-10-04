import type { Money } from './types';
import { roundMoney, sumMoney } from '@/lib/money';

/**
 * The monthly plan: a forward-looking companion to the backward-looking
 * analysis. What comes in, what is already spoken for, and what is left.
 *
 * The committed side is not typed in from memory: the card-instalment figure
 * and the subscription estimate are seeded from the parsed statements, so the
 * plan is anchored to what the statements prove rather than to guesswork. The
 * income, deductions and savings are the parts the statements cannot know, so
 * those the reader enters.
 */

export interface PlanLine {
  id: string;
  label: string;
  amount: Money;
  /** Day of the month an income line arrives, for the calendar. */
  day?: number;
}

export type SectionKey = 'income' | 'deductions' | 'bills' | 'savings';

export interface MonthlyPlan {
  /** `YYYY-MM`. */
  month: string;
  income: PlanLine[];
  deductions: PlanLine[];
  /** Committed bills & household the reader adds by hand. */
  bills: PlanLine[];
  savings: PlanLine[];
}

export function emptyPlan(month: string): MonthlyPlan {
  return { month, income: [], deductions: [], bills: [], savings: [] };
}

/** Figures pulled from the parsed statements, not entered by hand. */
export interface PlanSeed {
  /** Monthly card-instalment obligation, from the plan register. */
  cardInstallments: Money;
  /** Estimated monthly subscription spend, from category classification. */
  subscriptions: Money;
  /** Estimated monthly utilities & telco spend, from category classification. */
  utilities: Money;
}

export interface WhereSlice {
  key: string;
  label: string;
  amount: Money;
  /** Share of the four committed-and-saved groups. */
  share: number;
  /** True when the figure came from the statements rather than the reader. */
  sourced: boolean;
}

export interface PlanSummary {
  income: Money;
  deductions: Money;
  /** income − deductions. */
  takeHome: Money;
  bills: Money;
  cardInstallments: Money;
  subscriptions: Money;
  utilities: Money;
  /** bills + card instalments + subscriptions + utilities. */
  committed: Money;
  savings: Money;
  /** committed + savings: everything already spoken for. */
  spokenFor: Money;
  /** takeHome − spokenFor. Negative when the plan is over-committed. */
  leftToSpend: Money;
  where: WhereSlice[];
  /** committed / takeHome, undefined when there is no take-home. */
  committedPct?: number;
  /** spokenFor / takeHome. */
  spokenForPct?: number;
  /** savings / takeHome. */
  savingsPct?: number;
  /** True once any income line has been entered: the plan is set up. */
  hasIncome: boolean;
  overCommitted: boolean;
}

const total = (lines: readonly PlanLine[]): Money =>
  roundMoney(sumMoney(lines.map((l) => (Number.isFinite(l.amount) ? l.amount : 0))));

export function computePlan(plan: MonthlyPlan, seed: PlanSeed): PlanSummary {
  const income = total(plan.income);
  const deductions = total(plan.deductions);
  const takeHome = roundMoney(income - deductions);

  const bills = total(plan.bills);
  const cardInstallments = roundMoney(Math.max(0, seed.cardInstallments));
  const subscriptions = roundMoney(Math.max(0, seed.subscriptions));
  const utilities = roundMoney(Math.max(0, seed.utilities));
  const committed = roundMoney(bills + cardInstallments + subscriptions + utilities);

  const savings = total(plan.savings);
  const spokenFor = roundMoney(committed + savings);
  const leftToSpend = roundMoney(takeHome - spokenFor);

  // Four groups, so the ring stays within the validated palette: subscriptions
  // and utilities -- both small recurring commitments -- share one slice. The
  // committed section lists each of them on its own.
  const groups = [
    { key: 'installments', label: 'Card instalments', amount: cardInstallments, sourced: true },
    {
      key: 'recurring',
      label: 'Subscriptions & utilities',
      amount: roundMoney(subscriptions + utilities),
      sourced: true,
    },
    { key: 'bills', label: 'Bills & household', amount: bills, sourced: false },
    { key: 'savings', label: 'Savings & investments', amount: savings, sourced: false },
  ];
  const base = groups.reduce((acc, g) => acc + g.amount, 0);
  const where: WhereSlice[] = groups
    .filter((g) => g.amount > 0)
    .map((g) => ({ ...g, share: base > 0 ? g.amount / base : 0 }));

  const pct = (n: Money): number | undefined => (takeHome > 0 ? n / takeHome : undefined);
  const committedPct = pct(committed);
  const spokenForPct = pct(spokenFor);
  const savingsPct = pct(savings);

  return {
    income,
    deductions,
    takeHome,
    bills,
    cardInstallments,
    subscriptions,
    utilities,
    committed,
    savings,
    spokenFor,
    leftToSpend,
    where,
    hasIncome: income > 0,
    ...(committedPct === undefined ? {} : { committedPct }),
    ...(spokenForPct === undefined ? {} : { spokenForPct }),
    ...(savingsPct === undefined ? {} : { savingsPct }),
    // Only a plan that has an income can be "over-committed"; with none set it
    // is simply not filled in yet, which the view says instead of warning.
    overCommitted: income > 0 && leftToSpend < 0,
  };
}
