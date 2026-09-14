import type { Portfolio } from '@/analysis/portfolio';
import type { Anomaly } from '@/analysis/anomalies';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { Button, Chip, EmptyState, Panel, PanelHeader, Stat, type Tone } from '../primitives';
import { DecompositionChart } from '../charts';
import { ISSUER_LABEL } from '@/domain/types';

export function OverviewView({
  portfolio,
  dismissed,
  onDismiss,
  onGoToUpload,
}: {
  portfolio: Portfolio;
  dismissed: ReadonlySet<string>;
  onDismiss: (id: string) => void;
  onGoToUpload: () => void;
}) {
  if (portfolio.isEmpty) {
    return (
      <EmptyState
        title="No statements loaded"
        action={
          <Button variant="primary" onClick={onGoToUpload}>
            Add statements
          </Button>
        }
      >
        Load a statement and this page shows your position per card, what you are contracted to pay,
        and anything in the figures that looks wrong.
      </EmptyState>
    );
  }

  const { reconciliationSummary: recon, register, reversals } = portfolio;
  const live = portfolio.anomalies.filter((a) => !dismissed.has(a.id));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Statement balance"
          value={formatMoney(portfolio.statementBalance)}
          hint={`Latest closing balance across ${portfolio.positions.length} card${portfolio.positions.length === 1 ? '' : 's'}`}
        />
        <Stat
          label="True obligation"
          value={formatMoney(portfolio.trueObligation)}
          hint="Statement balance plus instalments still contracted but not yet billed"
        />
        <Stat
          label="Monthly instalments"
          value={formatMoney(register.monthlyObligation)}
          hint={`${register.plans.filter((p) => p.remaining > 0).length} live plan(s), repayment and recurring fee together`}
        />
        <Stat
          label="Run rate"
          value={formatMoney(portfolio.monthlyRunRate)}
          hint={`Mean true charges per cycle across ${portfolio.statements.length} cycle(s)`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Stat
          label="Cycles reconciling"
          value={`${recon.passed} of ${recon.total}`}
          tone={recon.failed.length === 0 ? 'good' : 'critical'}
          unit={null}
          hint={
            recon.failed.length === 0
              ? 'Every loaded cycle satisfies opening + charges − payments = closing'
              : `${recon.failed.length} cycle(s) do not balance — see Cycles`
          }
        />
        <Stat
          label="Reversals removed"
          value={formatMoney(reversals.matchedReversals)}
          hint={`Gross debits ${formatMoney(reversals.grossDebits)} less reversals gives true charges of ${formatMoney(reversals.trueCharges)}`}
        />
        <Stat
          label="Cost of credit"
          value={
            register.pricedCount === 0
              ? 'n/a'
              : `${register.zeroCostCount} of ${register.pricedCount} at 0%`
          }
          unit={null}
          tone={register.totalFinancingCost > 0 ? 'warning' : 'good'}
          hint={
            register.pricedCount === 0
              ? 'No plan origination was observed, so no plan can be priced. Load the earlier cycles to price them.'
              : `${formatMoney(register.totalFinancingCost)} of financing cost across the priced plans`
          }
        />
      </div>

      <Panel>
        <PanelHeader
          title="Position by card"
          subtitle="Closing balance of the most recent loaded cycle on each card"
        />
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Latest cycle</th>
                <th>Due</th>
                <th className="right">Balance</th>
                <th className="right">Limit</th>
                <th className="right">Used</th>
                <th className="right">Rate</th>
                <th className="right">Min due</th>
                <th>Chain</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.positions.map((p) => (
                <tr key={`${p.issuer}:${p.accountMask}`}>
                  <td className="font-medium whitespace-nowrap">
                    {ISSUER_LABEL[p.issuer]} ····{p.accountMask}
                  </td>
                  <td className="whitespace-nowrap" style={{ color: 'var(--ink-secondary)' }}>
                    {formatDate(p.latestStatementDate)}
                  </td>
                  <td className="whitespace-nowrap" style={{ color: 'var(--ink-secondary)' }}>
                    {p.paymentDueDate ? formatDate(p.paymentDueDate) : '—'}
                  </td>
                  <td className="num right font-medium">{formatMoney(p.currentBalance)}</td>
                  <td className="num right">{formatMoney(p.creditLimit)}</td>
                  <td className="num right">
                    {p.utilisation === undefined ? '—' : `${(p.utilisation * 100).toFixed(1)}%`}
                  </td>
                  <td className="num right">{(p.interestRateAnnual * 100).toFixed(2)}%</td>
                  <td className="num right">{formatMoney(p.minimumPayment)}</td>
                  <td>
                    {p.hasGap ? (
                      <Chip tone="serious">gap</Chip>
                    ) : p.cycleCount > 1 ? (
                      <Chip tone="good">{p.cycleCount} cycles</Chip>
                    ) : (
                      <Chip>single cycle</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {portfolio.decomposition.length > 0 ? (
        <DecompositionChart
          data={portfolio.decomposition.map((d) => ({
            label: `${d.accountMask} ${d.statementDate.slice(2, 7)}`,
            instalments: d.instalments,
            everyday: d.everyday,
            feesAndInterest: d.feesAndInterest,
          }))}
        />
      ) : null}

      <AnomalyList anomalies={live} onDismiss={onDismiss} total={portfolio.anomalies.length} />
    </div>
  );
}

const SEVERITY_TONE: Record<Anomaly['severity'], Tone> = {
  critical: 'critical',
  serious: 'serious',
  warning: 'warning',
  info: 'neutral',
};

function AnomalyList({
  anomalies,
  onDismiss,
  total,
}: {
  anomalies: Anomaly[];
  onDismiss: (id: string) => void;
  total: number;
}) {
  return (
    <Panel>
      <PanelHeader
        title="What looks wrong"
        subtitle={
          total === 0
            ? 'Nothing flagged in the loaded statements'
            : `${anomalies.length} open of ${total} found · dismissing one hides it for this session only`
        }
      />
      <div className="p-4">
        {anomalies.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {total === 0
              ? 'Every cycle balances, the balance chain is unbroken, and no credit is unexplained.'
              : 'Every finding has been dismissed for this session.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {anomalies.map((a) => (
              <li
                key={a.id}
                className="rounded-md px-3 py-2.5"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-sunken)' }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Chip tone={SEVERITY_TONE[a.severity]}>{a.severity}</Chip>
                    <span className="text-[12.5px] font-semibold">{a.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.amount !== undefined ? (
                      <span className="num text-[12px] font-medium">{formatMoney(a.amount)}</span>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => onDismiss(a.id)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
                <p
                  className="mt-1 text-[11.5px] leading-relaxed"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {a.detail}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
