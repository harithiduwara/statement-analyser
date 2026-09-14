import { type Money, type Statement, type TxnClass } from '@/domain/types';
import { roundMoney } from '@/lib/money';
import type { ReversalAnalysis } from './reversals';

/**
 * Charge decomposition per cycle: instalments, everyday spending, and the
 * cost of holding the card.
 *
 * Reversed originations are excluded, not netted: an origination and its
 * reversal cancel, so including both would inflate "everyday" by the purchase
 * value and then subtract it again somewhere else.
 */

export type ChargeBucket = 'instalments' | 'everyday' | 'feesAndInterest';

const BUCKET_OF: Partial<Record<TxnClass, ChargeBucket>> = {
  installment_repayment: 'instalments',
  installment_processing_fee: 'instalments',
  interest: 'feesAndInterest',
  annual_fee: 'feesAndInterest',
  stamp_duty: 'feesAndInterest',
  fuel_surcharge: 'feesAndInterest',
  purchase: 'everyday',
  installment_origination: 'everyday',
};

export interface CycleDecomposition {
  statementId: string;
  issuer: string;
  accountMask: string;
  statementDate: string;
  instalments: Money;
  everyday: Money;
  feesAndInterest: Money;
  /** The three buckets summed -- charges with reversals already removed. */
  trueCharges: Money;
  /** Charges as printed, before reversals are removed. */
  grossCharges: Money;
  payments: Money;
}

export function decomposeCycles(
  statements: readonly Statement[],
  reversals: ReversalAnalysis,
): CycleDecomposition[] {
  return [...statements]
    .sort((a, b) => a.statementDate.localeCompare(b.statementDate))
    .map((statement) => {
      let instalments = 0;
      let everyday = 0;
      let feesAndInterest = 0;

      for (const txn of statement.transactions) {
        if (txn.amount <= 0) continue;
        // A debit that was reversed never really happened.
        if (reversals.byTxnId.has(txn.id)) continue;
        const bucket = BUCKET_OF[txn.classification] ?? 'everyday';
        if (bucket === 'instalments') instalments += txn.amount;
        else if (bucket === 'feesAndInterest') feesAndInterest += txn.amount;
        else everyday += txn.amount;
      }

      return {
        statementId: statement.id,
        issuer: statement.issuer,
        accountMask: statement.accountMask,
        statementDate: statement.statementDate,
        instalments: roundMoney(instalments),
        everyday: roundMoney(everyday),
        feesAndInterest: roundMoney(feesAndInterest),
        trueCharges: roundMoney(instalments + everyday + feesAndInterest),
        grossCharges: statement.charges,
        payments: statement.payments,
      };
    });
}
