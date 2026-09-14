import { type Money, type Statement, type Txn } from '@/domain/types';
import { monthKey } from '@/lib/dates';
import { roundMoney } from '@/lib/money';
import type { ReversalAnalysis } from './reversals';
import type { InstallmentRegister } from './installments';

/**
 * Category classification from an ordered, user-editable rules table.
 *
 * The seeds below are a starting point, not an authority -- merchant naming
 * is local and changes, so the table is editable in the UI and the edits are
 * persisted. `unclassified` is a first-class bucket with a visible count:
 * hiding unmatched spend inside "other" is how a category breakdown quietly
 * stops adding up to the total.
 */

export const CATEGORIES = [
  'groceries',
  'fuel',
  'utilities & telco',
  'subscriptions',
  'dining',
  'ride-hailing & delivery',
  'healthcare',
  'hardware & construction',
  'furniture & appliances',
  'insurance & vehicle',
  'travel & hospitality',
  'tolls & transit',
  'precious metals',
  'BNPL settlements',
  'fees & interest',
  'unclassified',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface CategoryRule {
  id: string;
  /** Source form of the regex, so it round-trips through storage. */
  pattern: string;
  category: Category;
  /** Seeded rules are marked, so a reset can tell them from user rules. */
  seeded?: boolean;
  enabled: boolean;
}

let nextId = 0;
const seed = (pattern: string, category: Category): CategoryRule => ({
  id: `seed-${(nextId += 1)}`,
  pattern,
  category,
  seeded: true,
  enabled: true,
});

/** Ordered: first match wins, so specific patterns precede general ones. */
export const SEED_RULES: CategoryRule[] = [
  seed('KEELLS|CARGILLS|ARPICO|LAUGFS\\s*SUPER|GLOMARK|SPAR|FOOD\\s*CITY', 'groceries'),
  seed('CEYPETCO|IOC|LANKA\\s*IOC|FUEL|PETROL|SHED|SINOPEC', 'fuel'),
  seed('DIALOG|MOBITEL|SLT|HUTCH|AIRTEL|CEB|WATER\\s*BOARD|LECO|ELECTRIC', 'utilities & telco'),
  seed('NETFLIX|SPOTIFY|YOUTUBE|GOOGLE|APPLE\\.COM|MICROSOFT|ADOBE|OPENAI|ANTHROPIC|AWS|ICLOUD', 'subscriptions'),
  seed('RESTAURANT|CAFE|COFFEE|PIZZA|KFC|MCDONALD|BURGER|BAKERY|HOTEL\\s*DE', 'dining'),
  seed('UBER|PICKME|KANGAROO|DELIVER|FOOD\\s*PANDA|PANDA', 'ride-hailing & delivery'),
  seed('HOSPITAL|PHARMAC|MEDIC|LANKA\\s*HOSPITAL|ASIRI|NAWALOKA|DURDANS|CHANNEL', 'healthcare'),
  seed('HARDWARE|CEMENT|TOKYO\\s*CEMENT|STEEL|TILES|ROCELL|LANWA|HOLCIM', 'hardware & construction'),
  seed('SINGER|ABANS|DAMRO|SOFTLOGIC|ARPICO\\s*FURNI|HOMEMART|ODEL', 'furniture & appliances'),
  seed('INSURANCE|CEYLINCO|AIA|ALLIANZ|SLIC|UNION\\s*ASSURANCE|VEHICLE|LEASING', 'insurance & vehicle'),
  seed('AIRLINE|SRILANKAN|EMIRATES|QATAR|BOOKING|AGODA|AIRBNB|HOTEL|RESORT|VILLA', 'travel & hospitality'),
  seed('EXPRESSWAY|TOLL|RAILWAY|BUS|TRANSIT|PARKING', 'tolls & transit'),
  seed('JEWELL|GOLD|SILVER|BULLION|VOGUE\\s*JEWELL', 'precious metals'),
  seed('MINTPAY|KOKO|WEPAY|PAYHERE|BNPL', 'BNPL settlements'),
];

/** Compile once; an invalid user pattern disables itself rather than throwing. */
export interface CompiledRule extends CategoryRule {
  regex?: RegExp;
  error?: string;
}

export function compileRules(rules: readonly CategoryRule[]): CompiledRule[] {
  return rules.map((rule) => {
    if (!rule.enabled) return { ...rule };
    try {
      return { ...rule, regex: new RegExp(rule.pattern, 'i') };
    } catch (err) {
      return { ...rule, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function categoriseTxn(txn: Txn, rules: readonly CompiledRule[]): Category {
  // Fees and interest are decided by classification, not by merchant text:
  // the transaction class already knows, and no regex should be able to
  // reclassify a finance charge as groceries.
  if (
    txn.classification === 'interest' ||
    txn.classification === 'annual_fee' ||
    txn.classification === 'stamp_duty' ||
    txn.classification === 'fuel_surcharge' ||
    txn.classification === 'installment_processing_fee'
  ) {
    return 'fees & interest';
  }

  for (const rule of rules) {
    if (rule.regex?.test(txn.description)) return rule.category;
  }
  return 'unclassified';
}

/**
 * Two readings of the same spending, both correct for different questions.
 *
 *  - `economic` books an instalment-financed purchase at full value in the
 *    month it was acquired. It answers "what did I commit to?"
 *  - `cash` books the monthly repayment as it falls due. It answers "what
 *    left my account?"
 *
 * The UI must always say which one is on screen; they differ by a lot.
 */
export type SpendView = 'economic' | 'cash';

export interface CategoryTotal {
  category: Category;
  amount: Money;
  count: number;
  share: number;
}

export interface CategoryBreakdown {
  view: SpendView;
  totals: CategoryTotal[];
  grandTotal: Money;
  unclassifiedCount: number;
  byMonth: { month: string; total: Money }[];
}

export function breakdownByCategory(
  statements: readonly Statement[],
  rules: readonly CompiledRule[],
  reversals: ReversalAnalysis,
  register: InstallmentRegister,
  view: SpendView,
): CategoryBreakdown {
  /*
   * A reversed debit is only spending if it was re-booked as a plan. A
   * purchase that was reversed and financed still happened; a fuel surcharge
   * that was levied and refunded did not, and counting it would inflate the
   * economic view by every charge the bank ever undid.
   */
  const planOriginations = new Set(
    register.plans
      .map((p) => p.originationTxnId)
      .filter((id): id is string => id !== undefined),
  );
  const totals = new Map<Category, { amount: Money; count: number }>();
  const months = new Map<string, Money>();
  let grandTotal = 0;

  for (const statement of statements) {
    for (const txn of statement.transactions) {
      if (txn.amount <= 0) continue;

      const wasReversed = reversals.byTxnId.has(txn.id);
      const isPlanOrigination = planOriginations.has(txn.id);

      // A debit the bank undid without financing it never happened.
      if (wasReversed && !isPlanOrigination) continue;

      if (view === 'economic') {
        // The financed purchase is counted once, at origination. Its
        // repayments and recurring fee are that same purchase arriving in
        // instalments, so counting them too would double it.
        if (
          txn.classification === 'installment_repayment' ||
          txn.classification === 'installment_processing_fee'
        ) {
          continue;
        }
      } else if (isPlanOrigination) {
        // Cash view: the origination was reversed off the account, so no cash
        // moved for it. The repayments below are what actually left.
        continue;
      }

      const category = categoriseTxn(txn, rules);
      const entry = totals.get(category) ?? { amount: 0, count: 0 };
      entry.amount = roundMoney(entry.amount + txn.amount);
      entry.count += 1;
      totals.set(category, entry);

      const key = monthKey(txn.postDate);
      months.set(key, roundMoney((months.get(key) ?? 0) + txn.amount));
      grandTotal = roundMoney(grandTotal + txn.amount);
    }
  }

  const list: CategoryTotal[] = [...totals.entries()]
    .map(([category, { amount, count }]) => ({
      category,
      amount,
      count,
      share: grandTotal === 0 ? 0 : amount / grandTotal,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    view,
    totals: list,
    grandTotal,
    unclassifiedCount: totals.get('unclassified')?.count ?? 0,
    byMonth: [...months.entries()]
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}
