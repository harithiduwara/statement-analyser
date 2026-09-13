import { describe, expect, it } from 'vitest';
import { seylanStatementPages, SEYLAN_EXPECTED } from './fixtures/seylan';
import { parsePages, parsePagesOrThrow } from './helpers/parse';
import { reconcile } from '@/analysis/reconcile';
import { roundMoney } from '@/lib/money';

const FILE = 'seylan-2026-04-06.pdf';

describe('Seylan adapter', () => {
  it('detects the issuer and returns a statement', async () => {
    const result = await parsePages(seylanStatementPages(), FILE);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.issuer).toBe('seylan');
  });

  it('reads the header grid by column', async () => {
    const s = await parsePagesOrThrow(seylanStatementPages(), FILE);
    expect(s.accountMask).toBe(SEYLAN_EXPECTED.accountMask);
    expect(s.statementDate).toBe(SEYLAN_EXPECTED.statementDate);
    expect(s.paymentDueDate).toBe(SEYLAN_EXPECTED.paymentDueDate);
    expect(s.creditLimit).toBe(SEYLAN_EXPECTED.creditLimit);
    expect(s.interestRateAnnual).toBeCloseTo(SEYLAN_EXPECTED.interestRateAnnual, 6);
    expect(s.openingBalance).toBe(SEYLAN_EXPECTED.openingBalance);
    expect(s.charges).toBe(SEYLAN_EXPECTED.charges);
    expect(s.payments).toBe(SEYLAN_EXPECTED.payments);
    expect(s.financeCharge).toBe(SEYLAN_EXPECTED.financeCharge);
    expect(s.closingBalance).toBe(SEYLAN_EXPECTED.closingBalance);
    expect(s.minimumPayment).toBe(SEYLAN_EXPECTED.minimumPayment);
    expect(s.pastDueAmount).toBe(SEYLAN_EXPECTED.pastDueAmount);
  });

  it('never exposes a full card number', async () => {
    const s = await parsePagesOrThrow(seylanStatementPages(), FILE);
    const serialised = JSON.stringify(s);
    expect(s.accountMask).toHaveLength(4);
    // The fixture prints 40463300****2470; no run of 8+ digits may survive.
    expect(serialised).not.toMatch(/\d{8,}/);
    expect(serialised).not.toContain('40463300');
  });

  it('reconciles the cycle exactly', async () => {
    const s = await parsePagesOrThrow(seylanStatementPages(), FILE);
    const rec = reconcile(s);
    expect(rec.delta).toBe(0);
    expect(rec.passes).toBe(true);
    expect(rec.transactionsMatchHeader).toBe(true);
    expect(rec.transactionSum).toBe(
      roundMoney(SEYLAN_EXPECTED.charges - SEYLAN_EXPECTED.payments),
    );
  });

  it('parses a CR suffix as a negative amount', async () => {
    const s = await parsePagesOrThrow(seylanStatementPages(), FILE);
    const payment = s.transactions.find((t) => t.description.includes('PAYMENT'));
    expect(payment?.amount).toBe(-85_000);
    expect(payment?.classification).toBe('payment');

    const reversal = s.transactions.find((t) => t.description.includes('SURCHARGE REVERSAL'));
    expect(reversal?.amount).toBe(-80);
    expect(reversal?.classification).toBe('fuel_surcharge_reversal');
  });

  it('reads every transaction row with its reference and class', async () => {
    const s = await parsePagesOrThrow(seylanStatementPages(), FILE);
    expect(s.transactions).toHaveLength(SEYLAN_EXPECTED.transactionCount);

    const keells = s.transactions[0]!;
    expect(keells.reference).toBe('074512');
    expect(keells.description).toBe('KEELLS SUPER - NUGEGODA');
    expect(keells.postDate).toBe('2026-03-06');
    expect(keells.txnDate).toBe('2026-03-05');
    expect(keells.amount).toBe(12_450);
    expect(keells.classification).toBe('purchase');

    const stampDuty = s.transactions.find((t) => t.description === 'STAMP DUTY');
    expect(stampDuty?.classification).toBe('stamp_duty');
    expect(stampDuty?.reference).toBeUndefined();

    const interest = s.transactions.find((t) => t.description === 'FINANCE CHARGE');
    expect(interest?.classification).toBe('interest');
  });

  it('attaches the foreign-currency leg and derives the implied rate', async () => {
    const s = await parsePagesOrThrow(seylanStatementPages(), FILE);
    const netflix = s.transactions.find((t) => t.description.includes('NETFLIX'));
    expect(netflix?.amount).toBe(4_390.5);
    expect(netflix?.currency).toEqual({
      code: 'USD',
      amount: 14.99,
      impliedRate: 292.9,
    });
    // The FX leg is metadata on the LKR row, never a row of its own.
    expect(s.transactions.filter((t) => t.description === 'USD')).toHaveLength(0);
  });

  it('reads the instalment plan identifier and term', async () => {
    const s = await parsePagesOrThrow(seylanStatementPages(), FILE);
    const instalment = s.transactions.find(
      (t) => t.classification === 'installment_repayment',
    );
    expect(instalment?.installmentSeq).toBe(10);
    expect(instalment?.installmentTerm).toBe(36);
    expect(instalment?.installmentPlanId).toBe('seylan:SP010');
    expect(instalment?.amount).toBe(15_750);

    const fee = s.transactions.find(
      (t) => t.classification === 'installment_processing_fee',
    );
    expect(fee?.installmentPlanId).toBe('seylan:SP010');
    expect(fee?.amount).toBe(1_250);
  });

  it('assigns rows to cards from the per-card subtotals and checks they sum', async () => {
    const s = await parsePagesOrThrow(seylanStatementPages(), FILE);
    const subtotals = s.cardSubtotals ?? [];
    expect(subtotals).toHaveLength(2);

    const [main, supplementary] = subtotals;
    expect(main?.cardMask).toBe(SEYLAN_EXPECTED.accountMask);
    expect(main?.amount).toBe(SEYLAN_EXPECTED.mainCardSubtotal);
    expect(main?.matches).toBe(true);

    expect(supplementary?.cardMask).toBe(SEYLAN_EXPECTED.supplementaryMask);
    expect(supplementary?.amount).toBe(SEYLAN_EXPECTED.supplementaryCardSubtotal);
    expect(supplementary?.matches).toBe(true);

    expect(
      s.transactions.filter((t) => t.cardMask === SEYLAN_EXPECTED.supplementaryMask),
    ).toHaveLength(3);
    expect(s.transactions.every((t) => t.cardMask !== undefined)).toBe(true);

    expect(s.warnings.filter((w) => w.code.startsWith('subtotal'))).toHaveLength(0);
  });

  it('solves the rewards block by identity when the labels are mis-aligned', async () => {
    const s = await parsePagesOrThrow(seylanStatementPages(), FILE);
    const rewards = s.rewards;
    expect(rewards?.reconciled).toBe(true);
    expect(rewards?.balance).toBe(SEYLAN_EXPECTED.rewardsBalance);
    expect(rewards?.method).toBe('identity');
    // Reading the columns in printed order would give 13,510, not 11,150.
    expect(rewards?.additivePair).toEqual(SEYLAN_EXPECTED.rewardsAdditivePair);
    expect(rewards?.subtractivePair).toEqual(SEYLAN_EXPECTED.rewardsSubtractivePair);
    // The pair is left open rather than guessed at.
    expect(rewards?.opening).toBeUndefined();
    expect(rewards?.accumulated).toBeUndefined();
  });
});

describe('Seylan adapter, failure surfacing', () => {
  it('fails the invariant loudly when the closing balance does not follow', async () => {
    const s = await parsePagesOrThrow(
      seylanStatementPages({ closingBalanceOverride: '162,000.00' }),
      'seylan-broken.pdf',
    );
    const rec = reconcile(s);
    expect(rec.passes).toBe(false);
    expect(rec.delta).toBe(945.8);
    expect(rec.hint).toBeTruthy();
  });

  it('marks a rewards block unreconciled rather than guessing', async () => {
    const s = await parsePagesOrThrow(
      seylanStatementPages({ rewardsValuesOverride: ['5,000', '12,450', '3,820', '121', '11,150'] }),
      'seylan-rewards-broken.pdf',
    );
    expect(s.rewards?.reconciled).toBe(false);
    expect(s.rewards?.balance).toBeUndefined();
    expect(s.rewards?.observed).toEqual([5_000, 12_450, 3_820, 121, 11_150]);
    expect(s.warnings.some((w) => w.code === 'rewards-unreconciled')).toBe(true);
  });
});
