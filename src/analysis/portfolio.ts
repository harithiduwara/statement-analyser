import type { Issuer, Money, Reconciliation, Statement } from '@/domain/types';
import { roundMoney } from '@/lib/money';
import { reconcileAll, summariseReconciliation, type ReconciliationSummary } from './reconcile';
import { analyseReversals, type ReversalAnalysis } from './reversals';
import { buildInstallmentRegister, type InstallmentRegister } from './installments';
import { buildForwardSchedule, type ForwardSchedule } from './forward';
import { analyseChain, type ChainAnalysis } from './gaps';
import { decomposeCycles, type CycleDecomposition } from './decomposition';
import { detectAnomalies, type Anomaly } from './anomalies';

/**
 * The whole analysis, derived from the loaded statements in one pass.
 *
 * Assembled here rather than in components so every view reads the same
 * numbers. Order matters: reversals must be resolved before charges,
 * decomposition or the register can mean anything.
 */

export interface CardPosition {
  issuer: Issuer;
  accountMask: string;
  /** Closing balance of the most recent loaded cycle. */
  currentBalance: Money;
  creditLimit: Money;
  /** currentBalance / creditLimit, or undefined when no limit was read. */
  utilisation?: number;
  interestRateAnnual: number;
  latestStatementDate: string;
  paymentDueDate: string;
  minimumPayment: Money;
  cycleCount: number;
  /** True when this card's balance chain has a break. */
  hasGap: boolean;
}

export interface Portfolio {
  statements: Statement[];
  reconciliations: Reconciliation[];
  reconciliationSummary: ReconciliationSummary;
  reversals: ReversalAnalysis;
  register: InstallmentRegister;
  forward: ForwardSchedule;
  chain: ChainAnalysis;
  decomposition: CycleDecomposition[];
  anomalies: Anomaly[];
  positions: CardPosition[];

  /** Sum of the latest closing balance on every card. */
  statementBalance: Money;
  /**
   * Statement balance plus contracted instalments still to run. What is
   * actually owed, as opposed to what this month's statements happen to show.
   */
  trueObligation: Money;
  /** Mean charges per cycle, reversals removed -- what the card is used for, per month. */
  monthlyAverageSpend: Money;
  /** Mean instalment charges (repayment and processing fee) billed per cycle. */
  monthlyAverageInstallment: Money;
  isEmpty: boolean;
}

export function buildPortfolio(statements: readonly Statement[]): Portfolio {
  const ordered = [...statements].sort((a, b) =>
    a.statementDate.localeCompare(b.statementDate),
  );

  const reconciliations = reconcileAll(ordered);
  const reversals = analyseReversals(ordered);
  const register = buildInstallmentRegister(ordered, reversals);
  const forward = buildForwardSchedule(register);
  const chain = analyseChain(ordered);
  const decomposition = decomposeCycles(ordered, reversals);
  const anomalies = detectAnomalies({ statements: ordered, reconciliations, reversals, chain });
  const positions = buildPositions(ordered, chain);

  const statementBalance = roundMoney(
    positions.reduce((acc, p) => acc + p.currentBalance, 0),
  );

  const cycleCount = ordered.length;
  // Averaged from the per-cycle decomposition rather than the reversal totals
  // so spend and its instalment component share one denominator and one
  // reversal treatment -- the instalment average can never exceed spend.
  const mean = (pick: (d: CycleDecomposition) => Money): Money =>
    cycleCount === 0
      ? 0
      : roundMoney(decomposition.reduce((acc, d) => acc + pick(d), 0) / cycleCount);
  const monthlyAverageSpend = mean((d) => d.trueCharges);
  const monthlyAverageInstallment = mean((d) => d.instalments);

  return {
    statements: ordered,
    reconciliations,
    reconciliationSummary: summariseReconciliation(reconciliations),
    reversals,
    register,
    forward,
    chain,
    decomposition,
    anomalies,
    positions,
    statementBalance,
    trueObligation: roundMoney(statementBalance + register.totalRemaining),
    monthlyAverageSpend,
    monthlyAverageInstallment,
    isEmpty: ordered.length === 0,
  };
}

function buildPositions(
  statements: readonly Statement[],
  chain: ChainAnalysis,
): CardPosition[] {
  const byCard = new Map<string, Statement[]>();
  for (const s of statements) {
    const key = `${s.issuer}:${s.accountMask}`;
    byCard.set(key, [...(byCard.get(key) ?? []), s]);
  }

  const brokenChains = new Set(chain.incompleteChains);

  return [...byCard.entries()]
    .map(([key, group]) => {
      const ordered = [...group].sort((a, b) =>
        a.statementDate.localeCompare(b.statementDate),
      );
      const latest = ordered[ordered.length - 1]!;
      return {
        issuer: latest.issuer,
        accountMask: latest.accountMask,
        currentBalance: latest.closingBalance,
        creditLimit: latest.creditLimit,
        ...(latest.creditLimit > 0
          ? { utilisation: latest.closingBalance / latest.creditLimit }
          : {}),
        interestRateAnnual: latest.interestRateAnnual,
        latestStatementDate: latest.statementDate,
        paymentDueDate: latest.paymentDueDate,
        minimumPayment: latest.minimumPayment,
        cycleCount: ordered.length,
        hasGap: brokenChains.has(key),
      };
    })
    .sort((a, b) => b.currentBalance - a.currentBalance);
}

export const EMPTY_PORTFOLIO: Portfolio = buildPortfolio([]);
