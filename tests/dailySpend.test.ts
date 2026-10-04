import { describe, expect, it } from 'vitest';
import { statement, txn } from './helpers/build';
import { buildPortfolio } from '@/analysis/portfolio';
import { dailySpend, compileRules, SEED_RULES } from '@/analysis/categories';

function dailyOf(statements: ReturnType<typeof statement>[]) {
  const p = buildPortfolio(statements);
  return dailySpend(p.statements, compileRules(SEED_RULES), p.reversals, p.register, 'economic');
}

describe('dailySpend', () => {
  it('buckets by day and fills the gap days with zero, so the axis is continuous', () => {
    const daily = dailyOf([
      statement({
        date: '2026-01-31',
        opening: 0,
        transactions: [
          txn({ post: '2026-01-10', description: 'KEELLS - COLOMBO', amount: 5_000 }),
          txn({ post: '2026-01-10', description: 'CEYPETCO FUEL', amount: 3_000 }),
          txn({ post: '2026-01-13', description: 'ODEL - COLOMBO', amount: 2_000 }),
        ],
      }),
    ]);

    expect(daily.map((p) => p.date)).toEqual([
      '2026-01-10',
      '2026-01-11',
      '2026-01-12',
      '2026-01-13',
    ]);
    expect(daily[0]!.amount).toBe(8_000); // two charges on the same day
    expect(daily[1]!.amount).toBe(0);
    expect(daily[2]!.amount).toBe(0);
    expect(daily[3]!.amount).toBe(2_000);
  });

  it('excludes a reversed charge, like every other spend view', () => {
    const daily = dailyOf([
      statement({
        date: '2026-02-28',
        opening: 0,
        transactions: [
          txn({ post: '2026-02-10', description: 'ODEL - COLOMBO', amount: 15_000 }),
          txn({ post: '2026-02-12', description: 'ODEL - COLOMBO', amount: -15_000 }),
          txn({ post: '2026-02-15', description: 'CEYPETCO FUEL', amount: 20_000 }),
        ],
      }),
    ]);
    expect(daily).toEqual([{ date: '2026-02-15', amount: 20_000 }]);
  });

  it('is empty when nothing was spent', () => {
    const daily = dailyOf([
      statement({
        date: '2026-03-05',
        opening: 0,
        transactions: [txn({ post: '2026-03-10', description: 'PAYMENT - THANK YOU', amount: -10_000 })],
      }),
    ]);
    expect(daily).toEqual([]);
  });
});
