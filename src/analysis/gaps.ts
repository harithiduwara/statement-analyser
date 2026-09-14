import type { Issuer, Money, Statement } from '@/domain/types';
import { daysBetween } from '@/lib/dates';
import { moneyEquals, roundMoney } from '@/lib/money';

/**
 * Balance-chain gap detection.
 *
 * Consecutive cycles must chain: `closing[i] === opening[i+1]`. A break means
 * a statement is missing, and the break itself says exactly how much movement
 * is unaccounted for.
 *
 * Nothing is renumbered or interpolated. The missing cycle's window and its
 * implied net movement are reported as facts, and every total that spans the
 * gap is marked as spanning it -- filenames are not evidence of completeness,
 * the balance chain is.
 */

export interface CycleLink {
  issuer: Issuer;
  accountMask: string;
  previous: Statement;
  next: Statement;
  /** Days between the two statement dates. */
  gapDays: number;
  chains: boolean;
  /** opening[i+1] - closing[i]; the movement the missing cycle must explain. */
  impliedMovement: Money;
}

export interface ChainGap extends CycleLink {
  chains: false;
  /** Inclusive window the missing statement(s) must cover. */
  windowFrom: string;
  windowTo: string;
  /** Estimated count of missing cycles, from the day gap. */
  estimatedMissingCycles: number;
}

export interface ChainAnalysis {
  links: CycleLink[];
  gaps: ChainGap[];
  /** Chains that are complete, keyed `issuer:mask`. */
  completeChains: string[];
  incompleteChains: string[];
}

export function analyseChain(statements: readonly Statement[]): ChainAnalysis {
  const groups = new Map<string, Statement[]>();
  for (const s of statements) {
    const key = `${s.issuer}:${s.accountMask}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const links: CycleLink[] = [];
  const gaps: ChainGap[] = [];
  const completeChains: string[] = [];
  const incompleteChains: string[] = [];

  for (const [key, group] of groups) {
    // Ordered by parsed date, never by filename or an assumed cycle day.
    const ordered = [...group].sort((a, b) => a.statementDate.localeCompare(b.statementDate));
    let broken = false;

    for (let i = 0; i < ordered.length - 1; i += 1) {
      const previous = ordered[i]!;
      const next = ordered[i + 1]!;
      const chains = moneyEquals(previous.closingBalance, next.openingBalance);
      const gapDays = daysBetween(previous.statementDate, next.statementDate);
      const link: CycleLink = {
        issuer: previous.issuer,
        accountMask: previous.accountMask,
        previous,
        next,
        gapDays,
        chains,
        impliedMovement: roundMoney(next.openingBalance - previous.closingBalance),
      };
      links.push(link);

      if (!chains) {
        broken = true;
        gaps.push({
          ...link,
          chains: false,
          windowFrom: previous.statementDate,
          windowTo: next.statementDate,
          // Cycle length drifts by a day or three, so round rather than divide.
          estimatedMissingCycles: Math.max(1, Math.round(gapDays / 30) - 1),
        });
      }
    }

    (broken ? incompleteChains : completeChains).push(key);
  }

  return { links, gaps, completeChains, incompleteChains };
}
