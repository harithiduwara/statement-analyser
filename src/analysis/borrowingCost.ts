import type { Issuer, Money, Statement, TxnClass } from '@/domain/types';
import { roundMoney } from '@/lib/money';
import { effectiveAnnualRate } from '@/lib/finance';
import type { InstallmentPlan, InstallmentRegister } from './installments';

/**
 * Cost of borrowing: what the card costs to carry, and what its financing
 * really charges once the term is normalised away.
 *
 * Two questions a headline number cannot answer on its own:
 *
 *  - The printed interest rate is nominal. Compounded monthly it costs more
 *    over a year than the figure printed, and the gap is the compounding the
 *    nominal rate hides.
 *  - A plan's total cost ("6% over the term") is not comparable across terms:
 *    6% over six months is far dearer per year than 6% over three, because the
 *    balance is being repaid the whole time. The effective APR restates every
 *    plan on one annual footing, so the dearest financing is the dearest row
 *    whatever its term -- which is often the short "small fee" plan, not the
 *    long one with the larger headline cost.
 */

export interface CardBorrowingRate {
  issuer: Issuer;
  accountMask: string;
  /** The rate printed on the statement, taken as a nominal annual rate. */
  printedAnnualRate: number;
  monthlyRate: number;
  /** (1 + monthly)^12 - 1: the true annual cost of carrying a balance. */
  effectiveAnnualRate: number;
  /** Interest actually charged on this card across the loaded cycles. */
  interestCharged: Money;
}

export interface CostComponent {
  key: string;
  label: string;
  amount: Money;
}

export interface BorrowingCostReport {
  /** Per-card carry rates, printed against effective. */
  cards: CardBorrowingRate[];
  /** Every cost the card imposed, by kind, net of its own reversals. */
  components: CostComponent[];
  /** The components summed. */
  totalCost: Money;
  /** totalCost as a fraction of spend. Undefined when nothing was spent. */
  carryCostRatio?: number;
  /** totalCost annualised: mean per cycle x 12. */
  annualisedCost: Money;
  /** Cycles the cost is spread over. */
  cycleCount: number;
  /** Priced plans ranked by effective APR, dearest first. */
  pricedPlans: InstallmentPlan[];
  /** The dearest priced plan by effective APR, when any is priced. */
  dearestPlan?: InstallmentPlan;
}

/**
 * The cost side of the ledger, each line net of its own reversal. A reversal
 * is a credit (negative), so summing the raw amounts of a class and its
 * reversal class nets them without a special case.
 */
const COST_COMPONENTS: { key: string; label: string; classes: TxnClass[] }[] = [
  { key: 'interest', label: 'Interest', classes: ['interest', 'interest_reversal'] },
  { key: 'instalment_fees', label: 'Instalment processing fees', classes: ['installment_processing_fee'] },
  { key: 'annual_fee', label: 'Annual & card fees', classes: ['annual_fee'] },
  { key: 'stamp_duty', label: 'Stamp duty', classes: ['stamp_duty'] },
  { key: 'fuel_surcharge', label: 'Fuel surcharge', classes: ['fuel_surcharge', 'fuel_surcharge_reversal'] },
];

export function buildBorrowingCost(
  statements: readonly Statement[],
  register: InstallmentRegister,
  totalSpend: Money,
): BorrowingCostReport {
  const cycleCount = statements.length;

  const byClass = new Map<TxnClass, number>();
  for (const s of statements) {
    for (const t of s.transactions) {
      byClass.set(t.classification, (byClass.get(t.classification) ?? 0) + t.amount);
    }
  }
  const amountOf = (classes: readonly TxnClass[]): Money =>
    roundMoney(classes.reduce((acc, c) => acc + (byClass.get(c) ?? 0), 0));

  const components = COST_COMPONENTS.map((c) => ({
    key: c.key,
    label: c.label,
    amount: amountOf(c.classes),
  })).filter((c) => Math.abs(c.amount) > 0.005);
  const totalCost = roundMoney(components.reduce((acc, c) => acc + c.amount, 0));

  const pricedPlans = register.plans
    .filter((p) => p.effectiveApr !== undefined)
    .sort((a, b) => (b.effectiveApr ?? 0) - (a.effectiveApr ?? 0));

  return {
    cards: buildCardRates(statements),
    components,
    totalCost,
    ...(totalSpend > 0 ? { carryCostRatio: totalCost / totalSpend } : {}),
    annualisedCost: cycleCount === 0 ? 0 : roundMoney((totalCost / cycleCount) * 12),
    cycleCount,
    pricedPlans,
    ...(pricedPlans[0] ? { dearestPlan: pricedPlans[0] } : {}),
  };
}

function buildCardRates(statements: readonly Statement[]): CardBorrowingRate[] {
  const byCard = new Map<string, Statement[]>();
  for (const s of statements) {
    const key = `${s.issuer}:${s.accountMask}`;
    byCard.set(key, [...(byCard.get(key) ?? []), s]);
  }

  return [...byCard.values()]
    .map((group) => {
      const ordered = [...group].sort((a, b) => a.statementDate.localeCompare(b.statementDate));
      const latest = ordered[ordered.length - 1]!;
      const monthlyRate = latest.interestRateAnnual / 12;
      let interestCharged = 0;
      for (const s of group) {
        for (const t of s.transactions) {
          if (t.classification === 'interest' || t.classification === 'interest_reversal') {
            interestCharged += t.amount;
          }
        }
      }
      return {
        issuer: latest.issuer,
        accountMask: latest.accountMask,
        printedAnnualRate: latest.interestRateAnnual,
        monthlyRate,
        effectiveAnnualRate: effectiveAnnualRate(monthlyRate),
        interestCharged: roundMoney(interestCharged),
      };
    })
    .sort((a, b) => b.effectiveAnnualRate - a.effectiveAnnualRate);
}
