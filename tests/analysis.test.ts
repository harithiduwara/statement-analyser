import { describe, expect, it } from 'vitest';
import { statement, txn } from './helpers/build';
import { analyseReversals } from '@/analysis/reversals';
import { buildInstallmentRegister } from '@/analysis/installments';
import { buildForwardSchedule, settlementImpact } from '@/analysis/forward';
import { analyseChain } from '@/analysis/gaps';
import { buildPortfolio } from '@/analysis/portfolio';
import { merchantSimilarity } from '@/analysis/merchant';
import { breakdownByCategory, compileRules, SEED_RULES } from '@/analysis/categories';

/**
 * The reference mechanic: a 200,000.00 purchase is booked, reversed the next
 * day, and re-booked as a 36-month plan of 6,000.00 + 500.00.
 */
function acmeCycle(date: string, opening: number) {
  return statement({
    date,
    opening,
    transactions: [
      txn({ post: '2026-03-15', description: 'ACME - GALLE, GALLE', amount: 200_000 }),
      txn({ post: '2026-03-16', description: 'ACME - GALLE, GALLE', amount: -200_000 }),
      txn({ post: '2026-03-16', description: 'ACME - GALLE INSTALLMENT REPAYMENT 1/36', amount: 6_000 }),
      txn({ post: '2026-03-16', description: 'ACME - GALLE INSTALLMENT PROCESSING FEES 1/36', amount: 500 }),
      txn({ post: '2026-03-20', description: 'PAYMENT - THANK YOU', amount: -50_000 }),
      txn({ post: '2026-03-22', description: 'VALUE SUPER - GALLE', amount: 12_000 }),
    ],
  });
}

describe('merchant matching', () => {
  it('matches a truncated or schedule-suffixed name to its origination', () => {
    expect(
      merchantSimilarity('ACME - GALLE, GALLE', 'ACME - GALLE INSTALLMENT REPAYMENT 1/36'),
    ).toBeGreaterThan(0.6);
  });

  it('does not match unrelated merchants', () => {
    expect(merchantSimilarity('ACME - GALLE', 'GLOBEX - KANDY')).toBeLessThan(0.6);
  });
});

describe('reversal matching', () => {
  const cycle = acmeCycle('2026-04-06', 100_000);
  const analysis = analyseReversals([cycle]);

  it('pairs the origination with its reversal', () => {
    expect(analysis.matches).toHaveLength(1);
    expect(analysis.matches[0]!.amount).toBe(200_000);
    expect(analysis.matches[0]!.gapDays).toBe(1);
  });

  it('removes the reversal from charges instead of counting it as a payment', () => {
    // Gross debits count the purchase and its schedule; true charges do not.
    expect(analysis.grossDebits).toBe(218_500);
    expect(analysis.matchedReversals).toBe(200_000);
    expect(analysis.trueCharges).toBe(18_500);
    // The 200,000 credit is a reversal; only the 50,000 is a real payment.
    expect(analysis.grossCredits).toBe(250_000);
    expect(analysis.payments).toBe(50_000);
  });

  it('never treats a payment line as a reversal', () => {
    const payment = cycle.transactions.find((t) => t.description.includes('PAYMENT'))!;
    expect(analysis.byTxnId.has(payment.id)).toBe(false);
  });

  it('reports a credit with no matching debit rather than absorbing it', () => {
    const orphan = statement({
      date: '2026-04-06',
      opening: 0,
      transactions: [
        txn({ post: '2026-03-10', description: 'HANDLING FEE REVERSAL', amount: -59_567.33 }),
      ],
    });
    const result = analyseReversals([orphan]);
    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedCredits).toHaveLength(1);
    expect(result.unmatchedCredits[0]!.amount).toBe(-59_567.33);
  });
});

describe('instalment register', () => {
  const cycle = acmeCycle('2026-04-06', 100_000);
  const reversals = analyseReversals([cycle]);
  const register = buildInstallmentRegister([cycle], reversals);

  it('folds the recurring processing fee into the monthly figure', () => {
    expect(register.plans).toHaveLength(1);
    const plan = register.plans[0]!;
    expect(plan.monthlyRepayment).toBe(6_000);
    expect(plan.monthlyFee).toBe(500);
    expect(plan.monthly).toBe(6_500);
    expect(register.monthlyObligation).toBe(6_500);
  });

  it('tracks progress and remaining value', () => {
    const plan = register.plans[0]!;
    expect(plan.termCount).toBe(36);
    expect(plan.latestInstallment).toBe(1);
    expect(plan.remaining).toBe(35);
    expect(plan.remainingValue).toBe(227_500);
    expect(plan.totalPayable).toBe(234_000);
  });

  it('prices the plan from the observed origination', () => {
    const plan = register.plans[0]!;
    expect(plan.originalPrincipal).toBe(200_000);
    expect(plan.costOfCredit).toBeCloseTo(234_000 / 200_000 - 1, 9);
    expect(plan.financingCost).toBe(34_000);
  });

  it('reports n/a rather than inferring a principal that was never observed', () => {
    // The plan is mid-schedule and its origination predates the loaded set.
    const midway = statement({
      date: '2026-04-06',
      opening: 0,
      transactions: [
        txn({ post: '2026-03-16', description: 'GLOBEX INSTALLMENT REPAYMENT 12/24', amount: 4_000 }),
      ],
    });
    const plans = buildInstallmentRegister([midway], analyseReversals([midway])).plans;
    expect(plans[0]!.originalPrincipal).toBeUndefined();
    expect(plans[0]!.costOfCredit).toBeUndefined();
    expect(plans[0]!.financingCost).toBeUndefined();
  });

  it("folds Seylan's processing fee into the plan it names, not a plan of its own", () => {
    // Seylan's fee line names no merchant -- every word in it is programme
    // wording -- so only the printed SP code ties it to its repayment.
    const seylan = statement({
      date: '2026-04-06',
      opening: 0,
      transactions: [
        {
          ...txn({ post: '2026-03-12', description: 'SEYLAN EASY PAY - SP 010 of 036', amount: 15_750 }),
          installmentPlanId: 'seylan:SP010',
        },
        {
          ...txn({ post: '2026-03-12', description: 'EASY PAY PROCESSING FEE - SP 010 of 036', amount: 1_250 }),
          installmentPlanId: 'seylan:SP010',
        },
      ],
    });
    const register = buildInstallmentRegister([seylan], analyseReversals([seylan]));
    expect(register.plans).toHaveLength(1);
    const plan = register.plans[0]!;
    expect(plan.planCode).toBe('seylan:SP010');
    expect(plan.monthlyRepayment).toBe(15_750);
    expect(plan.monthlyFee).toBe(1_250);
    expect(plan.monthly).toBe(17_000);
    expect(plan.remaining).toBe(26);
  });

  it('does not double-count a cycle that appears twice', () => {
    const twice = buildInstallmentRegister([cycle, cycle], reversals);
    expect(twice.plans).toHaveLength(1);
    expect(twice.monthlyObligation).toBe(6_500);
  });
});

describe('forward schedule', () => {
  const cycle = acmeCycle('2026-04-06', 100_000);
  const register = buildInstallmentRegister([cycle], analyseReversals([cycle]));
  const schedule = buildForwardSchedule(register);

  it('projects each plan for exactly its remaining months', () => {
    expect(schedule.months).toHaveLength(35);
    expect(schedule.months[0]!.month).toBe('2026-05');
    expect(schedule.months[0]!.total).toBe(6_500);
    expect(schedule.months[34]!.total).toBe(6_500);
    expect(schedule.totalOutflow).toBe(227_500);
  });

  it('marks the month a plan retires', () => {
    expect(schedule.months[34]!.retiring).toHaveLength(1);
    expect(schedule.months[33]!.retiring).toHaveLength(0);
  });

  it('drops a settled plan from the projection', () => {
    const settled = buildForwardSchedule(register, { settleNow: [register.plans[0]!.id] });
    expect(settled.months).toHaveLength(0);
    expect(settled.totalOutflow).toBe(0);
  });

  it('reports no financing avoided when settling a 0% plan early', () => {
    // One statement object, shared by both passes: the register ties a plan
    // back to its origination by transaction id, so they must agree.
    const interestFree = statement({
      date: '2026-04-06',
      opening: 0,
      transactions: [
        txn({ post: '2026-03-01', description: 'ABANS PLC', amount: 24_000 }),
        txn({ post: '2026-03-02', description: 'ABANS PLC', amount: -24_000 }),
        txn({ post: '2026-03-02', description: 'ABANS INSTALLMENT REPAYMENT 1/12', amount: 2_000 }),
      ],
    });
    const zero = buildInstallmentRegister([interestFree], analyseReversals([interestFree]));
    const plan = zero.plans[0]!;
    // 2,000 x 12 = 24,000 against a 24,000 principal: nothing is being paid
    // for the credit, so settling it early saves nothing.
    expect(plan.originalPrincipal).toBe(24_000);
    expect(plan.totalPayable).toBe(24_000);
    expect(plan.costOfCredit).toBeCloseTo(0, 9);
    expect(settlementImpact(plan).financingAvoided).toBe(0);
    expect(settlementImpact(plan).monthlyRelief).toBe(2_000);
  });
});

describe('balance-chain gaps', () => {
  const march = statement({ date: '2026-03-06', opening: 100_000, transactions: [
    txn({ post: '2026-02-20', description: 'VALUE SUPER', amount: 20_000 }),
  ] });
  const april = statement({ date: '2026-04-06', opening: march.closingBalance, transactions: [
    txn({ post: '2026-03-20', description: 'VALUE SUPER', amount: 15_000 }),
  ] });
  const june = statement({ date: '2026-06-06', opening: 200_000, transactions: [
    txn({ post: '2026-05-20', description: 'VALUE SUPER', amount: 10_000 }),
  ] });

  it('accepts a chain that closes where the next opens', () => {
    const chain = analyseChain([march, april]);
    expect(chain.gaps).toHaveLength(0);
    expect(chain.incompleteChains).toHaveLength(0);
  });

  it('flags a removed statement with the exact movement it must explain', () => {
    const chain = analyseChain([march, april, june]);
    expect(chain.gaps).toHaveLength(1);
    const gap = chain.gaps[0]!;
    expect(gap.windowFrom).toBe('2026-04-06');
    expect(gap.windowTo).toBe('2026-06-06');
    // April closes at 135,000; June opens at 200,000.
    expect(gap.impliedMovement).toBe(65_000);
    expect(gap.estimatedMissingCycles).toBe(1);
  });

  it('does not renumber or interpolate the missing cycle', () => {
    const chain = analyseChain([march, april, june]);
    expect(chain.links).toHaveLength(2);
    // The statements themselves are untouched.
    expect(june.openingBalance).toBe(200_000);
  });
});

describe('spend views', () => {
  const cycle = acmeCycle('2026-04-06', 100_000);
  const reversals = analyseReversals([cycle]);
  const register = buildInstallmentRegister([cycle], reversals);
  const rules = compileRules(SEED_RULES);

  it('counts a financed purchase once, at origination, on the economic view', () => {
    const b = breakdownByCategory([cycle], rules, reversals, register, 'economic');
    // 200,000 origination + 12,000 groceries. The repayment and its fee are
    // the same purchase arriving in instalments, so they are not added again.
    expect(b.grandTotal).toBe(212_000);
  });

  it('counts the repayments and not the origination on the cash view', () => {
    const b = breakdownByCategory([cycle], rules, reversals, register, 'cash');
    expect(b.grandTotal).toBe(18_500);
  });

  it('counts a reversed charge that was never financed on neither view', () => {
    const surcharge = statement({
      date: '2026-04-06',
      opening: 0,
      transactions: [
        txn({ post: '2026-03-08', description: 'FUEL SURCHARGE', amount: 80 }),
        txn({ post: '2026-03-09', description: 'FUEL SURCHARGE REVERSAL', amount: -80 }),
        txn({ post: '2026-03-10', description: 'VALUE SUPER', amount: 5_000 }),
      ],
    });
    const r = analyseReversals([surcharge]);
    const reg = buildInstallmentRegister([surcharge], r);
    for (const view of ['economic', 'cash'] as const) {
      const b = breakdownByCategory([surcharge], rules, r, reg, view);
      expect(b.grandTotal, view).toBe(5_000);
    }
  });
});

describe('portfolio', () => {
  it('adds contracted instalments to the statement balance', () => {
    const cycle = acmeCycle('2026-04-06', 100_000);
    const p = buildPortfolio([cycle]);
    expect(p.statementBalance).toBe(cycle.closingBalance);
    expect(p.trueObligation).toBe(
      Math.round((cycle.closingBalance + 227_500) * 100) / 100,
    );
    expect(p.reconciliationSummary.passed).toBe(1);
  });

  it('is safe on an empty set', () => {
    const p = buildPortfolio([]);
    expect(p.isEmpty).toBe(true);
    expect(p.trueObligation).toBe(0);
    expect(p.monthlyAverageSpend).toBe(0);
    expect(p.monthlyAverageInstallment).toBe(0);
    expect(p.anomalies).toHaveLength(0);
  });

  it('averages spend and instalments over one cycle, reversed origination excluded', () => {
    // The reversed 200,000 origination must not count as spend; only the
    // 6,000 + 500 schedule and the 12,000 everyday purchase do.
    const p = buildPortfolio([acmeCycle('2026-04-06', 100_000)]);
    expect(p.monthlyAverageSpend).toBe(18_500);
    expect(p.monthlyAverageInstallment).toBe(6_500);
    // The instalment slice can never exceed total spend.
    expect(p.monthlyAverageInstallment).toBeLessThanOrEqual(p.monthlyAverageSpend);
  });

  it('divides by the number of cycles, not the number of transactions', () => {
    const jan = statement({
      date: '2026-01-05',
      opening: 0,
      transactions: [
        txn({ post: '2026-01-10', description: 'VALUE SUPER - GALLE', amount: 10_000 }),
        txn({ post: '2026-01-12', description: 'SOFA - ACME INSTALLMENT REPAYMENT 1/12', amount: 2_000 }),
      ],
    });
    const feb = statement({
      date: '2026-02-05',
      opening: jan.closingBalance,
      transactions: [
        txn({ post: '2026-02-10', description: 'ODEL - COLOMBO', amount: 20_000 }),
        txn({ post: '2026-02-12', description: 'SOFA - ACME INSTALLMENT REPAYMENT 2/12', amount: 2_000 }),
        txn({ post: '2026-02-20', description: 'INTEREST', amount: 1_000, classification: 'interest' }),
      ],
    });
    const p = buildPortfolio([jan, feb]);
    // spend = (10,000 + 2,000) + (20,000 + 2,000 + 1,000) = 35,000 over 2 cycles
    expect(p.monthlyAverageSpend).toBe(17_500);
    // instalment = 2,000 + 2,000 = 4,000 over 2 cycles
    expect(p.monthlyAverageInstallment).toBe(2_000);
  });
});

describe('cost of borrowing', () => {
  // A plan whose origination is observed, so it can be priced: 100,000 booked,
  // reversed the next day, and re-booked as 12 x (9,000 repayment + 500 fee),
  // alongside a month of interest and an annual fee.
  function pricedPlanCycle() {
    return statement({
      date: '2026-05-05',
      opening: 0,
      transactions: [
        txn({ post: '2026-04-10', description: 'GLOBEX - KANDY', amount: 100_000 }),
        txn({ post: '2026-04-11', description: 'GLOBEX - KANDY', amount: -100_000 }),
        txn({ post: '2026-04-11', description: 'GLOBEX INSTALLMENT REPAYMENT 1/12', amount: 9_000 }),
        txn({ post: '2026-04-11', description: 'GLOBEX INSTALLMENT PROCESSING FEES 1/12', amount: 500 }),
        txn({ post: '2026-04-20', description: 'INTEREST', amount: 1_500, classification: 'interest' }),
        txn({ post: '2026-04-22', description: 'ANNUAL FEE', amount: 4_000, classification: 'annual_fee' }),
      ],
    });
  }

  it('prices a short plan at an effective APR above its headline total cost', () => {
    const p = buildPortfolio([pricedPlanCycle()]);
    const plan = p.register.plans.find((pl) => pl.effectiveApr !== undefined);
    expect(plan).toBeDefined();
    // Total cost over the term is 14% (114,000 / 100,000). Annualised, a
    // 12-month amortising plan costs more than that headline, because the
    // balance is being repaid throughout, not held for the full year.
    expect(plan!.costOfCredit).toBeCloseTo(0.14, 2);
    expect(plan!.effectiveApr!).toBeGreaterThan(plan!.costOfCredit!);
    expect(plan!.effectiveApr!).toBeGreaterThan(0.24);
    expect(plan!.effectiveApr!).toBeLessThan(0.32);
    // Compounding makes the effective rate exceed the nominal (IRR x 12).
    expect(plan!.effectiveApr!).toBeGreaterThan(plan!.nominalApr!);
  });

  it('sums every card cost into the all-in P&L, net of reversals', () => {
    const bc = buildPortfolio([pricedPlanCycle()]).borrowingCost;
    // interest 1,500 + instalment fee 500 + annual fee 4,000 = 6,000
    expect(bc.totalCost).toBe(6_000);
    expect(bc.components.map((c) => c.key).sort()).toEqual([
      'annual_fee',
      'instalment_fees',
      'interest',
    ]);
    // Spend excludes the reversed origination: 9,000 + 500 + 1,500 + 4,000.
    expect(bc.carryCostRatio).toBeCloseTo(6_000 / 15_000, 6);
  });

  it('restates the printed card rate as an effective annual rate', () => {
    const card = buildPortfolio([pricedPlanCycle()]).borrowingCost.cards[0]!;
    expect(card.printedAnnualRate).toBe(0.28);
    expect(card.effectiveAnnualRate).toBeCloseTo(0.319, 3); // (1 + 0.28/12)^12 - 1
    expect(card.interestCharged).toBe(1_500);
  });

  it('is safe on an empty set', () => {
    const bc = buildPortfolio([]).borrowingCost;
    expect(bc.totalCost).toBe(0);
    expect(bc.annualisedCost).toBe(0);
    expect(bc.carryCostRatio).toBeUndefined();
    expect(bc.pricedPlans).toHaveLength(0);
  });
});
