import { describe, expect, it } from 'vitest';
import { computePlan, emptyPlan, type MonthlyPlan } from '@/domain/plan';

function plan(over: Partial<MonthlyPlan> = {}): MonthlyPlan {
  return { ...emptyPlan('2026-09'), ...over };
}
const line = (label: string, amount: number) => ({ id: label, label, amount });

describe('computePlan', () => {
  it('take-home is income less what is taken off the top', () => {
    const s = computePlan(
      plan({ income: [line('salary', 290_000)], deductions: [line('loan', 40_000)] }),
      { cardInstallments: 0, subscriptions: 0 },
    );
    expect(s.income).toBe(290_000);
    expect(s.takeHome).toBe(250_000);
  });

  it('seeds committed outflows from the statements, not from entry', () => {
    const s = computePlan(
      plan({ income: [line('salary', 290_000)], bills: [line('rent', 120_000)] }),
      { cardInstallments: 88_252.03, subscriptions: 52_081.73 },
    );
    // committed = bills 120,000 + instalments 88,252.03 + subscriptions 52,081.73
    expect(s.committed).toBe(260_333.76);
    expect(s.cardInstallments).toBe(88_252.03);
  });

  it('left to spend is take-home minus everything spoken for, savings included', () => {
    const s = computePlan(
      plan({
        income: [line('salary', 290_000)],
        bills: [line('rent', 100_000)],
        savings: [line('fund', 38_000)],
      }),
      { cardInstallments: 50_000, subscriptions: 12_000 },
    );
    // spokenFor = (100,000 + 50,000 + 12,000) + 38,000 = 200,000
    expect(s.spokenFor).toBe(200_000);
    expect(s.leftToSpend).toBe(90_000);
    expect(s.overCommitted).toBe(false);
  });

  it('flags an over-committed plan with a negative left-to-spend', () => {
    const s = computePlan(
      plan({ income: [line('salary', 100_000)] }),
      { cardInstallments: 90_000, subscriptions: 30_000 },
    );
    expect(s.leftToSpend).toBe(-20_000);
    expect(s.overCommitted).toBe(true);
    expect(s.committedPct).toBeCloseTo(1.2, 6); // 120% of take-home
  });

  it('builds where-it-goes shares that sum to one, dropping empty groups', () => {
    const s = computePlan(
      plan({ income: [line('salary', 100_000)], savings: [line('fund', 25_000)] }),
      { cardInstallments: 25_000, subscriptions: 0 },
    );
    expect(s.where.map((w) => w.key)).toEqual(['installments', 'savings']);
    expect(s.where.reduce((a, w) => a + w.share, 0)).toBeCloseTo(1, 9);
    expect(s.where.find((w) => w.key === 'installments')?.sourced).toBe(true);
  });

  it('has no percentages when there is no take-home yet', () => {
    const s = computePlan(emptyPlan('2026-09'), { cardInstallments: 0, subscriptions: 0 });
    expect(s.takeHome).toBe(0);
    expect(s.committedPct).toBeUndefined();
    expect(s.overCommitted).toBe(false);
  });
});
