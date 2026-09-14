import type { Portfolio } from '@/analysis/portfolio';
import { ISSUER_LABEL, type Issuer } from '@/domain/types';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { Chip, EmptyState, Panel, PanelHeader } from '../primitives';

/**
 * The reconciliation table, per issuer, with gap markers inline.
 *
 * A gap is rendered as a row between the two cycles it separates, rather than
 * as a footnote: the break belongs where the missing statement would have
 * been, and the implied movement is stated rather than interpolated away.
 */
export function CyclesView({ portfolio }: { portfolio: Portfolio }) {
  if (portfolio.isEmpty) {
    return (
      <EmptyState title="No cycles to reconcile">
        Each loaded statement is checked against opening + charges − payments = closing, and
        consecutive cycles are checked to see that one closes where the next opens.
      </EmptyState>
    );
  }

  const issuers = [...new Set(portfolio.statements.map((s) => s.issuer))];
  const recon = new Map(portfolio.reconciliations.map((r) => [r.statementId, r]));
  const gapAfter = new Map(portfolio.chain.gaps.map((g) => [g.previous.id, g]));
  const decomposition = new Map(portfolio.decomposition.map((d) => [d.statementId, d]));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary
          label="Cycles reconciling"
          value={`${portfolio.reconciliationSummary.passed} of ${portfolio.reconciliationSummary.total}`}
          tone={portfolio.reconciliationSummary.failed.length === 0 ? 'good' : 'critical'}
        />
        <Summary
          label="Balance-chain breaks"
          value={String(portfolio.chain.gaps.length)}
          tone={portfolio.chain.gaps.length === 0 ? 'good' : 'serious'}
        />
        <Summary
          label="Header vs line items"
          value={
            portfolio.reconciliationSummary.lineItemMismatches.length === 0
              ? 'agree'
              : `${portfolio.reconciliationSummary.lineItemMismatches.length} disagree`
          }
          tone={
            portfolio.reconciliationSummary.lineItemMismatches.length === 0 ? 'good' : 'warning'
          }
        />
      </div>

      {issuers.map((issuer) => (
        <Panel key={issuer}>
          <PanelHeader
            title={ISSUER_LABEL[issuer as Issuer]}
            subtitle="Every figure as printed. The check column is opening + charges − payments against the printed closing balance."
          />
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Statement</th>
                  <th>Card</th>
                  <th className="right">Opening</th>
                  <th className="right">Charges</th>
                  <th className="right">Payments</th>
                  <th className="right">Closing</th>
                  <th className="right">Difference</th>
                  <th>Check</th>
                  <th className="right">Instalments</th>
                  <th className="right">Everyday</th>
                  <th className="right">Fees &amp; int.</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.statements
                  .filter((s) => s.issuer === issuer)
                  .flatMap((statement) => {
                    const r = recon.get(statement.id);
                    const d = decomposition.get(statement.id);
                    const gap = gapAfter.get(statement.id);
                    const rows = [
                      <tr key={statement.id}>
                        <td className="whitespace-nowrap font-medium">
                          {formatDate(statement.statementDate)}
                        </td>
                        <td className="whitespace-nowrap" style={{ color: 'var(--ink-secondary)' }}>
                          ····{statement.accountMask}
                        </td>
                        <td className="num right">{formatMoney(statement.openingBalance)}</td>
                        <td className="num right">{formatMoney(statement.charges)}</td>
                        <td className="num right">{formatMoney(statement.payments)}</td>
                        <td className="num right font-medium">
                          {formatMoney(statement.closingBalance)}
                        </td>
                        <td className="num right">{r ? formatMoney(r.delta) : '—'}</td>
                        <td>
                          {r?.passes ? (
                            <Chip tone="good">exact</Chip>
                          ) : (
                            <Chip tone="critical">off</Chip>
                          )}
                        </td>
                        <td className="num right">{d ? formatMoney(d.instalments) : '—'}</td>
                        <td className="num right">{d ? formatMoney(d.everyday) : '—'}</td>
                        <td className="num right">{d ? formatMoney(d.feesAndInterest) : '—'}</td>
                      </tr>,
                    ];

                    if (r && !r.passes && r.hint) {
                      rows.push(
                        <tr key={`${statement.id}-hint`}>
                          <td colSpan={11} style={{ background: 'var(--surface-sunken)' }}>
                            <span
                              className="text-[11.5px] leading-relaxed"
                              style={{ color: 'var(--critical)' }}
                            >
                              {r.hint}
                            </span>
                          </td>
                        </tr>,
                      );
                    }

                    if (gap) {
                      rows.push(
                        <tr key={`${statement.id}-gap`}>
                          <td colSpan={11} style={{ background: 'var(--surface-sunken)' }}>
                            <div className="flex flex-wrap items-center gap-2 py-1">
                              <Chip tone="serious">statement missing</Chip>
                              <span className="text-[11.5px]" style={{ color: 'var(--ink-secondary)' }}>
                                This cycle closes at{' '}
                                <b className="num">{formatMoney(gap.previous.closingBalance)}</b> but the
                                next opens at{' '}
                                <b className="num">{formatMoney(gap.next.openingBalance)}</b>. About{' '}
                                {gap.estimatedMissingCycles} cycle(s) are unaccounted for between{' '}
                                {formatDate(gap.windowFrom)} and {formatDate(gap.windowTo)}, carrying{' '}
                                <b className="num">{formatMoney(gap.impliedMovement)}</b> of net
                                movement. Nothing has been interpolated.
                              </span>
                            </div>
                          </td>
                        </tr>,
                      );
                    }
                    return rows;
                  })}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'critical' | 'serious' | 'warning';
}) {
  return (
    <div className="panel flex items-center justify-between px-4 py-3">
      <span className="text-[11.5px]" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <Chip tone={tone}>{value}</Chip>
    </div>
  );
}
