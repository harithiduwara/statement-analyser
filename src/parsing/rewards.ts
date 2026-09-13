import { POINTS_EPSILON, type RewardsBlock } from '@/domain/types';

/**
 * Rewards-block solver.
 *
 * The block's values do not reliably extract in the same column order as its
 * labels. What can be trusted is the identity the bank's own arithmetic must
 * satisfy:
 *
 *     opening + accumulated - redeemed - adjusted = balance
 *
 * The identity is symmetric within two pairs: swapping `opening` with
 * `accumulated` leaves it true, as does swapping `redeemed` with `adjusted`.
 * So it can prove which value is the balance and which two are added versus
 * subtracted, but not the order inside either pair.
 *
 * That matters, because the obvious tie-breaker is unusable. If the labels
 * had lined up with the values, the positional reading would already have
 * satisfied the identity; the only reason to be solving at all is that it did
 * not, which means the labels are known to be mis-aligned and cannot be
 * trusted to order a pair either. So:
 *
 *   - positional reading satisfies the identity  -> take it, roles are known
 *   - it does not, but one grouping satisfies it -> report the pairs as
 *     pairs, leave the roles unset, and say so
 *   - nothing satisfies it                       -> `unreconciled`
 *
 * A pair left open can still be resolved later without guessing: the previous
 * cycle's closing points balance is this cycle's opening balance, so
 * `resolveWithPriorBalance` finishes the job once a second statement is
 * loaded.
 */

export type RewardsRole = 'opening' | 'accumulated' | 'redeemed' | 'adjusted' | 'balance';

export interface RewardsSolveInput {
  /** Numbers extracted from the block, in column order. */
  values: readonly number[];
  /**
   * Role implied for each value by its column's label. Same length as
   * `values`; entries may be undefined where a label was unreadable.
   */
  positionalRoles?: readonly (RewardsRole | undefined)[];
  /** `Rewards Points Balance` from the header grid, when it was read. */
  anchorBalance?: number;
}

interface Grouping {
  balance: number;
  additive: [number, number];
  subtractive: [number, number];
}

function identityHolds(g: Grouping): boolean {
  const lhs = g.additive[0] + g.additive[1] - g.subtractive[0] - g.subtractive[1];
  return Math.abs(lhs - g.balance) < POINTS_EPSILON;
}

/** Every way to pick the balance and split the remaining four into two pairs. */
function groupings(values: readonly number[]): Grouping[] {
  const out: Grouping[] = [];
  for (let b = 0; b < values.length; b += 1) {
    const rest = values.filter((_, i) => i !== b);
    for (let i = 0; i < rest.length; i += 1) {
      for (let j = i + 1; j < rest.length; j += 1) {
        out.push({
          balance: values[b]!,
          additive: [rest[i]!, rest[j]!],
          subtractive: rest.filter((_, k) => k !== i && k !== j) as [number, number],
        });
      }
    }
  }
  return out;
}

const UNREADABLE = (values: number[]): RewardsBlock => ({
  reconciled: false,
  observed: values,
});

export function solveRewards(input: RewardsSolveInput): RewardsBlock {
  const values = [...input.values];
  if (values.length !== 5) return UNREADABLE(values);

  // 1. Does the block read correctly straight off its labels?
  const positional = assignmentFromRoles(values, input.positionalRoles);
  if (positional && identityHolds(positional) && anchorAgrees(positional, input.anchorBalance)) {
    return {
      opening: positional.additive[0],
      accumulated: positional.additive[1],
      redeemed: positional.subtractive[0],
      adjusted: positional.subtractive[1],
      balance: positional.balance,
      reconciled: true,
      observed: values,
      method: 'labels',
    };
  }

  // 2. Labels are mis-aligned. Let the identity decide the groups.
  let viable = groupings(values).filter(identityHolds);
  if (input.anchorBalance !== undefined) {
    const anchored = viable.filter((g) => Math.abs(g.balance - input.anchorBalance!) < POINTS_EPSILON);
    // Narrow by the anchor only when it agrees with something; a header that
    // contradicts the table is itself a finding, not a reason to discard the table.
    if (anchored.length > 0) viable = anchored;
  }

  const distinct = dedupeGroupings(viable);
  if (distinct.length !== 1) return UNREADABLE(values);

  const g = distinct[0]!;
  return {
    balance: g.balance,
    additivePair: sortPair(g.additive),
    subtractivePair: sortPair(g.subtractive),
    reconciled: true,
    observed: values,
    method: 'identity',
  };
}

/**
 * Close an open pair using the previous cycle's closing points balance, which
 * is by definition this cycle's opening balance. Returns the block unchanged
 * when the prior balance does not match either member -- a near miss is a
 * finding, not a licence to pick the closer one.
 */
export function resolveWithPriorBalance(
  block: RewardsBlock,
  priorBalance: number,
): RewardsBlock {
  if (!block.reconciled || !block.additivePair) return block;

  const [a, b] = block.additivePair;
  const matchesA = Math.abs(a - priorBalance) < POINTS_EPSILON;
  const matchesB = Math.abs(b - priorBalance) < POINTS_EPSILON;
  if (matchesA === matchesB) return block; // neither, or ambiguous because a === b

  const { additivePair: _dropped, ...rest } = block;
  return {
    ...rest,
    opening: matchesA ? a : b,
    accumulated: matchesA ? b : a,
    method: 'identity+prior',
  };
}

function anchorAgrees(g: Grouping, anchor: number | undefined): boolean {
  return anchor === undefined || Math.abs(g.balance - anchor) < POINTS_EPSILON;
}

function assignmentFromRoles(
  values: readonly number[],
  roles: readonly (RewardsRole | undefined)[] | undefined,
): Grouping | undefined {
  if (!roles || roles.length !== values.length) return undefined;

  const byRole = new Map<RewardsRole, number>();
  roles.forEach((role, i) => {
    if (role !== undefined && !byRole.has(role)) byRole.set(role, values[i]!);
  });

  const opening = byRole.get('opening');
  const accumulated = byRole.get('accumulated');
  const redeemed = byRole.get('redeemed');
  const adjusted = byRole.get('adjusted');
  const balance = byRole.get('balance');
  if (
    opening === undefined ||
    accumulated === undefined ||
    redeemed === undefined ||
    adjusted === undefined ||
    balance === undefined
  ) {
    return undefined;
  }
  return { balance, additive: [opening, accumulated], subtractive: [redeemed, adjusted] };
}

function sortPair(pair: [number, number]): [number, number] {
  return pair[0] <= pair[1] ? pair : [pair[1], pair[0]];
}

function dedupeGroupings(list: readonly Grouping[]): Grouping[] {
  const seen = new Map<string, Grouping>();
  for (const g of list) {
    const key = `${g.balance}|${sortPair(g.additive).join(',')}|${sortPair(g.subtractive).join(',')}`;
    if (!seen.has(key)) seen.set(key, g);
  }
  return [...seen.values()];
}
