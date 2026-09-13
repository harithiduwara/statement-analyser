import {
  MONEY_EPSILON,
  type Money,
  type Reconciliation,
  type Statement,
} from '@/domain/types';
import { moneyEquals, roundMoney, sumMoney } from '@/lib/money';

/**
 * The reconciliation invariant:
 *
 *     opening + charges - payments = closing
 *
 * `charges` and `payments` are printed magnitudes (both positive), matching
 * how the statement itself states the identity. The closing balance is always
 * the printed one -- it is never replaced with a computed figure, because the
 * whole point of the check is to compare the two.
 *
 * A statement that fails this must be surfaced, not smoothed over. Everything
 * downstream reads `passes` and refuses to fold a failing cycle into an
 * aggregate silently.
 */
export function reconcile(statement: Statement): Reconciliation {
  const computedClosing = roundMoney(
    statement.openingBalance + statement.charges - statement.payments,
  );
  const delta = roundMoney(computedClosing - statement.closingBalance);
  const passes = Math.abs(delta) < MONEY_EPSILON;

  const transactionSum = sumMoney(statement.transactions.map((t) => t.amount));
  const headerMovement = roundMoney(statement.charges - statement.payments);
  const transactionsMatchHeader = moneyEquals(transactionSum, headerMovement);

  const hint = passes
    ? undefined
    : diagnose(delta, statement, transactionSum, headerMovement);

  return {
    statementId: statement.id,
    opening: statement.openingBalance,
    charges: statement.charges,
    payments: statement.payments,
    computedClosing,
    printedClosing: statement.closingBalance,
    delta,
    passes,
    transactionSum,
    transactionsMatchHeader,
    ...(hint === undefined ? {} : { hint }),
  };
}

/**
 * Name the likely cause of a failure rather than only reporting a number.
 * Every branch here describes a real way statement totals are laid out; none
 * of them changes the figures, they only explain the delta.
 */
function diagnose(
  delta: Money,
  statement: Statement,
  transactionSum: Money,
  headerMovement: Money,
): string {
  const { financeCharge } = statement;

  if (financeCharge !== 0 && moneyEquals(delta, -financeCharge)) {
    return (
      `The shortfall equals the finance charge exactly (${fmt(financeCharge)}), which means ` +
      `this issuer prints the finance charge outside its "new charges" total. ` +
      `The parser must add it in rather than the reconciler ignoring the gap.`
    );
  }
  if (financeCharge !== 0 && moneyEquals(delta, financeCharge)) {
    return (
      `The excess equals the finance charge exactly (${fmt(financeCharge)}), which means ` +
      `it has been counted twice -- once inside the charges total and once again separately.`
    );
  }
  if (moneyEquals(delta, 2 * statement.payments)) {
    return `The delta is exactly twice the payments total, which is the signature of a sign error on the credit column.`;
  }
  if (!moneyEquals(transactionSum, headerMovement)) {
    return (
      `The header totals and the transaction lines disagree: lines sum to ${fmt(transactionSum)} ` +
      `but the header implies ${fmt(headerMovement)}. Some rows were missed or misread.`
    );
  }
  return `Opening + charges - payments comes to ${fmt(
    roundMoney(statement.openingBalance + statement.charges - statement.payments),
  )}, but the statement prints ${fmt(statement.closingBalance)}.`;
}

function fmt(value: Money): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Reconcile a set of statements, preserving input order. */
export function reconcileAll(statements: readonly Statement[]): Reconciliation[] {
  return statements.map(reconcile);
}

export interface ReconciliationSummary {
  total: number;
  passed: number;
  failed: Reconciliation[];
  /** Cycles whose header totals reconcile but whose line items do not. */
  lineItemMismatches: Reconciliation[];
}

export function summariseReconciliation(
  results: readonly Reconciliation[],
): ReconciliationSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.passes).length,
    failed: results.filter((r) => !r.passes),
    lineItemMismatches: results.filter((r) => r.passes && !r.transactionsMatchHeader),
  };
}
