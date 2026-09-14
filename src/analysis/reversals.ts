import { MONEY_EPSILON, type Money, type Statement, type Txn } from '@/domain/types';
import { daysBetween } from '@/lib/dates';
import { roundMoney, sumMoney } from '@/lib/money';
import { merchantSimilarity, MERCHANT_MATCH_THRESHOLD } from './merchant';

/**
 * Reversal matching -- the mechanic the rest of the analysis depends on.
 *
 * An instalment purchase is not booked as one line. The issuer posts the
 * purchase at full value, reverses it the next day, and re-books it as a
 * schedule:
 *
 *   15/03  DAMRO - KOTTAWA                        206,831.00   origination
 *   16/03  DAMRO - KOTTAWA                        206,831.00CR reversal
 *   16/03  DAMRO INSTALLMENT REPAYMENT 1/36         5,745.31   first instalment
 *   16/03  DAMRO INSTALLMENT PROCESSING FEES        1,654.65   recurring fee
 *
 * Counting gross debits therefore counts the purchase twice over -- once at
 * full value and again as the schedule -- while counting gross credits treats
 * the reversal as if the cardholder had paid it. Both errors are large: on a
 * book with several plans, gross debits can be double the real figure.
 *
 * So every credit is classified line by line as either a payment (the
 * cardholder settling the account) or a reversal (the bank undoing its own
 * debit), and `trueCharges = grossDebits - matchedReversals`.
 */

/** How far apart an origination and its reversal may post. */
const REVERSAL_WINDOW_DAYS = 7;

export interface ReversalMatch {
  origination: Txn;
  reversal: Txn;
  amount: Money;
  /** Days between the two postings. */
  gapDays: number;
  similarity: number;
}

export interface ReversalAnalysis {
  matches: ReversalMatch[];
  /** Gross debits, before any reversal is netted off. */
  grossDebits: Money;
  /** Gross credits, payments and reversals together. */
  grossCredits: Money;
  /** Credits proved to be reversals of an observed debit. */
  matchedReversals: Money;
  /** grossDebits - matchedReversals. The figure to use everywhere. */
  trueCharges: Money;
  /** Credits that settle the account: grossCredits - matchedReversals. */
  payments: Money;
  /**
   * Credits with no matching debit anywhere in the loaded set. Each is either
   * a statement we have not loaded, or a bank error. Neither is ignorable.
   */
  unmatchedCredits: Txn[];
  /** Transaction id -> the match it participates in. */
  byTxnId: Map<string, ReversalMatch>;
}

/** Classes that are never a reversal candidate, whatever the amounts say. */
const NEVER_REVERSAL = new Set([
  'payment',
  'installment_repayment',
  'installment_processing_fee',
]);

export function analyseReversals(statements: readonly Statement[]): ReversalAnalysis {
  const all = statements.flatMap((s) => s.transactions);
  const debits = all.filter((t) => t.amount > 0);
  const credits = all.filter((t) => t.amount < 0);

  const matches: ReversalMatch[] = [];
  const byTxnId = new Map<string, ReversalMatch>();
  const usedDebits = new Set<string>();

  // Work credits oldest first so an early reversal claims the debit it
  // actually belongs to rather than a later identical one.
  const orderedCredits = [...credits].sort((a, b) => a.postDate.localeCompare(b.postDate));

  for (const credit of orderedCredits) {
    if (credit.classification === 'payment') continue;

    const candidate = bestOriginationFor(credit, debits, usedDebits);
    if (!candidate) continue;

    const match: ReversalMatch = {
      origination: candidate.debit,
      reversal: credit,
      amount: roundMoney(Math.abs(credit.amount)),
      gapDays: daysBetween(candidate.debit.postDate, credit.postDate),
      similarity: candidate.similarity,
    };
    matches.push(match);
    usedDebits.add(candidate.debit.id);
    byTxnId.set(credit.id, match);
    byTxnId.set(candidate.debit.id, match);
  }

  const grossDebits = sumMoney(debits.map((t) => t.amount));
  const grossCredits = roundMoney(Math.abs(sumMoney(credits.map((t) => t.amount))));
  const matchedReversals = sumMoney(matches.map((m) => m.amount));

  /*
   * A credit is only "unexplained" when its class implies it should have
   * reversed a debit and none was found -- i.e. a generic `reversal`. The
   * other credit classes explain themselves: a payment settles the account,
   * and an interest reversal, fuel-surcharge reversal or cashback is a
   * standalone credit that never pairs with an origination. Flagging those as
   * "a credit with no matching debit" would cry wolf on every ordinary
   * surcharge refund and bury the real signal -- a purchase-shaped reversal
   * with no purchase behind it, the bank-error case.
   */
  const unmatchedCredits = credits.filter(
    (c) => c.classification === 'reversal' && !byTxnId.has(c.id),
  );

  return {
    matches,
    grossDebits,
    grossCredits,
    matchedReversals,
    trueCharges: roundMoney(grossDebits - matchedReversals),
    payments: roundMoney(grossCredits - matchedReversals),
    unmatchedCredits,
    byTxnId,
  };
}

function bestOriginationFor(
  credit: Txn,
  debits: readonly Txn[],
  used: ReadonlySet<string>,
): { debit: Txn; similarity: number } | undefined {
  const target = Math.abs(credit.amount);
  let best: { debit: Txn; similarity: number } | undefined;

  for (const debit of debits) {
    if (used.has(debit.id)) continue;
    if (NEVER_REVERSAL.has(debit.classification)) continue;
    if (Math.abs(debit.amount - target) > MONEY_EPSILON) continue;

    // The reversal follows the debit. A credit that predates it is something
    // else -- most often a refund for a purchase on an earlier statement.
    const gap = daysBetween(debit.postDate, credit.postDate);
    if (gap < 0 || gap > REVERSAL_WINDOW_DAYS) continue;

    const similarity = merchantSimilarity(debit.description, credit.description);
    if (similarity < MERCHANT_MATCH_THRESHOLD) continue;

    // Prefer the closest posting, then the strongest name match: an identical
    // amount repeated at the same merchant is common (a subscription), and
    // proximity is the better discriminator there.
    if (
      best === undefined ||
      gap < daysBetween(best.debit.postDate, credit.postDate) ||
      (gap === daysBetween(best.debit.postDate, credit.postDate) && similarity > best.similarity)
    ) {
      best = { debit, similarity };
    }
  }
  return best;
}

/**
 * The per-line split the brief calls for: every credit is a payment or a
 * reversal, and nothing is left in between.
 */
export function splitCredits(analysis: ReversalAnalysis, statements: readonly Statement[]) {
  const credits = statements.flatMap((s) => s.transactions).filter((t) => t.amount < 0);
  return {
    payments: credits.filter((t) => t.classification === 'payment'),
    reversals: credits.filter((t) => analysis.byTxnId.has(t.id)),
    unexplained: analysis.unmatchedCredits,
  };
}
