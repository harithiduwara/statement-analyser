import { describe, expect, it } from 'vitest';
import { seylanRealLayoutPages, SEYLAN_REAL_EXPECTED as E } from './fixtures/seylanRealLayout';
import { parsePagesOrThrow } from './helpers/parse';
import { reconcile } from '@/analysis/reconcile';
import { buildPortfolio } from '@/analysis/portfolio';

const FILE = 'seylan-real-layout.pdf';

/**
 * The layout Seylan actually prints, as distinct from the one an earlier
 * fixture assumed. Each assertion here corresponds to something the first
 * version of the parser got wrong on a real statement.
 */
describe('Seylan, real printed layout', () => {
  it('reads the three header bands', async () => {
    const s = await parsePagesOrThrow(seylanRealLayoutPages(), FILE);
    expect(s.accountMask).toBe(E.accountMask);
    expect(s.statementDate).toBe(E.statementDate);
    expect(s.paymentDueDate).toBe(E.paymentDueDate);
    expect(s.creditLimit).toBe(E.creditLimit);
    expect(s.interestRateAnnual).toBeCloseTo(E.interestRateAnnual, 6);
    expect(s.openingBalance).toBe(E.openingBalance);
    expect(s.charges).toBe(E.charges);
    expect(s.payments).toBe(E.payments);
    expect(s.financeCharge).toBe(E.financeCharge);
    expect(s.closingBalance).toBe(E.closingBalance);
    expect(s.minimumPayment).toBe(E.minimumPayment);
  });

  it('reconciles, and the line items agree with the header', async () => {
    const s = await parsePagesOrThrow(seylanRealLayoutPages(), FILE);
    const rec = reconcile(s);
    expect(rec.delta).toBe(0);
    expect(rec.passes).toBe(true);
    expect(rec.transactionsMatchHeader).toBe(true);
  });

  it('resolves DD/MM rows against the statement date, across the month boundary', async () => {
    const s = await parsePagesOrThrow(seylanRealLayoutPages(), FILE);
    // Transaction rows print no year at all. A statement dated 07/09/26
    // carries August rows from the cycle just closed and early September rows.
    const august = s.transactions.find((t) => t.description === 'CEFT PAYMENT');
    expect(august?.postDate).toBe('2026-08-10');
    expect(august?.txnDate).toBe('2026-08-09');

    const september = s.transactions.find((t) => t.description.startsWith('TELCO PLC'));
    expect(september?.postDate).toBe('2026-09-07');
    expect(september?.txnDate).toBe('2026-09-05');

    // Nothing may land in the wrong year.
    expect(s.transactions.every((t) => t.postDate.startsWith('2026-'))).toBe(true);
  });

  it('reads the masked auth code as a reference, not as a card', async () => {
    const s = await parsePagesOrThrow(seylanRealLayoutPages(), FILE);
    const ceft = s.transactions.find((t) => t.description === 'CEFT PAYMENT');
    expect(ceft?.reference).toBe('****0770');
    expect(ceft?.description).toBe('CEFT PAYMENT');

    // The reference differs per row; the card is named only in the subtotals.
    const references = s.transactions.map((t) => t.reference).filter(Boolean);
    expect(new Set(references).size).toBe(references.length);

    // A row with no reference keeps its whole description.
    const payment = s.transactions.find((t) => t.description === 'Payment');
    expect(payment?.reference).toBeUndefined();
    expect(payment?.amount).toBe(-4_400.88);
  });

  it('assigns rows to cards from the subtotals, in printed order', async () => {
    const s = await parsePagesOrThrow(seylanRealLayoutPages(), FILE);
    expect(s.transactions).toHaveLength(E.transactionCount);

    const [main, supplementary] = s.cardSubtotals ?? [];
    expect(main?.cardMask).toBe(E.accountMask);
    expect(main?.amount).toBe(E.mainCardSubtotal);
    expect(main?.matches).toBe(true);
    expect(supplementary?.cardMask).toBe(E.supplementaryMask);
    expect(supplementary?.amount).toBe(E.supplementaryCardSubtotal);
    expect(supplementary?.matches).toBe(true);

    // The supplementary card's rows come after the first card's subtotal.
    expect(
      s.transactions.filter((t) => t.cardMask === E.supplementaryMask),
    ).toHaveLength(2);
    expect(s.warnings.filter((w) => w.code.startsWith('subtotal'))).toHaveLength(0);
  });

  it('reads the rewards block printed one label per line', async () => {
    const s = await parsePagesOrThrow(seylanRealLayoutPages(), FILE);
    expect(s.rewards?.reconciled).toBe(true);
    expect(s.rewards?.method).toBe('labels');
    expect(s.rewards?.opening).toBe(E.rewards.opening);
    expect(s.rewards?.accumulated).toBe(E.rewards.accumulated);
    expect(s.rewards?.redeemed).toBe(E.rewards.redeemed);
    expect(s.rewards?.adjusted).toBe(E.rewards.adjusted);
    expect(s.rewards?.balance).toBe(E.rewards.balance);
    // Labels pair with values unambiguously here, so nothing is left open.
    expect(s.rewards?.additivePair).toBeUndefined();
  });

  it('does not read the rewards "Opening Balance" as the account opening balance', async () => {
    // Both the header grid and the rewards block print that exact label.
    const s = await parsePagesOrThrow(seylanRealLayoutPages(), FILE);
    expect(s.openingBalance).toBe(E.openingBalance);
    expect(s.openingBalance).not.toBe(E.rewards.opening);
  });

  it('separates two plans running at the same merchant and term', async () => {
    const s = await parsePagesOrThrow(seylanRealLayoutPages(), FILE);
    const plans = buildPortfolio([s]).register.plans;
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.planCode).sort()).toEqual(['seylan:SP009', 'seylan:SP010']);
    const sp010 = plans.find((p) => p.planCode === 'seylan:SP010');
    expect(sp010?.latestInstallment).toBe(10);
    expect(sp010?.termCount).toBe(36);
    expect(sp010?.monthly).toBe(27_777.77);
  });

  it('attaches the foreign-currency leg and derives the rate', async () => {
    const s = await parsePagesOrThrow(seylanRealLayoutPages(), FILE);
    const foreign = s.transactions.find((t) => t.description.startsWith('GLOBEX'));
    expect(foreign?.amount).toBe(6_861.48);
    expect(foreign?.currency).toEqual({ code: 'USD', amount: 20, impliedRate: 343.07 });
  });

  it('surfaces a broken cycle and a rewards block that does not add up', async () => {
    const broken = await parsePagesOrThrow(
      seylanRealLayoutPages({ closingBalanceOverride: '142,000.00', rewardsBalanceOverride: '775' }),
      'seylan-real-broken.pdf',
    );
    expect(reconcile(broken).passes).toBe(false);
    expect(broken.rewards?.reconciled).toBe(false);
    expect(broken.warnings.some((w) => w.code === 'rewards-unreconciled')).toBe(true);
  });
});
