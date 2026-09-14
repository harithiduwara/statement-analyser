import { describe, expect, it } from 'vitest';
import { sampathRealLayoutPages, SAMPATH_REAL_EXPECTED as E } from './fixtures/sampathRealLayout';
import { parsePages, parsePagesOrThrow } from './helpers/parse';
import { reconcile } from '@/analysis/reconcile';
import { buildPortfolio } from '@/analysis/portfolio';

const FILE = 'sampath-real-layout.pdf';

describe('Sampath, real printed layout', () => {
  it('detects Sampath over Seylan', async () => {
    const result = await parsePages(sampathRealLayoutPages(), FILE);
    expect(result.ok).toBe(true);
    expect(result.issuer).toBe('sampath');
  });

  it('reads the header past the mojibake rows', async () => {
    const s = await parsePagesOrThrow(sampathRealLayoutPages(), FILE);
    expect(s.accountMask).toBe(E.accountMask);
    expect(s.statementDate).toBe(E.statementDate);
    expect(s.paymentDueDate).toBe(E.paymentDueDate);
    expect(s.creditLimit).toBe(E.creditLimit);
    expect(s.interestRateAnnual).toBeCloseTo(E.interestRateAnnual, 6);
    expect(s.charges).toBe(E.charges);
    expect(s.payments).toBe(E.payments);
    expect(s.closingBalance).toBe(E.closingBalance);
    expect(s.minimumPayment).toBe(E.minimumPayment);
  });

  it('reads a credit opening balance as negative', async () => {
    // Printed "10,000.00CR" -- the account was overpaid at the cycle start.
    const s = await parsePagesOrThrow(sampathRealLayoutPages(), FILE);
    expect(s.openingBalance).toBe(E.openingBalance);
    expect(s.openingBalance).toBeLessThan(0);
  });

  it('reconciles, and the line items agree with the header', async () => {
    const s = await parsePagesOrThrow(sampathRealLayoutPages(), FILE);
    const rec = reconcile(s);
    expect(rec.delta).toBe(0);
    expect(rec.passes).toBe(true);
    expect(rec.transactionsMatchHeader).toBe(true);
  });

  it('de-duplicates the header that repeats on every page', async () => {
    const s = await parsePagesOrThrow(sampathRealLayoutPages(), FILE);
    // The header value rows must not be read as transactions, and the totals
    // must be counted once, not per page.
    expect(s.transactions).toHaveLength(E.transactionCount);
    expect(s.charges).toBe(E.charges);
  });

  it('reads the CR suffix and the inline foreign leg', async () => {
    const s = await parsePagesOrThrow(sampathRealLayoutPages(), FILE);
    const payment = s.transactions.find((t) => t.description.includes('PAYMENT RECEIVED'));
    expect(payment?.amount).toBe(-9_950);
    expect(payment?.classification).toBe('payment');

    const foreign = s.transactions.find((t) => t.description.startsWith('GLOBEX'));
    expect(foreign?.amount).toBe(1_600);
    expect(foreign?.currency).toEqual({ code: 'USD', amount: 5, impliedRate: 320 });
  });

  it('strips the (*) account-level marker but keeps the meaning', async () => {
    const s = await parsePagesOrThrow(sampathRealLayoutPages(), FILE);
    const interest = s.transactions.find((t) => t.classification === 'interest');
    expect(interest?.description).toBe('INTEREST CHARGED');
    expect(interest?.amount).toBe(200);
  });

  it('pairs the origination with its reversal and computes true charges', async () => {
    const s = await parsePagesOrThrow(sampathRealLayoutPages(), FILE);
    const p = buildPortfolio([s]);
    expect(p.reversals.matches).toHaveLength(1);
    expect(p.reversals.matches[0]!.amount).toBe(E.damroPrincipal);
    // Gross debits count the DAMRO purchase and its re-booked schedule; true
    // charges strip the reversed origination.
    expect(p.reversals.trueCharges).toBe(E.charges - E.damroPrincipal);
    // The DAMRO credit is a reversal, not a payment.
    expect(p.reversals.payments).toBe(E.payments - E.damroPrincipal);
  });

  it('folds the no-n/m processing fee into the plan it follows', async () => {
    const s = await parsePagesOrThrow(sampathRealLayoutPages(), FILE);
    const fee = s.transactions.find((t) => t.classification === 'installment_processing_fee');
    // The fee line carries no sequence of its own; it inherits DAMRO's 1/36.
    expect(fee?.installmentSeq).toBe(1);
    expect(fee?.installmentTerm).toBe(36);

    const plans = buildPortfolio([s]).register.plans;
    const damro = plans.find((pl) => pl.merchant.startsWith('DAMRO'));
    expect(damro?.monthly).toBe(E.damroMonthly); // repayment + recurring fee
    expect(damro?.monthlyFee).toBe(400);
    expect(damro?.originalPrincipal).toBe(E.damroPrincipal);
  });

  it('does not flag a fuel-surcharge reversal as an unexplained credit', async () => {
    const s = await parsePagesOrThrow(sampathRealLayoutPages(), FILE);
    const p = buildPortfolio([s]);
    // A surcharge refund is a standalone credit, not a bank-error signal.
    expect(p.anomalies.some((a) => a.kind === 'credit-without-debit')).toBe(false);
    const fuel = s.transactions.find((t) => t.classification === 'fuel_surcharge_reversal');
    expect(fuel?.amount).toBe(-50);
  });

  it('surfaces a broken cycle loudly', async () => {
    const s = await parsePagesOrThrow(
      sampathRealLayoutPages({ clearingOverride: '11,000.00' }),
      'sampath-broken.pdf',
    );
    expect(reconcile(s).passes).toBe(false);
  });
});
