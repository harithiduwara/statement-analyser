import { describe, expect, it } from 'vitest';
import { annuityPresentValue, annuityRate, effectiveAnnualRate } from '@/lib/finance';

describe('annuityPresentValue', () => {
  it('is the undiscounted sum at rate 0', () => {
    expect(annuityPresentValue(100, 12, 0)).toBe(1200);
  });

  it('discounts a known annuity', () => {
    // (1 - 1.01^-12) / 0.01 = 11.2551...
    expect(annuityPresentValue(1, 12, 0.01)).toBeCloseTo(11.2551, 3);
  });
});

describe('annuityRate (loan IRR)', () => {
  it('recovers the rate a payment schedule was built from', () => {
    for (const rate of [0.005, 0.02, 0.03]) {
      for (const n of [6, 12, 36]) {
        const principal = 100_000;
        const payment = principal / annuityPresentValue(1, n, rate);
        expect(annuityRate(principal, payment, n)).toBeCloseTo(rate, 5);
      }
    }
  });

  it('is 0 when the payments repay exactly the principal', () => {
    expect(annuityRate(1200, 100, 12)).toBe(0);
  });

  it('is undefined when the payments never repay the principal', () => {
    expect(annuityRate(2000, 100, 12)).toBeUndefined();
  });

  it('is undefined on degenerate input', () => {
    expect(annuityRate(0, 100, 12)).toBeUndefined();
    expect(annuityRate(1000, 0, 12)).toBeUndefined();
    expect(annuityRate(1000, 100, 0)).toBeUndefined();
  });
});

describe('effectiveAnnualRate', () => {
  it('compounds a monthly rate to its annual cost', () => {
    expect(effectiveAnnualRate(0.02)).toBeCloseTo(0.26824, 4);
  });

  it('turns a 28% nominal card rate into ~31.9% effective', () => {
    expect(effectiveAnnualRate(0.28 / 12)).toBeCloseTo(0.319, 3);
  });

  it('equals the nominal rate at one compounding period a year', () => {
    expect(effectiveAnnualRate(0.1, 1)).toBeCloseTo(0.1, 10);
  });
});
