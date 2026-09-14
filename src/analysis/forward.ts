import type { Money } from '@/domain/types';
import { addMonths } from '@/lib/dates';
import { roundMoney } from '@/lib/money';
import type { InstallmentPlan, InstallmentRegister } from './installments';

/**
 * Forward obligation schedule.
 *
 * Each plan pays `monthly` for its `remaining` months and nothing after:
 *
 *     payment(t) = t <= remaining ? monthly : 0
 *
 * Summed across plans this is a step-down curve, and the steps are the point:
 * each drop is a plan retiring, which is the month cash frees up.
 */

export interface ForwardMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Total due that month across every plan. */
  total: Money;
  /** Per-issuer breakdown. */
  byIssuer: Record<string, Money>;
  /** Running sum from the first projected month. */
  cumulative: Money;
  /** Plans making their final payment this month. */
  retiring: { id: string; merchant: string; monthly: Money }[];
}

export interface ForwardSchedule {
  months: ForwardMonth[];
  /** The month the last plan retires, or undefined when there are none. */
  finalMonth?: string;
  /** Sum of every projected payment. */
  totalOutflow: Money;
  /** The obligation in the first projected month. */
  openingMonthly: Money;
}

export interface ForwardOptions {
  /** Month the projection starts from, `YYYY-MM`. Defaults to the latest seen. */
  startMonth?: string;
  /** Plan ids to treat as settled today -- the what-if control. */
  settleNow?: readonly string[];
  /** Hard cap on projected months, so a bad term cannot run away. */
  maxMonths?: number;
}

export function buildForwardSchedule(
  register: InstallmentRegister,
  options: ForwardOptions = {},
): ForwardSchedule {
  const settled = new Set(options.settleNow ?? []);
  const live = register.plans.filter((p) => p.remaining > 0 && !settled.has(p.id));

  const horizon = Math.min(
    options.maxMonths ?? 120,
    live.reduce((max, p) => Math.max(max, p.remaining), 0),
  );
  if (horizon === 0) {
    return { months: [], totalOutflow: 0, openingMonthly: 0 };
  }

  const start = options.startMonth ?? latestMonth(live);
  const months: ForwardMonth[] = [];
  let cumulative = 0;

  for (let t = 1; t <= horizon; t += 1) {
    const byIssuer: Record<string, Money> = {};
    const retiring: ForwardMonth['retiring'] = [];
    let total = 0;

    for (const plan of live) {
      if (t > plan.remaining) continue;
      total += plan.monthly;
      byIssuer[plan.issuer] = roundMoney((byIssuer[plan.issuer] ?? 0) + plan.monthly);
      if (t === plan.remaining) {
        retiring.push({ id: plan.id, merchant: plan.merchant, monthly: plan.monthly });
      }
    }

    total = roundMoney(total);
    cumulative = roundMoney(cumulative + total);
    months.push({ month: addMonths(start, t), total, byIssuer, cumulative, retiring });
  }

  return {
    months,
    finalMonth: months[months.length - 1]?.month,
    totalOutflow: cumulative,
    openingMonthly: months[0]?.total ?? 0,
  };
}

function latestMonth(plans: readonly InstallmentPlan[]): string {
  return plans.reduce((max, p) => (p.latestMonth > max ? p.latestMonth : max), '1970-01');
}

/**
 * What settling a plan today is worth: the payments it would have made, and
 * the month-on-month relief. Stated as contracted cash, not as a saving --
 * a 0% plan costs nothing to carry, so settling it early saves nothing at all.
 */
export interface SettlementImpact {
  planId: string;
  merchant: string;
  /** Cash still contracted on the plan. */
  remainingValue: Money;
  /** Monthly obligation freed. */
  monthlyRelief: Money;
  /** Interest genuinely avoided; zero for a 0% plan. */
  financingAvoided: Money;
  monthsRemaining: number;
}

export function settlementImpact(plan: InstallmentPlan): SettlementImpact {
  const costRate = plan.costOfCredit ?? 0;
  return {
    planId: plan.id,
    merchant: plan.merchant,
    remainingValue: plan.remainingValue,
    monthlyRelief: plan.monthly,
    // Only the financing portion of what is left is genuinely avoided.
    financingAvoided: roundMoney(
      (plan.remainingValue * costRate) / (1 + costRate || 1),
    ),
    monthsRemaining: plan.remaining,
  };
}
