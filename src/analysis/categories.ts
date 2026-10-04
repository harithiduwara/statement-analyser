import { type IsoDate, type Money, type Statement, type Txn } from '@/domain/types';
import { addDays, monthKey } from '@/lib/dates';
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
  seed('DIALOG|MOBITEL|SLT|HUTCH|AIRTEL|CEB|LECO|WATER\\s*BOARD|NWSDB|ELECTRIC|LITRO|LAUGFS\\s*GAS', 'utilities & telco'),
  seed('NETFLIX|SPOTIFY|YOUTUBE|DISNEY|HBO|HOTSTAR|IFLIX|PRIME\\s*VIDEO|AMAZON\\s*PRIME|GOOGLE|APPLE\\.COM|ITUNES|MICROSOFT|OFFICE\\s*365|ADOBE|OPENAI|CHATGPT|ANTHROPIC|AWS|ICLOUD|CANVA|NOTION|GITHUB|DROPBOX|PATREON', 'subscriptions'),
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

/**
 * Some categories are decided by the transaction class, not by merchant text:
 * a finance charge is fees & interest whatever a regex says. For these rows the
 * class wins and the category picker is read-only.
 */
export function isCategoryByClass(txn: Pick<Txn, 'classification'>): boolean {
  return (
    txn.classification === 'interest' ||
    txn.classification === 'annual_fee' ||
    txn.classification === 'stamp_duty' ||
    txn.classification === 'fuel_surcharge' ||
    txn.classification === 'installment_processing_fee'
  );
}

export function categoriseTxn(txn: Txn, rules: readonly CompiledRule[]): Category {
  if (isCategoryByClass(txn)) return 'fees & interest';
  for (const rule of rules) {
    if (rule.regex?.test(txn.description)) return rule.category;
  }
  return 'unclassified';
}

/**
 * A regex-safe pattern matching a transaction's merchant, for a tap-to-set
 * rule. The location tail after " - ", the schedule marker and the instalment
 * programme words are dropped, so `KEELLS SUPER - COLOMBO` and a later
 * `KEELLS SUPER - GALLE` both match the one rule.
 */
export function merchantPattern(description: string): string {
  const head = description.split(/\s+[-\u2013]\s+/)[0] ?? description;
  const cleaned = head
    .replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g, ' ')
    .replace(/\bSP\s*\d{1,3}\s*of\s*\d{1,3}\b/gi, ' ')
    .replace(/\b(INSTAL?L?MENT|REPAYMENT|PROCESSING|FEES?|EASY\s*PAY)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const stem =
    cleaned.split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || head.trim() || description.trim();
  return stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Add or update a user rule so a transaction's merchant maps to `category`.
 * The rule goes first, so an explicit choice wins over the seeds, and an
 * existing user rule for the same merchant is updated rather than stacked.
 */
export function upsertMerchantRule(
  rules: readonly CategoryRule[],
  description: string,
  category: Category,
): CategoryRule[] {
  const pattern = merchantPattern(description);
  const index = rules.findIndex((r) => r.pattern === pattern && !r.seeded);
  if (index >= 0) {
    const next = [...rules];
    next[index] = { ...next[index]!, category, enabled: true };
    return next;
  }
  const rule: CategoryRule = {
    id: `u-${pattern}-${Date.now().toString(36)}`,
    pattern,
    category,
    enabled: true,
  };
  return [rule, ...rules];
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
  const totals = new Map<Category, { amount: Money; count: number }>();
  const months = new Map<string, Money>();
  let grandTotal = 0;

  forEachSpend(statements, rules, reversals, register, view, (category, date, amount) => {
    const entry = totals.get(category) ?? { amount: 0, count: 0 };
    entry.amount = roundMoney(entry.amount + amount);
    entry.count += 1;
    totals.set(category, entry);
    const month = monthKey(date);
    months.set(month, roundMoney((months.get(month) ?? 0) + amount));
    grandTotal = roundMoney(grandTotal + amount);
  });

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

/**
 * The one definition of what counts as spend, shared by every category view, so
 * a snapshot total and a monthly trend can never disagree about which lines are
 * in. A reversed debit is only spending if it was re-booked as a plan: a
 * purchase reversed and financed still happened; a surcharge levied and refunded
 * did not. In the economic view the financed purchase is counted once, at
 * origination, so its repayments and recurring fee are skipped; in the cash view
 * the origination (reversed off the account) is skipped and the repayments are
 * what counts.
 */
function forEachSpend(
  statements: readonly Statement[],
  rules: readonly CompiledRule[],
  reversals: ReversalAnalysis,
  register: InstallmentRegister,
  view: SpendView,
  visit: (category: Category, date: IsoDate, amount: Money) => void,
): void {
  const planOriginations = new Set(
    register.plans
      .map((p) => p.originationTxnId)
      .filter((id): id is string => id !== undefined),
  );

  for (const statement of statements) {
    for (const txn of statement.transactions) {
      if (txn.amount <= 0) continue;

      const wasReversed = reversals.byTxnId.has(txn.id);
      const isPlanOrigination = planOriginations.has(txn.id);
      if (wasReversed && !isPlanOrigination) continue;

      if (view === 'economic') {
        if (
          txn.classification === 'installment_repayment' ||
          txn.classification === 'installment_processing_fee'
        ) {
          continue;
        }
      } else if (isPlanOrigination) {
        continue;
      }

      visit(categoriseTxn(txn, rules), txn.postDate, txn.amount);
    }
  }
}

/** Per-category monthly spend, aligned to one shared month axis for trends. */
export interface CategoryMonthlySeries {
  /** Every month any category had spend, ascending -- the shared x-axis. */
  months: string[];
  /** Total spend per month, aligned to `months`. */
  monthlyTotal: Money[];
  /** One entry per category with spend, largest total first; `monthly` aligns to `months`. */
  series: { category: Category; total: Money; monthly: Money[] }[];
}

export function categoryMonthlySeries(
  statements: readonly Statement[],
  rules: readonly CompiledRule[],
  reversals: ReversalAnalysis,
  register: InstallmentRegister,
  view: SpendView,
): CategoryMonthlySeries {
  const byCategory = new Map<Category, Map<string, Money>>();
  const monthTotals = new Map<string, Money>();

  forEachSpend(statements, rules, reversals, register, view, (category, date, amount) => {
    const month = monthKey(date);
    monthTotals.set(month, roundMoney((monthTotals.get(month) ?? 0) + amount));
    const perMonth = byCategory.get(category) ?? new Map<string, Money>();
    perMonth.set(month, roundMoney((perMonth.get(month) ?? 0) + amount));
    byCategory.set(category, perMonth);
  });

  const months = [...monthTotals.keys()].sort((a, b) => a.localeCompare(b));
  const monthlyTotal = months.map((month) => monthTotals.get(month) ?? 0);
  const series = [...byCategory.entries()]
    .map(([category, perMonth]) => {
      const monthly = months.map((month) => perMonth.get(month) ?? 0);
      return { category, total: roundMoney(monthly.reduce((a, b) => a + b, 0)), monthly };
    })
    .sort((a, b) => b.total - a.total);

  return { months, monthlyTotal, series };
}

/** Total spend on a single calendar day. */
export interface DailySpendPoint {
  date: IsoDate;
  amount: Money;
}

/**
 * Spend per calendar day across every loaded statement, as a *continuous* range
 * from the first day with spend to the last. The empty days in between are kept
 * (amount 0), so a gap in spending shows as a gap on the time axis rather than
 * two bars collapsing next to each other on an uneven one.
 */
export function dailySpend(
  statements: readonly Statement[],
  rules: readonly CompiledRule[],
  reversals: ReversalAnalysis,
  register: InstallmentRegister,
  view: SpendView,
): DailySpendPoint[] {
  const byDay = new Map<string, Money>();
  forEachSpend(statements, rules, reversals, register, view, (_category, date, amount) => {
    byDay.set(date, roundMoney((byDay.get(date) ?? 0) + amount));
  });
  if (byDay.size === 0) return [];

  const days = [...byDay.keys()].sort((a, b) => a.localeCompare(b));
  const out: DailySpendPoint[] = [];
  for (let day = days[0]!; day <= days[days.length - 1]!; day = addDays(day, 1)) {
    out.push({ date: day, amount: byDay.get(day) ?? 0 });
  }
  return out;
}
