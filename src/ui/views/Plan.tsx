import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import type { Portfolio } from '@/analysis/portfolio';
import { breakdownByCategory, compileRules, type CategoryRule } from '@/analysis/categories';
import { computePlan, type PlanLine, type SectionKey } from '@/domain/plan';
import type { usePlanStore } from '@/state/usePlanStore';
import { formatMoney, roundMoney } from '@/lib/money';
import { formatMonthKey } from '@/lib/dates';
import { Button, Chip, Panel, PanelHeader, Stat } from '../primitives';
import { DonutChart, compactLkr, type DonutDatum } from '../charts';

const SLICE_COLOR: Record<string, string> = {
  installments: 'var(--series-2)',
  recurring: 'var(--series-3)',
  bills: 'var(--series-1)',
  savings: 'var(--series-4)',
};

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function PlanView({
  portfolio,
  rules,
  store,
}: {
  portfolio: Portfolio;
  rules: CategoryRule[];
  store: ReturnType<typeof usePlanStore>;
}) {
  const { plan, month, update, prevMonth, nextMonth, startNextMonth } = store;

  // Committed outflows are seeded from the statements, not typed in: the
  // instalment obligation is exact, and subscriptions are the monthly average
  // of everything the classifier files under that category.
  const seed = useMemo(() => {
    const cardInstallments = portfolio.register.monthlyObligation;
    if (portfolio.isEmpty) return { cardInstallments: 0, subscriptions: 0, utilities: 0 };
    const breakdown = breakdownByCategory(
      portfolio.statements,
      compileRules(rules),
      portfolio.reversals,
      portfolio.register,
      'economic',
    );
    const months = Math.max(1, breakdown.byMonth.length);
    const perMonth = (category: string) =>
      roundMoney((breakdown.totals.find((t) => t.category === category)?.amount ?? 0) / months);
    return {
      cardInstallments,
      subscriptions: perMonth('subscriptions'),
      utilities: perMonth('utilities & telco'),
    };
  }, [portfolio, rules]);

  // A typical month from the statements -- the backward-looking figure the
  // forward plan is built against. Averaged from the per-cycle decomposition so
  // it splits the same way the Overview chart does.
  const typical = useMemo(() => {
    const cycles = portfolio.decomposition.length;
    if (cycles === 0) return null;
    const mean = (pick: (d: Portfolio['decomposition'][number]) => number) =>
      roundMoney(portfolio.decomposition.reduce((acc, d) => acc + pick(d), 0) / cycles);
    return {
      cycles,
      instalments: mean((d) => d.instalments),
      everyday: mean((d) => d.everyday),
      fees: mean((d) => d.feesAndInterest),
      total: portfolio.monthlyAverageSpend,
    };
  }, [portfolio.decomposition, portfolio.monthlyAverageSpend]);

  const summary = computePlan(plan, seed);

  const setLines = (key: SectionKey, lines: PlanLine[]) => update({ ...plan, [key]: lines });
  const addLine = (key: SectionKey) => setLines(key, [...plan[key], { id: uid(), label: '', amount: 0 }]);
  const editLine = (key: SectionKey, id: string, patch: Partial<PlanLine>) =>
    setLines(key, plan[key].map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (key: SectionKey, id: string) =>
    setLines(key, plan[key].filter((l) => l.id !== id));

  const donutData: DonutDatum[] = summary.where.map((w) => ({
    label: w.label,
    value: w.amount,
    color: SLICE_COLOR[w.key] ?? 'var(--ink-muted)',
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={prevMonth} title="Previous month">
            <ChevronLeft size={14} aria-hidden /> <span className="sr-only">Previous month</span>
          </Button>
          <span className="min-w-[9rem] text-center text-[13px] font-semibold">
            {formatMonthKey(month)}
          </span>
          <Button variant="ghost" size="sm" onClick={nextMonth} title="Next month">
            <span className="sr-only">Next month</span> <ChevronRight size={14} aria-hidden />
          </Button>
        </div>
        <Button size="sm" onClick={startNextMonth} title="Copy this plan into next month">
          Start next month <ChevronRight size={13} aria-hidden />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Take home"
          value={summary.hasIncome ? formatMoney(summary.takeHome) : '—'}
          hint={summary.hasIncome ? 'Income, less what is taken off the top' : 'Add your income below to begin'}
        />
        <Stat
          label="Spoken for"
          value={formatMoney(summary.spokenFor)}
          hint="Bills, instalments, subscriptions, utilities and savings"
        />
        <Stat
          label="Left to spend"
          value={summary.hasIncome ? formatMoney(summary.leftToSpend) : '—'}
          {...(summary.hasIncome ? { tone: summary.overCommitted ? 'critical' : 'good' } : {})}
          hint={
            summary.hasIncome
              ? summary.overCommitted
                ? 'The plan spends more than it takes in'
                : 'After everything spoken for'
              : 'Set your income to see what is left'
          }
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Section
            title="Money in"
            accent="var(--good)"
            total={summary.income}
            lines={plan.income}
            onAdd={() => addLine('income')}
            onEdit={(id, patch) => editLine('income', id, patch)}
            onRemove={(id) => removeLine('income', id)}
            withDay
            emptyHint="Add your salary or take-home pay here — the plan uses it to work out what is left to spend."
          />

          <Section
            title="Taken off the top"
            accent="var(--critical)"
            total={summary.deductions}
            lines={plan.deductions}
            onAdd={() => addLine('deductions')}
            onEdit={(id, patch) => editLine('deductions', id, patch)}
            onRemove={(id) => removeLine('deductions', id)}
          />

          <Panel>
            <PanelHeader
              title="Committed"
              subtitle="Card instalments and subscriptions are read from your statements"
              aside={<span className="num text-[13px] font-semibold">{formatMoney(summary.committed)}</span>}
            />
            <div className="p-4 pt-3">
              <SourcedRow label="Card instalments" amount={summary.cardInstallments} empty={portfolio.isEmpty} />
              <SourcedRow label="Subscriptions" amount={summary.subscriptions} empty={portfolio.isEmpty} />
              <SourcedRow label="Utilities & telco" amount={summary.utilities} empty={portfolio.isEmpty} />
              <div className="mt-3 mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em]" style={{ color: 'var(--ink-muted)' }}>
                Bills &amp; household
              </div>
              <LineList
                lines={plan.bills}
                onEdit={(id, patch) => editLine('bills', id, patch)}
                onRemove={(id) => removeLine('bills', id)}
              />
              <AddLine onClick={() => addLine('bills')} />
            </div>
          </Panel>

          <Section
            title="Savings & investments"
            accent="var(--series-4)"
            total={summary.savings}
            lines={plan.savings}
            onAdd={() => addLine('savings')}
            onEdit={(id, patch) => editLine('savings', id, patch)}
            onRemove={(id) => removeLine('savings', id)}
          />
        </div>

        <div className="space-y-3">
          {donutData.length > 0 ? (
            <div>
              <DonutChart
                title="Where it goes"
                unit="LKR per month"
                data={donutData}
                centerValue={
                  summary.hasIncome && summary.spokenForPct !== undefined
                    ? `${Math.round(summary.spokenForPct * 100)}%`
                    : compactLkr(summary.spokenFor)
                }
                note={summary.hasIncome ? 'of take-home spoken for' : 'per month spoken for'}
              />
              <ul className="mt-2 space-y-1.5 px-1">
                {summary.where.map((w) => (
                  <li key={w.key} className="flex items-center gap-2 text-[11.5px]">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: SLICE_COLOR[w.key] }} />
                    <span className="flex-1 truncate">{w.label}</span>
                    <span style={{ color: 'var(--ink-muted)' }}>{Math.round(w.share * 100)}%</span>
                    <span className="num w-24 text-right font-medium">{formatMoney(w.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {typical ? (
            <Panel>
              <PanelHeader
                title="A typical month"
                subtitle={`What goes out in an average month across ${typical.cycles} cycle${typical.cycles === 1 ? '' : 's'} on your statements`}
              />
              <div className="p-4 pt-3 text-[12px]">
                <TypicalRow label="Instalments" amount={typical.instalments} color="var(--series-1)" />
                <TypicalRow label="Everyday spending" amount={typical.everyday} color="var(--series-2)" />
                <TypicalRow label="Fees & interest" amount={typical.fees} color="var(--series-3)" />
                <div
                  className="mt-2 flex items-center justify-between border-t pt-2"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <span className="font-semibold">Goes out, a typical month</span>
                  <span className="num font-semibold">{formatMoney(typical.total)}</span>
                </div>
                <p className="mt-2.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                  {summary.hasIncome ? (
                    summary.takeHome >= typical.total ? (
                      <>
                        Your take-home of <b>{formatMoney(summary.takeHome)}</b> covers a typical
                        month, with <b>{formatMoney(summary.takeHome - typical.total)}</b> to spare.
                      </>
                    ) : (
                      <span style={{ color: 'var(--critical)' }}>
                        A typical month spends <b>{formatMoney(typical.total - summary.takeHome)}</b>{' '}
                        more than your take-home of {formatMoney(summary.takeHome)}.
                      </span>
                    )
                  ) : (
                    <>
                      To cover a typical month you need about <b>{formatMoney(typical.total)}</b>{' '}
                      coming in. Add your income above to check.
                    </>
                  )}
                </p>
              </div>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Worth knowing" />
            <div className="space-y-2 p-4 text-[12px] leading-relaxed">
              {portfolio.isEmpty ? (
                <p style={{ color: 'var(--ink-muted)' }}>
                  Load statements on the Upload page and your card instalments, subscriptions and
                  utilities fill in here automatically.
                </p>
              ) : !summary.hasIncome ? (
                <p style={{ color: 'var(--ink-secondary)' }}>
                  Add your monthly income above to see how much of it is already committed and what is
                  left to spend. The committed side is already filled in from your statements.
                </p>
              ) : (
                <>
                  <Insight
                    tone={summary.committedPct !== undefined && summary.committedPct > 1 ? 'critical' : 'neutral'}
                    value={summary.committedPct === undefined ? '—' : `${Math.round(summary.committedPct * 100)}%`}
                    text="of your take-home is already committed"
                  />
                  <Insight
                    tone="good"
                    value={summary.savingsPct === undefined ? '—' : `${Math.round(summary.savingsPct * 100)}%`}
                    text="is going to savings & investments"
                  />
                  {summary.overCommitted ? (
                    <p style={{ color: 'var(--critical)' }}>
                      This plan spends <b>{formatMoney(-summary.leftToSpend)}</b> more than it takes in.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <p className="px-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Your plan is saved on this device only, and &ldquo;Clear all data&rdquo; removes it.
      </p>
    </div>
  );
}

function Section({
  title,
  accent,
  total,
  lines,
  onAdd,
  onEdit,
  onRemove,
  withDay,
  emptyHint,
}: {
  title: string;
  accent: string;
  total: number;
  lines: PlanLine[];
  onAdd: () => void;
  onEdit: (id: string, patch: Partial<PlanLine>) => void;
  onRemove: (id: string) => void;
  withDay?: boolean;
  emptyHint?: string;
}) {
  return (
    <Panel className="overflow-hidden" style={{ borderLeft: `3px solid ${accent}` }}>
      <PanelHeader
        title={title}
        aside={<span className="num text-[13px] font-semibold">{formatMoney(total)}</span>}
      />
      <div className="p-4 pt-3">
        <LineList
          lines={lines}
          onEdit={onEdit}
          onRemove={onRemove}
          withDay={withDay}
          {...(emptyHint === undefined ? {} : { emptyHint })}
        />
        <AddLine onClick={onAdd} />
      </div>
    </Panel>
  );
}

function LineList({
  lines,
  onEdit,
  onRemove,
  withDay,
  emptyHint,
}: {
  lines: PlanLine[];
  onEdit: (id: string, patch: Partial<PlanLine>) => void;
  onRemove: (id: string) => void;
  withDay?: boolean;
  emptyHint?: string;
}) {
  if (lines.length === 0) {
    return (
      <p className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
        {emptyHint ?? 'Nothing here yet.'}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {lines.map((l) => (
        <div key={l.id} className="flex items-center gap-2">
          <input
            value={l.label}
            placeholder="Description"
            onChange={(e) => onEdit(l.id, { label: e.target.value })}
            className="min-w-0 flex-1 rounded-md px-2 py-1 text-[12px]"
            style={{ border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink)' }}
          />
          {withDay ? (
            <input
              type="number"
              min={1}
              max={31}
              value={l.day ?? ''}
              placeholder="day"
              aria-label="Day of month"
              onChange={(e) => onEdit(l.id, { day: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="num w-14 rounded-md px-2 py-1 text-[12px]"
              style={{ border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink)' }}
            />
          ) : null}
          <input
            type="number"
            inputMode="decimal"
            value={l.amount === 0 ? '' : l.amount}
            placeholder="0"
            aria-label="Amount"
            onChange={(e) => onEdit(l.id, { amount: e.target.value === '' ? 0 : Number(e.target.value) })}
            className="num w-28 rounded-md px-2 py-1 text-[12px]"
            style={{ border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink)' }}
          />
          <button
            type="button"
            onClick={() => onRemove(l.id)}
            aria-label={`Remove ${l.label || 'line'}`}
            className="shrink-0 rounded-md p-1"
            style={{ color: 'var(--ink-muted)' }}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

function AddLine({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium"
      style={{ color: 'var(--accent)' }}
    >
      <Plus size={12} aria-hidden /> Add a line
    </button>
  );
}

function SourcedRow({ label, amount, empty }: { label: string; amount: number; empty: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[12px]">{label}</span>
      <Chip tone="accent" dot={false}>from statements</Chip>
      <span className="num ml-auto text-[12px] font-medium">
        {empty ? <span style={{ color: 'var(--ink-muted)' }}>—</span> : formatMoney(amount)}
      </span>
    </div>
  );
}

function Insight({ tone, value, text }: { tone: 'neutral' | 'good' | 'critical'; value: string; text: string }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'critical' ? 'var(--critical)' : 'var(--ink)';
  return (
    <p>
      <b className="num" style={{ color }}>{value}</b> <span style={{ color: 'var(--ink-secondary)' }}>{text}</span>
    </p>
  );
}

function TypicalRow({ label, amount, color }: { label: string; amount: number; color: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
      <span>{label}</span>
      <span className="num ml-auto font-medium">{formatMoney(amount)}</span>
    </div>
  );
}
