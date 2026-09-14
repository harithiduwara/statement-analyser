import { useMemo, useState } from 'react';
import type { Portfolio } from '@/analysis/portfolio';
import { buildForwardSchedule, settlementImpact } from '@/analysis/forward';
import { formatMoney } from '@/lib/money';
import { formatMonthKey } from '@/lib/dates';
import { Chip, EmptyState, Panel, PanelHeader, Stat } from '../primitives';
import { CumulativeOutflowChart, ForwardCurveChart } from '../charts';

export function ForwardView({ portfolio }: { portfolio: Portfolio }) {
  const [settled, setSettled] = useState<string[]>([]);
  const live = portfolio.register.plans.filter((p) => p.remaining > 0);

  const schedule = useMemo(
    () => buildForwardSchedule(portfolio.register, { settleNow: settled }),
    [portfolio.register, settled],
  );
  const baseline = portfolio.forward;

  if (live.length === 0) {
    return (
      <EmptyState title="Nothing left to project">
        The forward schedule projects each live instalment plan month by month. No loaded plan has
        payments remaining.
      </EmptyState>
    );
  }

  const data = schedule.months.map((m) => ({
    month: m.month,
    total: m.total,
    cumulative: m.cumulative,
  }));
  const retiring = schedule.months.flatMap((m) =>
    m.retiring.map((r) => ({ month: m.month, label: r.merchant, monthly: r.monthly })),
  );

  const relief = settled.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Next month"
          value={formatMoney(schedule.openingMonthly)}
          hint={
            relief
              ? `Baseline ${formatMoney(baseline.openingMonthly)} before settling ${settled.length} plan(s)`
              : 'Total instalment obligation in the first projected month'
          }
        />
        <Stat
          label="Total outflow"
          value={formatMoney(schedule.totalOutflow)}
          hint={
            relief
              ? `Baseline ${formatMoney(baseline.totalOutflow)}`
              : 'Every projected payment, summed'
          }
        />
        <Stat
          label="Last payment"
          value={schedule.finalMonth ? formatMonthKey(schedule.finalMonth) : '—'}
          unit={null}
          hint={`${schedule.months.length} month(s) projected`}
        />
        <Stat
          label="Plans retiring"
          value={String(retiring.length)}
          unit={null}
          hint="Each is a step down in the curve"
        />
      </div>

      <ForwardCurveChart data={data} markers={retiring.map((r) => ({ month: r.month, label: r.label }))} />
      <CumulativeOutflowChart data={data} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="What if a plan were settled today"
            subtitle="Select plans to remove them from the projection. A 0% plan costs nothing to carry, so settling it frees cash without saving anything."
          />
          <div className="max-h-[360px] overflow-y-auto p-3">
            <ul className="space-y-1.5">
              {live.map((plan) => {
                const impact = settlementImpact(plan);
                const on = settled.includes(plan.id);
                return (
                  <li key={plan.id}>
                    <label
                      className="flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2"
                      style={{
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                        background: on ? 'var(--surface-sunken)' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setSettled((prev) =>
                            prev.includes(plan.id)
                              ? prev.filter((id) => id !== plan.id)
                              : [...prev, plan.id],
                          )
                        }
                        className="mt-[3px]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="truncate text-[12px] font-medium">{plan.merchant}</span>
                          <span className="num text-[12px]">{formatMoney(impact.remainingValue)}</span>
                        </span>
                        <span
                          className="mt-0.5 block text-[11px]"
                          style={{ color: 'var(--ink-muted)' }}
                        >
                          {impact.monthsRemaining} month(s) left · frees{' '}
                          {formatMoney(impact.monthlyRelief)}/month ·{' '}
                          {impact.financingAvoided > 0.005
                            ? `avoids ${formatMoney(impact.financingAvoided)} of financing`
                            : plan.costOfCredit === undefined
                              ? 'financing cost unknown'
                              : 'no financing avoided (0% plan)'}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Months a plan retires"
            subtitle="The month cash frees up, and by how much"
          />
          <div className="max-h-[360px] overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Plan</th>
                  <th className="right">Frees per month</th>
                </tr>
              </thead>
              <tbody>
                {retiring.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--ink-muted)' }}>
                      No plan retires inside the projected window.
                    </td>
                  </tr>
                ) : (
                  retiring.map((r, i) => (
                    <tr key={`${r.month}-${r.label}-${i}`}>
                      <td className="whitespace-nowrap font-medium">{formatMonthKey(r.month)}</td>
                      <td>{r.label}</td>
                      <td className="num right">{formatMoney(r.monthly)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {relief ? (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <Chip tone="accent">what-if active</Chip>
          <span className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
            {settled.length} plan(s) treated as settled. The charts above show the adjusted
            projection, not your contracted schedule.
          </span>
        </div>
      ) : null}
    </div>
  );
}
