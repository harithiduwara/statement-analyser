import { describe, expect, it } from 'vitest';
import {
  categoriseTxn,
  compileRules,
  merchantPattern,
  upsertMerchantRule,
  SEED_RULES,
} from '@/analysis/categories';
import { txn } from './helpers/build';

describe('tap to categorise', () => {
  it('derives a merchant pattern without the location, schedule or programme words', () => {
    expect(merchantPattern('KEELLS SUPER - COLOMBO')).toBe('KEELLS SUPER');
    expect(merchantPattern('ODEL INSTALLMENT REPAYMENT 1/12')).toBe('ODEL');
    expect(merchantPattern('NETFLIX.COM SINGAPORE')).toBe('NETFLIX\\.COM SINGAPORE');
  });

  it("lets a tapped choice win over the seeds and stick for that merchant", () => {
    const t = txn({ post: '2026-01-10', description: 'STARBUCKS COFFEE - COLOMBO', amount: 1_500 });
    expect(categoriseTxn(t, compileRules(SEED_RULES))).toBe('dining'); // COFFEE seed
    const rules = upsertMerchantRule(SEED_RULES, t.description, 'subscriptions');
    expect(categoriseTxn(t, compileRules(rules))).toBe('subscriptions');
    // a later charge at the same merchant, different location, inherits it
    const t2 = txn({ post: '2026-02-10', description: 'STARBUCKS COFFEE - GALLE', amount: 900 });
    expect(categoriseTxn(t2, compileRules(rules))).toBe('subscriptions');
  });

  it('updates a merchant rule in place rather than stacking duplicates', () => {
    const once = upsertMerchantRule(SEED_RULES, 'ODEL - COLOMBO', 'subscriptions');
    const twice = upsertMerchantRule(once, 'ODEL - GALLE', 'groceries');
    expect(twice.filter((r) => r.pattern === 'ODEL')).toHaveLength(1);
    expect(twice.find((r) => r.pattern === 'ODEL')?.category).toBe('groceries');
  });

  it('never lets a merchant rule override a class-decided category', () => {
    const fee = txn({ post: '2026-01-10', description: 'ANNUAL FEE', amount: 4_000, classification: 'annual_fee' });
    const rules = upsertMerchantRule(SEED_RULES, 'ANNUAL FEE', 'groceries');
    expect(categoriseTxn(fee, compileRules(rules))).toBe('fees & interest');
  });
});
