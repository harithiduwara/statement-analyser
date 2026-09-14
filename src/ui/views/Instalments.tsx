import { useState } from 'react';
import type { Portfolio } from '@/analysis/portfolio';
import type { InstallmentPlan } from '@/analysis/installments';
import { formatMoney } from '@/lib/money';
import { formatMonthKey } from '@/lib/dates';
import { Chip, EmptyState, Panel, PanelHeader } from '../primitives';
import { RankedBarChart } from '../charts';

type SortKey = 'remainingValue' | 'monthly' | 'costOfCredit' | 'remaining' | 'merchant';

export function InstalmentsView({ portfolio }: { portfolio: Portfolio }) {
  const [sort, setSort] = useState<SortKey>('remainingValue');
  const { register } = portfolio;

  if (register.plans.length === 0) {
    return (
      <EmptyState title="No instalment plans found">
        A plan is recognised from a schedule marker in the description — <code>1/36</code>, or
        Seylan&rsquo;s <code>SP 010 of 036</code>. None of the loaded statements carries one.
      </EmptyState>
    );
  }

  const sorted = [...register.plans].sort((a, b) => compare(a, b, sort));
  const live = sorted.filter((p) => p.remaining > 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Plans" value={String(register.plans.length)} hint={`${live.length} still running`} />
        <Metric label="Monthly obligation" value={formatMoney(register.monthlyObligation)} hint="Repayment plus recurring fee" />
        <Metric label="Remaining contracted" value={formatMoney(register.totalRemaining)} hint="Monthly × months left, across live plans" />
        <Metric
          label="Financing cost"
          value={register.pricedCount === 0 ? 'n/a' : formatMoney(register.totalFinancingCost)}
          hint={
            register.pricedCount === 0
              ? 'No origination observed, so nothing can be priced'
              : `${register.zeroCostCount} of ${register.pricedCount} priced plans are at exactly 0%`
          }
        />
      </div>

      {register.pricedCount > 0 && register.zeroCostCount < register.pricedCount ? (
        <div
          className="panel px-4 py-3 text-[12px] leading-relaxed"
          style={{ borderColor: 'var(--warning)' }}
        >
          <b>{register.zeroCostCount} of {register.pricedCount}</b> priced plans cost nothing to
          carry. The {register.pricedCount - register.zeroCostCount} that do not are the entire
          financing cost of this book — {formatMoney(register.totalFinancingCost)}. They are
          highlighted below.
        </div>
      ) : null}

      {live.length > 0 ? (
        <RankedBarChart
          title="What is left to pay, by plan"
          unit="LKR still contracted"
          note="monthly instalment × months remaining"
          data={live.slice(0, 14).map((p) => ({
            label: truncate(p.merchant, 26),
            value: p.remainingValue,
            highlight: (p.costOfCredit ?? 0) > 1e-6,
          }))}
          highlightNote="carries a financing cost"
        />
      ) : null}

      <Panel>
        <PanelHeader
          title="Plan register"
          subtitle="Keyed by merchant and term count, across every loaded cycle. Two plans at the same merchant over different terms stay separate."
        />
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <SortHeader label="Merchant" k="merchant" sort={sort} onSort={setSort} />
                <th>Issuer</th>
                <th className="right">Progress</th>
                <SortHeader label="Monthly" k="monthly" sort={sort} onSort={setSort} right />
                <SortHeader label="Left" k="remaining" sort={sort} onSort={setSort} right />
                <SortHeader label="Remaining value" k="remainingValue" sort={sort} onSort={setSort} right />
                <th className="right">Total payable</th>
                <th className="right">Principal</th>
                <SortHeader label="Cost of credit" k="costOfCredit" sort={sort} onSort={setSort} right />
                <th>Final payment</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">
                    {p.merchant}
                    {p.planCode ? (
                      <span className="ml-1.5 font-mono text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                        {p.planCode.replace(/^[a-z]+:/, '')}
                      </span>
                    ) : null}
                    {p.predecessorId ? (
                      <span className="ml-1.5">
                        <Chip tone="warning" dot={false}>restructured</Chip>
                      </span>
                    ) : null}
                  </td>
                  <td style={{ color: 'var(--ink-secondary)' }}>{p.issuer}</td>
                  <td className="num right" style={{ color: 'var(--ink-secondary)' }}>
                    {p.latestInstallment}/{p.termCount}
                  </td>
                  <td
                    className="num right font-medium"
                    title={`Repayment ${formatMoney(p.monthlyRepayment)} + fee ${formatMoney(p.monthlyFee)}`}
                  >
                    {formatMoney(p.monthly)}
                  </td>
                  <td className="num right">{p.remaining}</td>
                  <td className="num right">{formatMoney(p.remainingValue)}</td>
                  <td className="num right">{formatMoney(p.totalPayable)}</td>
                  <td className="num right">
                    {p.originalPrincipal === undefined ? (
                      <span style={{ color: 'var(--ink-muted)' }}>not observed</span>
                    ) : (
                      formatMoney(p.originalPrincipal)
                    )}
                  </td>
                  <td className="num right">
                    {p.costOfCredit === undefined ? (
                      <span
                        style={{ color: 'var(--ink-muted)' }}
                        title="The origination was not in any loaded statement, so the principal is unknown. Inferring one from the schedule would just return the rate assumed."
                      >
                        n/a
                      </span>
                    ) : Math.abs(p.costOfCredit) < 1e-6 ? (
                      <Chip tone="good" dot={false}>0.0%</Chip>
                    ) : (
                      <b style={{ color: 'var(--series-2)' }}>
                        {(p.costOfCredit * 100).toFixed(1)}%
                      </b>
                    )}
                  </td>
                  <td className="whitespace-nowrap" style={{ color: 'var(--ink-secondary)' }}>
                    {p.remaining === 0 ? 'settled' : formatMonthKey(p.finalPaymentMonth)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="px-1 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        The monthly figure folds the recurring processing fee into the instalment — a plan billed as
        two lines is one obligation. Hover a monthly figure to see the split. Where the origination
        predates the earliest loaded statement the principal is unknown and cost of credit reads
        n/a; it is never inferred from the schedule.
      </p>
    </div>
  );
}

function compare(a: InstallmentPlan, b: InstallmentPlan, key: SortKey): number {
  switch (key) {
    case 'merchant':
      return a.merchant.localeCompare(b.merchant);
    case 'monthly':
      return b.monthly - a.monthly;
    case 'remaining':
      return b.remaining - a.remaining;
    case 'costOfCredit':
      // Unpriced plans sort last: "unknown" is not "cheapest".
      return (b.costOfCredit ?? -1) - (a.costOfCredit ?? -1);
    default:
      return b.remainingValue - a.remainingValue;
  }
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  right,
}: {
  label: string;
  k: SortKey;
  sort: SortKey;
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = sort === k;
  return (
    <th className={right ? 'right' : ''}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 uppercase tracking-[0.06em]"
        style={{ color: active ? 'var(--accent)' : 'inherit', font: 'inherit' }}
      >
        {label}
        <span aria-hidden style={{ opacity: active ? 1 : 0.3 }}>↓</span>
      </button>
    </th>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel px-4 py-3">
      <div
        className="text-[10.5px] font-semibold uppercase tracking-[0.07em]"
        style={{ color: 'var(--ink-muted)' }}
      >
        {label}
      </div>
      <div className="mt-1.5 text-[20px] font-semibold leading-none">{value}</div>
      <div className="mt-1.5 text-[11.5px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
        {hint}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
