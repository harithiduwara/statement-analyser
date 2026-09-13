import { describe, expect, it } from 'vitest';
import { resolveWithPriorBalance, solveRewards } from '@/parsing/rewards';

const VALUES = [5_000, 12_450, 3_820, 120, 11_150];
const MISALIGNED_ROLES = ['opening', 'accumulated', 'redeemed', 'adjusted', 'balance'] as const;

describe('solveRewards', () => {
  it('takes the labels when they already satisfy the identity', () => {
    const block = solveRewards({
      values: [12_450, 3_820, 5_000, 120, 11_150],
      positionalRoles: MISALIGNED_ROLES,
    });
    expect(block.reconciled).toBe(true);
    expect(block.method).toBe('labels');
    expect(block.opening).toBe(12_450);
    expect(block.accumulated).toBe(3_820);
    expect(block.redeemed).toBe(5_000);
    expect(block.adjusted).toBe(120);
    expect(block.balance).toBe(11_150);
  });

  it('falls back to the identity when the labels are mis-aligned', () => {
    const block = solveRewards({
      values: VALUES,
      positionalRoles: MISALIGNED_ROLES,
      anchorBalance: 11_150,
    });
    expect(block.reconciled).toBe(true);
    expect(block.method).toBe('identity');
    expect(block.balance).toBe(11_150);
    expect(block.additivePair).toEqual([3_820, 12_450]);
    expect(block.subtractivePair).toEqual([120, 5_000]);
    // Mis-aligned labels cannot order a pair, so the roles stay unset.
    expect(block.opening).toBeUndefined();
    expect(block.accumulated).toBeUndefined();
  });

  it('reports unreconciled when no assignment satisfies the identity', () => {
    const block = solveRewards({ values: [5_000, 12_450, 3_820, 121, 11_150] });
    expect(block.reconciled).toBe(false);
    expect(block.balance).toBeUndefined();
    expect(block.observed).toEqual([5_000, 12_450, 3_820, 121, 11_150]);
  });

  it('closes an open pair from the previous cycle closing balance', () => {
    const open = solveRewards({ values: VALUES, anchorBalance: 11_150 });
    expect(open.additivePair).toEqual([3_820, 12_450]);

    const closed = resolveWithPriorBalance(open, 12_450);
    expect(closed.opening).toBe(12_450);
    expect(closed.accumulated).toBe(3_820);
    expect(closed.additivePair).toBeUndefined();
    expect(closed.method).toBe('identity+prior');
  });

  it('leaves the pair open when the prior balance matches neither member', () => {
    const open = solveRewards({ values: VALUES, anchorBalance: 11_150 });
    const stillOpen = resolveWithPriorBalance(open, 9_999);
    expect(stillOpen.opening).toBeUndefined();
    expect(stillOpen.additivePair).toEqual([3_820, 12_450]);
  });
});
