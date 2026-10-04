import { describe, expect, it } from 'vitest';
import { statement, txn } from './helpers/build';
import { buildPortfolio } from '@/analysis/portfolio';
import { categoryMonthlySeries, compileRules, SEED_RULES } from '@/analysis/categories';
import type { SpendView } from '@/analysis/categories';

function seriesOf(statements: ReturnType<typeof statement>[], view: SpendView = 'economic') {
  const p = buildPortfolio(statements);
  return categoryMonthlySeries(p.statements, compileRules(SEED_RULES), p.reversals, p.register, view);
}

describe('categoryMonthlySeries', () => {
  it('aligns every category to one shared month axis, largest total first', () => {
    const series = seriesOf([
      statement({
        date: '2026-01-05',
        opening: 0,
        transactions: [
          txn({ post: '2026-01-10', description: 'CEYPETCO FUEL', amount: 30_000 }),
          txn({ post: '2026-01-12', description: 'KEELLS - COLOMBO', amount: 5_000 }),
        ],
      }),
      statement({
        date: '2026-02-05',
        opening: 0,
        transactions: [txn({ post: '2026-02-10', description: 'CEYPETCO FUEL', amount: 40_000 })],
      }),
    ]);

    expect(series.months).toEqual(['2026-01', '2026-02']);
    expect(series.monthlyTotal).toEqual([35_000, 40_000]);

    // Fuel has the largest total, so it leads; its monthly series spans both months.
    expect(series.series[0]!.category).toBe('fuel');
    expect(series.series[0]!.monthly).toEqual([30_000, 40_000]);
    expect(series.series[0]!.total).toBe(70_000);

    // Supermarkets (groceries) only spent in January — aligned with a 0 for February.
    const groceries = series.series.find((s) => s.category === 'groceries');
    expect(groceries?.monthly).toEqual([5_000, 0]);
    expect(groceries?.total).toBe(5_000);
  });

  it('excludes a reversed charge, like the snapshot breakdown does', () => {
    const series = seriesOf([
      statement({
        date: '2026-03-05',
        opening: 0,
        transactions: [
          txn({ post: '2026-03-10', description: 'ODEL - COLOMBO', amount: 15_000 }),
          txn({ post: '2026-03-12', description: 'ODEL - COLOMBO', amount: -15_000 }),
          txn({ post: '2026-03-15', description: 'CEYPETCO FUEL', amount: 20_000 }),
        ],
      }),
    ]);

    // The reversed ODEL purchase never happened, so only fuel is left.
    expect(series.monthlyTotal).toEqual([20_000]);
    expect(series.series.find((s) => s.category === 'fuel')?.total).toBe(20_000);
    expect(series.series.find((s) => s.category === 'furniture & appliances')).toBeUndefined();
  });
});
