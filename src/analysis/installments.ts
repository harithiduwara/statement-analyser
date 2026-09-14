import type { Money, Statement, Txn } from '@/domain/types';
import { addMonths, monthKey } from '@/lib/dates';
import { roundMoney } from '@/lib/money';
import { merchantsMatch, normaliseMerchant } from './merchant';
import type { ReversalAnalysis } from './reversals';

/**
 * Cross-statement instalment register.
 *
 * Keyed by normalised merchant plus term count, because that pair is what
 * stays constant across cycles while the schedule position advances. The same
 * merchant financing two purchases over different terms is two plans; over
 * the same term it is one, and the register keeps them separate by default
 * rather than silently merging what might be two.
 */

export interface InstallmentPlan {
  id: string;
  issuer: string;
  merchant: string;
  /** The issuer's own plan identifier, where it prints one. */
  planCode?: string;
  /** Repayment plus the recurring processing fee -- the real monthly cost. */
  monthly: Money;
  /** The repayment component alone. */
  monthlyRepayment: Money;
  /** The recurring fee component, zero when the plan carries none. */
  monthlyFee: Money;
  termCount: number;
  latestInstallment: number;
  remaining: number;
  remainingValue: Money;
  /** From the origination transaction, when one was observed. */
  originalPrincipal?: Money;
  /** The transaction that originated this plan, when it was observed. */
  originationTxnId?: string;
  totalPayable: Money;
  /** totalPayable / originalPrincipal - 1. Undefined when unobservable. */
  costOfCredit?: number;
  /** Absolute financing cost, when the principal was observed. */
  financingCost?: Money;
  /** `YYYY-MM` of the final scheduled payment. */
  finalPaymentMonth: string;
  /** Month the latest observed instalment fell in. */
  latestMonth: string;
  predecessorId?: string;
  /** Transactions that fed this plan, for the drill-down. */
  txnIds: string[];
}

export interface InstallmentRegister {
  plans: InstallmentPlan[];
  /** monthly summed across every live plan. */
  monthlyObligation: Money;
  /** remainingValue summed across every live plan. */
  totalRemaining: Money;
  /** Plans whose principal was observed and priced at exactly 0%. */
  zeroCostCount: number;
  /** Plans whose principal was observed at all. */
  pricedCount: number;
  totalFinancingCost: Money;
}

interface Draft {
  key: string;
  issuer: string;
  merchant: string;
  /** Issuer's own plan identifier, when the statement prints one. */
  planCode?: string;
  termCount: number;
  repayments: Map<number, Money>;
  fees: Map<number, Money>;
  latestSeq: number;
  latestDate: string;
  txnIds: string[];
}

export function buildInstallmentRegister(
  statements: readonly Statement[],
  reversals?: ReversalAnalysis,
): InstallmentRegister {
  const drafts = new Map<string, Draft>();

  for (const statement of statements) {
    for (const txn of statement.transactions) {
      if (
        txn.classification !== 'installment_repayment' &&
        txn.classification !== 'installment_processing_fee'
      ) {
        continue;
      }
      const term = txn.installmentTerm;
      const seq = txn.installmentSeq;
      if (term === undefined || seq === undefined) continue;

      /*
       * Key on the issuer's own plan identifier when there is one. Seylan
       * prints `SP 010 of 036` on both the repayment and its processing fee,
       * which is definitive; falling back to the merchant name would split
       * them, because the fee line names no merchant at all -- every word in
       * `EASY PAY PROCESSING FEE` is a programme word, not an identity.
       *
       * Sampath prints no such code, and there the fee line does repeat the
       * merchant, so merchant plus term is the right key.
       */
      const merchant = normaliseMerchant(txn.description);
      const planCode = txn.installmentPlanId;
      const key = planCode ?? `${statement.issuer}:${merchant}:${term}`;
      const draft = drafts.get(key) ?? {
        key,
        issuer: statement.issuer,
        merchant: displayMerchant(txn.description),
        ...(planCode === undefined ? {} : { planCode }),
        termCount: term,
        repayments: new Map<number, Money>(),
        fees: new Map<number, Money>(),
        latestSeq: 0,
        latestDate: statement.statementDate,
        txnIds: [],
      };

      // Keyed by sequence so re-uploading a cycle cannot inflate the schedule.
      if (txn.classification === 'installment_repayment') {
        draft.repayments.set(seq, txn.amount);
        // The repayment line carries the better label; a fee line is mostly
        // programme wording and would make a poor name for the plan.
        draft.merchant = displayMerchant(txn.description);
      } else {
        draft.fees.set(seq, txn.amount);
      }

      draft.txnIds.push(txn.id);
      if (seq >= draft.latestSeq) {
        draft.latestSeq = seq;
        draft.latestDate = statement.statementDate;
      }
      drafts.set(key, draft);
    }
  }

  // Built once rather than per plan: which transactions belong to which
  // issuer does not change between plans, and rebuilding it per plan made
  // the register quadratic in the size of the loaded set.
  const idsByIssuer = groupTxnIdsByIssuer(statements);
  const plans = [...drafts.values()].map((draft) => finalisePlan(draft, idsByIssuer, reversals));
  linkRestructures(plans);

  const live = plans.filter((p) => p.remaining > 0);
  const priced = plans.filter((p) => p.costOfCredit !== undefined);

  return {
    plans: plans.sort((a, b) => b.remainingValue - a.remainingValue),
    monthlyObligation: roundMoney(live.reduce((acc, p) => acc + p.monthly, 0)),
    totalRemaining: roundMoney(live.reduce((acc, p) => acc + p.remainingValue, 0)),
    zeroCostCount: priced.filter((p) => Math.abs(p.costOfCredit!) < 1e-6).length,
    pricedCount: priced.length,
    totalFinancingCost: roundMoney(
      plans.reduce((acc, p) => acc + (p.financingCost ?? 0), 0),
    ),
  };
}

function groupTxnIdsByIssuer(statements: readonly Statement[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const statement of statements) {
    const set = map.get(statement.issuer) ?? new Set<string>();
    for (const txn of statement.transactions) set.add(txn.id);
    map.set(statement.issuer, set);
  }
  return map;
}

function finalisePlan(
  draft: Draft,
  idsByIssuer: ReadonlyMap<string, Set<string>>,
  reversals: ReversalAnalysis | undefined,
): InstallmentPlan {
  // Take the most recent observation of each component rather than an average:
  // a plan's instalment is a fixed contractual amount, so a differing earlier
  // figure means a restructure, not noise to be smoothed.
  const monthlyRepayment = latestValue(draft.repayments) ?? 0;
  const monthlyFee = latestValue(draft.fees) ?? 0;
  const monthly = roundMoney(monthlyRepayment + monthlyFee);
  const remaining = Math.max(0, draft.termCount - draft.latestSeq);
  const totalPayable = roundMoney(monthly * draft.termCount);

  const origination = findOrigination(draft, idsByIssuer, reversals);
  const rawPrincipal = origination?.amount;
  const rawCost =
    rawPrincipal !== undefined && rawPrincipal > 0
      ? totalPayable / rawPrincipal - 1
      : undefined;

  /*
   * A negative cost of credit is impossible: financing never makes the total
   * repaid less than the principal. When it comes out negative the matched
   * origination does not belong to this schedule -- the usual cause is a plan
   * the issuer splits across two instalment lines (so `monthly` captures only
   * one part), or a fuzzy merchant match that picked a larger, unrelated
   * origination. Either way the derived cost is not a fact, so the principal
   * and cost are withheld rather than a nonsensical figure presented. A small
   * negative from rounding is tolerated and clamped to zero.
   */
  const reliable = rawCost === undefined || rawCost >= -0.005;
  const originalPrincipal = reliable ? rawPrincipal : undefined;
  const costOfCredit =
    rawCost === undefined ? undefined : reliable ? Math.max(0, rawCost) : undefined;

  const latestMonth = monthKey(draft.latestDate);

  return {
    id: draft.key,
    issuer: draft.issuer,
    merchant: draft.merchant,
    ...(draft.planCode === undefined ? {} : { planCode: draft.planCode }),
    monthly,
    monthlyRepayment,
    monthlyFee,
    termCount: draft.termCount,
    latestInstallment: draft.latestSeq,
    remaining,
    remainingValue: roundMoney(monthly * remaining),
    ...(origination === undefined
      ? {}
      : { originalPrincipal: origination.amount, originationTxnId: origination.txnId }),
    totalPayable,
    ...(costOfCredit === undefined
      ? {}
      : {
          costOfCredit,
          financingCost: roundMoney(totalPayable - (originalPrincipal ?? 0)),
        }),
    finalPaymentMonth: addMonths(latestMonth, remaining),
    latestMonth,
    txnIds: draft.txnIds,
  };
}

/**
 * The principal is only known when the origination was actually observed --
 * a purchase that was reversed and re-booked as this plan.
 *
 * When the plan predates the earliest loaded statement there is no principal,
 * and cost of credit is left undefined so the UI can render "n/a". Deriving a
 * principal from the schedule and then presenting the resulting cost as fact
 * would be circular: it would report whatever rate was assumed.
 */
function findOrigination(
  draft: Draft,
  idsByIssuer: ReadonlyMap<string, Set<string>>,
  reversals: ReversalAnalysis | undefined,
): { amount: Money; txnId: string } | undefined {
  if (!reversals) return undefined;

  // The reversal analysis and the register must have been built from the same
  // statement objects, which is what `buildPortfolio` guarantees; the id set
  // is how an origination is tied back to its issuer.
  const sameIssuerIds = idsByIssuer.get(draft.issuer) ?? new Set<string>();

  for (const match of reversals.matches) {
    if (!sameIssuerIds.has(match.origination.id)) continue;
    if (!merchantsMatch(match.origination.description, draft.merchant)) continue;
    return { amount: roundMoney(match.origination.amount), txnId: match.origination.id };
  }
  return undefined;
}

/**
 * Link a plan that replaced another: an existing plan is settled early and
 * re-originated under a longer term. Without the link the predecessor's
 * remaining value and the successor's would both be counted.
 */
function linkRestructures(plans: InstallmentPlan[]): void {
  for (const plan of plans) {
    if (plan.remaining > 0) continue; // only a completed plan can be a predecessor
    const successor = plans.find(
      (p) =>
        p !== plan &&
        p.issuer === plan.issuer &&
        p.termCount !== plan.termCount &&
        p.remaining > 0 &&
        merchantsMatch(p.merchant, plan.merchant) &&
        p.latestMonth >= plan.latestMonth,
    );
    if (successor) successor.predecessorId = plan.id;
  }
}

function latestValue(map: ReadonlyMap<number, Money>): Money | undefined {
  let bestSeq = -1;
  let best: Money | undefined;
  for (const [seq, value] of map) {
    if (seq > bestSeq) {
      bestSeq = seq;
      best = value;
    }
  }
  return best;
}

/** A readable merchant name: the description with the schedule marker removed. */
function displayMerchant(description: string): string {
  return description
    .replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g, '')
    .replace(/\bSP\s*\d{1,3}\s*of\s*\d{1,3}\b/gi, '')
    .replace(/\b(INSTAL?L?MENT\s+)?(REPAYMENT|PROCESSING\s+FEES?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s-]+$/, '')
    .trim();
}

/** Plans a transaction belongs to, for the transaction drill-down. */
export function planForTxn(
  register: InstallmentRegister,
  txn: Txn,
): InstallmentPlan | undefined {
  return register.plans.find((p) => p.txnIds.includes(txn.id));
}
