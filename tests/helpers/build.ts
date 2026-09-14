import type { Statement, Txn, TxnClass } from '@/domain/types';
import { classifyTxn } from '@/parsing/classify';
import { roundMoney } from '@/lib/money';

/**
 * Statement builders for analysis tests.
 *
 * The analysis layer works on the domain model, not on PDFs, so these tests
 * construct statements directly. That keeps a parser change from silently
 * rewriting what the analytics tests actually assert.
 */

let counter = 0;

export interface TxnSpec {
  post: string;
  description: string;
  amount: number;
  txnDate?: string;
  classification?: TxnClass;
  cardMask?: string;
}

export function txn(spec: TxnSpec): Txn {
  const classification =
    spec.classification ??
    classifyTxn({ description: spec.description, amount: spec.amount }).className;
  const seq = classifyTxn({ description: spec.description, amount: spec.amount });
  return {
    id: `t${(counter += 1)}`,
    postDate: spec.post,
    txnDate: spec.txnDate ?? spec.post,
    description: spec.description,
    amount: spec.amount,
    classification,
    ...(spec.cardMask === undefined ? {} : { cardMask: spec.cardMask }),
    ...(seq.installmentSeq === undefined
      ? {}
      : { installmentSeq: seq.installmentSeq, installmentTerm: seq.installmentTerm }),
  };
}

export interface StatementSpec {
  issuer?: 'seylan' | 'sampath';
  mask?: string;
  date: string;
  opening: number;
  transactions: Txn[];
  /** Override the printed closing balance, to model a broken cycle. */
  closingOverride?: number;
  /** Model a statement that was read off a scan rather than a text layer. */
  source?: 'text' | 'ocr';
  ocrConfidence?: number;
}

/**
 * Build a statement whose header totals are derived from its transactions, so
 * every fixture reconciles unless it is deliberately broken.
 */
export function statement(spec: StatementSpec): Statement {
  const issuer = spec.issuer ?? 'seylan';
  const mask = spec.mask ?? '2470';
  const charges = roundMoney(
    spec.transactions.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0),
  );
  const payments = roundMoney(
    Math.abs(spec.transactions.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0)),
  );
  const closing = roundMoney(spec.opening + charges - payments);

  return {
    id: `${issuer}:${mask}:${spec.date}`,
    issuer,
    accountMask: mask,
    statementDate: spec.date,
    paymentDueDate: spec.date,
    creditLimit: 500_000,
    interestRateAnnual: 0.28,
    openingBalance: spec.opening,
    charges,
    payments,
    financeCharge: 0,
    closingBalance: spec.closingOverride ?? closing,
    minimumPayment: roundMoney(closing * 0.05),
    transactions: spec.transactions,
    sourceFileName: `${issuer}-${spec.date}.pdf`,
    source: spec.source ?? 'text',
    ...(spec.ocrConfidence === undefined ? {} : { ocrConfidence: spec.ocrConfidence }),
    warnings: [],
  };
}
