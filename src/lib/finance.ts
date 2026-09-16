/**
 * Time-value-of-money primitives for the cost-of-borrowing analysis.
 *
 * Deliberately free of any domain type so the arithmetic can be tested in
 * isolation: an instalment plan is, financially, a loan -- a principal advanced
 * today against a stream of equal payments -- and the cost of that loan is a
 * property of the cash flows alone. Everything here is deterministic: a closed
 * form where one exists, bisection where it does not. A rate is always solved
 * for, never assumed, so it cannot drift the way a fitted model could.
 */

/**
 * Present value of an ordinary annuity: `payment` at the end of each of
 * `periods` periods, discounted at `rate` per period.
 *
 *     PV = payment * (1 - (1 + rate)^-periods) / rate
 *
 * At rate 0 this is the limit `payment * periods` -- the undiscounted sum.
 */
export function annuityPresentValue(payment: number, periods: number, rate: number): number {
  if (periods <= 0) return 0;
  if (rate === 0) return payment * periods;
  return (payment * (1 - Math.pow(1 + rate, -periods))) / rate;
}

/**
 * The periodic internal rate of return of a loan: `principal` advanced now,
 * repaid as `payment` at the end of each of `periods` periods. Returns the
 * per-period rate at which the payment stream discounts back to exactly the
 * principal.
 *
 * Undefined when the payments never repay the principal (their undiscounted
 * sum is below it): no non-negative rate then exists, and a negative one is not
 * a financing cost but a sign the payment and principal do not belong together.
 *
 * Solved by bisection, not Newton's method: present value is strictly
 * decreasing in the rate, so a single sign change brackets the unique root and
 * bisection converges without the divergence a Newton step can hit where the
 * gradient goes flat.
 */
export function annuityRate(
  principal: number,
  payment: number,
  periods: number,
): number | undefined {
  if (principal <= 0 || payment <= 0 || periods <= 0) return undefined;

  const total = payment * periods;
  if (total < principal) return undefined;
  if (Math.abs(total - principal) < 1e-9) return 0; // repaid exactly: free credit

  const excess = (rate: number): number =>
    annuityPresentValue(payment, periods, rate) - principal;

  // excess(0) > 0; present value falls towards 0 as the rate climbs, so the
  // excess must eventually turn negative. Grow the bound until it brackets.
  let hi = 0.05;
  let guard = 0;
  while (excess(hi) > 0 && guard < 80) {
    hi *= 2;
    guard += 1;
  }
  if (excess(hi) > 0) return undefined;

  let lo = 0;
  for (let k = 0; k < 200; k += 1) {
    const mid = (lo + hi) / 2;
    const e = excess(mid);
    if (Math.abs(e) < 1e-9) return mid;
    if (e > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The effective annual rate of a rate compounded `periodsPerYear` times:
 *
 *     EAR = (1 + periodic)^periodsPerYear - 1
 *
 * What a periodic rate truly costs across a year once each period's interest
 * itself bears interest. Always at or above the nominal figure (periodic x
 * periodsPerYear), and the gap is the compounding the nominal rate hides.
 */
export function effectiveAnnualRate(periodicRate: number, periodsPerYear = 12): number {
  return Math.pow(1 + periodicRate, periodsPerYear) - 1;
}

/** A rate as a percentage string: 0.2831 -> "28.3%". */
export function formatPercent(rate: number, dp = 1): string {
  return `${(rate * 100).toFixed(dp)}%`;
}
