import { describe, expect, it } from 'vitest';
import { statement, txn } from './helpers/build';
import { buildPortfolio } from '@/analysis/portfolio';
import { buildTimeline } from '@/analysis/timeline';

const timelineOf = (statements: ReturnType<typeof statement>[]) =>
  buildTimeline(buildPortfolio(statements));

describe('buildTimeline', () => {
  it('is empty when nothing is loaded', () => {
    expect(timelineOf([])).toEqual([]);
  });

  it('records the statement, the payments, and the single largest purchase', () => {
    const tl = timelineOf([
      statement({
        date: '2026-01-05',
        opening: 0,
        transactions: [
          txn({ post: '2026-01-08', description: 'KEELLS - COLOMBO', amount: 5_000 }),
          txn({ post: '2026-01-12', description: 'SINGER - KANDY', amount: 80_000 }),
          txn({ post: '2026-01-20', description: 'PAYMENT - THANK YOU', amount: -30_000 }),
        ],
      }),
    ]);

    const stmt = tl.find((e) => e.kind === 'statement');
    expect(stmt?.balance).toBe(55_000); // 0 + 85,000 - 30,000

    const pay = tl.find((e) => e.kind === 'payment');
    expect(pay?.amount).toBe(-30_000); // negative = money in

    // Only the biggest purchase of the cycle is on the timeline, not every row.
    const charges = tl.filter((e) => e.kind === 'charge');
    expect(charges).toHaveLength(1);
    expect(charges[0]!.title).toContain('SINGER');
    expect(charges[0]!.amount).toBe(80_000);

    // Events come back in ascending date order.
    const dates = tl.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('tells a financed purchase as a plan starting, not as a bare reversal', () => {
    const tl = timelineOf([
      statement({
        date: '2026-02-05',
        opening: 0,
        transactions: [
          txn({ post: '2026-02-10', description: 'ACME - GALLE', amount: 200_000 }),
          txn({ post: '2026-02-11', description: 'ACME - GALLE', amount: -200_000 }),
          txn({
            post: '2026-02-11',
            description: 'ACME - GALLE INSTALLMENT REPAYMENT 1/36',
            amount: 6_000,
          }),
        ],
      }),
    ]);

    const start = tl.find((e) => e.kind === 'plan-start');
    expect(start?.date).toBe('2026-02-10'); // the origination's post date
    expect(start?.amount).toBe(200_000);

    const end = tl.find((e) => e.kind === 'plan-end');
    expect(end?.future).toBe(true); // a 36-month plan opened this cycle retires years out

    // The origination's reversal is represented by the plan, not duplicated.
    expect(tl.filter((e) => e.kind === 'reversal')).toHaveLength(0);
  });

  it('surfaces a genuine reversal, and never counts the reversed charge as the biggest', () => {
    const tl = timelineOf([
      statement({
        date: '2026-03-05',
        opening: 0,
        transactions: [
          txn({ post: '2026-03-10', description: 'ODEL - COLOMBO', amount: 15_000 }),
          txn({ post: '2026-03-12', description: 'ODEL - COLOMBO', amount: -15_000 }),
        ],
      }),
    ]);

    const rev = tl.find((e) => e.kind === 'reversal');
    expect(rev?.date).toBe('2026-03-12'); // the credit's post date
    expect(rev?.amount).toBe(-15_000);
    expect(tl.find((e) => e.kind === 'charge')).toBeUndefined();
  });

  it('places a flagged cycle on the date of the statement it refers to', () => {
    const tl = timelineOf([
      statement({
        date: '2026-04-05',
        opening: 0,
        transactions: [txn({ post: '2026-04-10', description: 'KEELLS', amount: 10_000 })],
        closingOverride: 999_999, // break opening + charges - payments = closing
      }),
    ]);

    const anomaly = tl.find((e) => e.kind === 'anomaly');
    expect(anomaly?.severity).toBe('critical');
    expect(anomaly?.date).toBe('2026-04-05');
  });
});
