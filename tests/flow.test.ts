import { describe, expect, it } from 'vitest';
import { statement, txn } from './helpers/build';
import { analyseReversals } from '@/analysis/reversals';
import { decomposeCycles } from '@/analysis/decomposition';
import { monthlyFlow } from '@/analysis/flow';

function flowOf(statements: ReturnType<typeof statement>[]) {
  const reversals = analyseReversals(statements);
  return monthlyFlow(statements, decomposeCycles(statements, reversals));
}

describe('monthlyFlow', () => {
  it('reports payments in and spending out for each month', () => {
    const jan = statement({
      date: '2026-01-05',
      opening: 0,
      transactions: [
        txn({ post: '2026-01-10', description: 'ODEL - COLOMBO', amount: 20_000 }),
        txn({ post: '2026-01-20', description: 'PAYMENT - THANK YOU', amount: -15_000 }),
      ],
    });
    const flow = flowOf([jan]);
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({
      month: '2026-01',
      moneyOut: 20_000,
      moneyIn: 15_000,
      net: -5_000, // spent 5,000 more than paid: the balance grew
    });
  });

  it('does not inflate the month with a reversed-and-rebooked purchase', () => {
    const feb = statement({
      date: '2026-02-05',
      opening: 0,
      transactions: [
        txn({ post: '2026-02-10', description: 'ACME - GALLE', amount: 200_000 }),
        txn({ post: '2026-02-11', description: 'ACME - GALLE', amount: -200_000 }),
        txn({ post: '2026-02-11', description: 'ACME - GALLE INSTALLMENT REPAYMENT 1/36', amount: 6_000 }),
        txn({ post: '2026-02-20', description: 'PAYMENT - THANK YOU', amount: -6_000 }),
      ],
    });
    const flow = flowOf([feb]);
    // out is the 6,000 repayment only -- the origination was reversed out;
    // in is the 6,000 payment, never the 200,000 reversal credit.
    expect(flow[0]!.moneyOut).toBe(6_000);
    expect(flow[0]!.moneyIn).toBe(6_000);
    expect(flow[0]!.net).toBe(0);
  });

  it('sums several cards within the same calendar month and orders months', () => {
    const feb = statement({
      date: '2026-02-05',
      opening: 0,
      transactions: [txn({ post: '2026-02-10', description: 'KEELLS - COLOMBO', amount: 5_000 })],
    });
    const janA = statement({
      issuer: 'seylan',
      mask: '1111',
      date: '2026-01-05',
      opening: 0,
      transactions: [txn({ post: '2026-01-10', description: 'KEELLS', amount: 10_000 })],
    });
    const janB = statement({
      issuer: 'sampath',
      mask: '2222',
      date: '2026-01-06',
      opening: 0,
      transactions: [txn({ post: '2026-01-11', description: 'ODEL', amount: 3_000 })],
    });
    const flow = flowOf([feb, janA, janB]);
    expect(flow.map((f) => f.month)).toEqual(['2026-01', '2026-02']);
    expect(flow[0]!.moneyOut).toBe(13_000); // 10,000 + 3,000 across two cards
  });
});
