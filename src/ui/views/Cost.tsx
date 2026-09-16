import type { Portfolio } from '@/analysis/portfolio';
import { formatMoney } from '@/lib/money';
import { formatPercent } from '@/lib/finance';
import { ISSUER_LABEL } from '@/domain/types';
import { Chip, EmptyState, Panel, PanelHeader, Stat } from '../primitives';
import { RankedBarChart } from '../charts';

/**
 * Cost of borrowing. Two moves a headline figure cannot make on its own:
 * restate the printed (nominal) interest rate as the effective rate it costs
 * once compounded, and restate every instalment plan's cost as an annual rate
 * so plans of different terms can finally be compared.
 */
export function CostView({ portfolio }: { portfolio: Portfolio }) {
  const { borrowingCost: bc } = portfolio;

  if (portfolio.isEmpty) {
    return (
      <EmptyState title="Nothing to cost yet">
        Load a statement and this page prices what the card costs to carry, and what each
        instalment plan really charges once its term is annualised.
      </EmptyState>
    );
  }

  const dearestCard = bc.cards[0];
  const financed = bc.pricedPlans.filter((p) => (p.effectiveApr ?? 0) > 0.005);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Annual carry cost"
          value={formatMoney(bc.annualisedCost)}
          hint={`Every card cost, annualised from ${bc.cycleCount} cycle${bc.cycleCount === 1 ? '' : 's'}`}
        />
        <Stat
          label="Carry cost"
          value={bc.carryCostRatio === undefined ? 'n/a' : formatPercent(bc.carryCostRatio)}
          unit={null}
          tone={bc.carryCostRatio !== undefined && bc.carryCostRatio > 0.02 ? 'warning' : undefined}
          hint="Of every 100 spent, this much is lost to interest and fees"
        />
        <Stat
          label="Effective card rate"
          value={dearestCard ? formatPercent(dearestCard.effectiveAnnualRate) : 'n/a'}
          unit={null}
          hint={
            dearestCard
              ? `${ISSUER_LABEL[dearestCard.issuer]} prints ${formatPercent(dearestCard.printedAnnualRate)} nominal`
              : undefined
          }
        />
        <Stat
          label="Dearest plan APR"
          value={
            bc.dearestPlan?.effectiveApr === undefined
              ? 'n/a'
              : formatPercent(bc.dearestPlan.effectiveApr)
          }
          unit={null}
          tone={bc.dearestPlan?.effectiveApr && bc.dearestPlan.effectiveApr > 0.005 ? 'warning' : undefined}
          hint={bc.dearestPlan ? bc.dearestPlan.merchant : 'No plan origination observed'}
        />
      </div>

      <Panel>
        <PanelHeader
          title="All-in cost of the card"
          subtitle={
            bc.carryCostRatio === undefined
              ? 'Every cost the card imposed across the loaded cycles, net of reversals'
              : `${formatMoney(bc.totalCost)} across ${bc.cycleCount} cycle${bc.cycleCount === 1 ? '' : 's'} — ${formatPercent(bc.carryCostRatio)} of everything spent`
          }
        />
        <div className="overflow-x-auto">
          {bc.components.length === 0 ? (
            <p className="p-4 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              No interest or fees in the loaded cycles. Nothing was charged for carrying or
              financing.
            </p>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Cost</th>
                  <th className="right">Total charged</th>
                  <th className="right">Annualised</th>
                  <th className="right">Share</th>
                </tr>
              </thead>
              <tbody>
                {bc.components.map((c) => (
                  <tr key={c.key}>
                    <td className="font-medium">{c.label}</td>
                    <td className="num right">{formatMoney(c.amount)}</td>
                    <td className="num right" style={{ color: 'var(--ink-secondary)' }}>
                      {formatMoney(
                        bc.cycleCount === 0 ? 0 : Math.round((c.amount / bc.cycleCount) * 12 * 100) / 100,
                      )}
                    </td>
                    <td className="num right" style={{ color: 'var(--ink-secondary)' }}>
                      {bc.totalCost === 0 ? '—' : formatPercent(c.amount / bc.totalCost)}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                  <td className="font-semibold">Total</td>
                  <td className="num right font-semibold">{formatMoney(bc.totalCost)}</td>
                  <td className="num right font-semibold">{formatMoney(bc.annualisedCost)}</td>
                  <td className="num right" style={{ color: 'var(--ink-muted)' }}>100%</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Carrying a balance"
          subtitle="The printed rate is nominal; the effective rate is what it costs once compounded monthly"
        />
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Card</th>
                <th className="right">Printed (nominal)</th>
                <th className="right">Monthly</th>
                <th className="right">Effective annual</th>
                <th className="right">Interest charged</th>
              </tr>
            </thead>
            <tbody>
              {bc.cards.map((c) => (
                <tr key={`${c.issuer}:${c.accountMask}`}>
                  <td className="font-medium whitespace-nowrap">
                    {ISSUER_LABEL[c.issuer]} ····{c.accountMask}
                  </td>
                  <td className="num right">{formatPercent(c.printedAnnualRate)}</td>
                  <td className="num right" style={{ color: 'var(--ink-secondary)' }}>
                    {formatPercent(c.monthlyRate, 2)}
                  </td>
                  <td className="num right font-medium" style={{ color: 'var(--series-2)' }}>
                    {formatPercent(c.effectiveAnnualRate)}
                  </td>
                  <td className="num right">{formatMoney(c.interestCharged)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {financed.length > 0 ? (
        <RankedBarChart
          title="What each plan really costs, as an annual rate"
          unit="% effective APR"
          note="term-normalised, so plans of different lengths are comparable"
          highlightNote="carries a financing cost"
          data={bc.pricedPlans.slice(0, 14).map((p) => ({
            label: truncate(p.merchant, 26),
            value: Math.round((p.effectiveApr ?? 0) * 100 * 10) / 10,
            highlight: (p.effectiveApr ?? 0) > 0.005,
          }))}
        />
      ) : null}

      <Panel>
        <PanelHeader
          title="Plan cost of borrowing"
          subtitle="Total cost is over the whole term; effective APR restates it per year, so a short low-fee plan and a long one compare honestly"
        />
        <div className="overflow-x-auto">
          {bc.pricedPlans.length === 0 ? (
            <p className="p-4 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              No plan origination was observed in the loaded statements, so no plan can be priced.
              Load the earlier cycles that opened these plans to price them.
            </p>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th className="right">Term</th>
                  <th className="right">Principal</th>
                  <th className="right">Total payable</th>
                  <th className="right">Total cost</th>
                  <th className="right">Nominal APR</th>
                  <th className="right">Effective APR</th>
                </tr>
              </thead>
              <tbody>
                {bc.pricedPlans.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.merchant}</td>
                    <td className="num right" style={{ color: 'var(--ink-secondary)' }}>
                      {p.termCount} mo
                    </td>
                    <td className="num right">
                      {p.originalPrincipal === undefined ? '—' : formatMoney(p.originalPrincipal)}
                    </td>
                    <td className="num right">{formatMoney(p.totalPayable)}</td>
                    <td className="num right" style={{ color: 'var(--ink-secondary)' }}>
                      {p.costOfCredit === undefined ? '—' : formatPercent(p.costOfCredit)}
                    </td>
                    <td className="num right" style={{ color: 'var(--ink-secondary)' }}>
                      {p.nominalApr === undefined ? '—' : formatPercent(p.nominalApr)}
                    </td>
                    <td className="num right">
                      {p.effectiveApr === undefined ? (
                        <span style={{ color: 'var(--ink-muted)' }}>n/a</span>
                      ) : p.effectiveApr < 0.005 ? (
                        <Chip tone="good" dot={false}>0.0%</Chip>
                      ) : (
                        <b style={{ color: 'var(--series-2)' }}>{formatPercent(p.effectiveApr)}</b>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
