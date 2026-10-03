import { useMemo, useState } from 'react';
import type { Portfolio } from '@/analysis/portfolio';
import type { AnomalySeverity } from '@/analysis/anomalies';
import { buildTimeline, type TimelineEvent, type TimelineKind } from '@/analysis/timeline';
import { formatDate, formatMonthKey, monthKey } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { MONEY_EPSILON } from '@/domain/types';
import { EmptyState, Panel, PanelHeader } from '../primitives';

/**
 * The Timeline: every event the loaded statements record, on one axis.
 *
 * A card per month, each a short vertical thread of that month's events; the
 * cards cascade in and the thread's dots carry a kind colour that the filter
 * chips echo, so the chips double as the legend -- identity never rests on
 * colour alone.
 */

type Group = 'statements' | 'payments' | 'purchases' | 'instalments' | 'reversals' | 'flags';

const GROUPS: Group[] = ['statements', 'payments', 'purchases', 'instalments', 'reversals', 'flags'];

const GROUP_OF: Record<TimelineKind, Group> = {
  statement: 'statements',
  payment: 'payments',
  charge: 'purchases',
  'plan-start': 'instalments',
  'plan-end': 'instalments',
  reversal: 'reversals',
  anomaly: 'flags',
};

const GROUP_LABEL: Record<Group, string> = {
  statements: 'Statements',
  payments: 'Payments',
  purchases: 'Purchases',
  instalments: 'Instalments',
  reversals: 'Reversals',
  flags: 'Flags',
};

const GROUP_COLOR: Record<Group, string> = {
  statements: 'var(--accent)',
  payments: 'var(--series-3)',
  purchases: 'var(--series-2)',
  instalments: 'var(--series-4)',
  reversals: 'var(--ink-secondary)',
  flags: 'var(--serious)',
};

const SEVERITY_COLOR: Record<AnomalySeverity, string> = {
  critical: 'var(--critical)',
  serious: 'var(--serious)',
  warning: 'var(--warning)',
  info: 'var(--ink-muted)',
};

function dotColor(e: TimelineEvent): string {
  if (e.kind === 'anomaly' && e.severity) return SEVERITY_COLOR[e.severity];
  return GROUP_COLOR[GROUP_OF[e.kind]];
}

export function TimelineView({ portfolio }: { portfolio: Portfolio }) {
  const events = useMemo(() => buildTimeline(portfolio), [portfolio]);
  const [active, setActive] = useState<Set<Group>>(() => new Set(GROUPS));

  const flowByMonth = useMemo(
    () => new Map(portfolio.flow.map((f) => [f.month, f])),
    [portfolio.flow],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
    for (const e of events) c[GROUP_OF[e.kind]] += 1;
    return c;
  }, [events]);

  const shown = useMemo(() => events.filter((e) => active.has(GROUP_OF[e.kind])), [events, active]);
  const upcoming = useMemo(() => shown.filter((e) => e.future), [shown]);

  // Past events, newest month first and newest-within-month first. `events` is
  // ascending, so each month's list is built ascending then reversed.
  const monthGroups = useMemo(() => {
    const byMonth = new Map<string, TimelineEvent[]>();
    for (const e of shown) {
      if (e.future) continue;
      const key = monthKey(e.date);
      const list = byMonth.get(key);
      if (list) list.push(e);
      else byMonth.set(key, [e]);
    }
    return [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, evs]) => ({ key, events: [...evs].reverse() }));
  }, [shown]);

  if (portfolio.isEmpty) {
    return (
      <EmptyState title="Nothing on the timeline yet">
        Load a statement and every event it records — each cycle, your payments and largest
        purchases, instalment plans starting and retiring, reversals, and anything flagged — lines
        up here in order.
      </EmptyState>
    );
  }

  const toggle = (g: Group): void =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const allOn = active.size === GROUPS.length;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Timeline"
          subtitle={`${events.length} events across ${portfolio.statements.length} cycle${portfolio.statements.length === 1 ? '' : 's'} · newest first`}
        />
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <FilterChip
            label="All"
            active={allOn}
            onClick={() => setActive(new Set(GROUPS))}
          />
          <span aria-hidden className="h-4 w-px" style={{ background: 'var(--line)' }} />
          {GROUPS.map((g) => (
            <FilterChip
              key={g}
              label={GROUP_LABEL[g]}
              count={counts[g]}
              color={GROUP_COLOR[g]}
              active={active.has(g)}
              onClick={() => toggle(g)}
            />
          ))}
        </div>
      </Panel>

      {upcoming.length > 0 ? (
        <Panel>
          <PanelHeader
            title="Upcoming"
            subtitle="Instalment plans still to retire, soonest first"
          />
          <ol className="relative px-4 py-3.5">
            {upcoming.map((e, i) => (
              <EventRow key={e.id} event={e} isLast={i === upcoming.length - 1} />
            ))}
          </ol>
        </Panel>
      ) : null}

      {monthGroups.length === 0 ? (
        <EmptyState title={allOn ? 'No past events' : 'Nothing matches the filter'}>
          {allOn
            ? 'Everything on this account is still ahead — see Upcoming above.'
            : 'Turn a type back on above to see its events.'}
        </EmptyState>
      ) : (
        <div className="stagger space-y-4">
          {monthGroups.map((group) => (
            <section key={group.key} className="panel lift px-4 py-3.5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[12px] font-semibold tracking-tight">
                  {formatMonthKey(group.key)}
                </h3>
                <MonthFlowNote flow={flowByMonth.get(group.key)} />
              </div>
              <ol className="relative">
                {group.events.map((e, i) => (
                  <EventRow key={e.id} event={e} isLast={i === group.events.length - 1} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthFlowNote({ flow }: { flow: { moneyIn: number; moneyOut: number } | undefined }) {
  if (!flow) return null;
  return (
    <span className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
      out <span className="num">{formatMoney(flow.moneyOut)}</span> · in{' '}
      <span className="num">{formatMoney(flow.moneyIn)}</span>
    </span>
  );
}

function EventRow({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  return (
    <li className="relative pb-4 pl-6 last:pb-0">
      <span
        aria-hidden
        className="absolute left-[1px] top-[4px] h-[10px] w-[10px] rounded-full"
        style={{ background: dotColor(event), boxShadow: '0 0 0 3px var(--surface)' }}
      />
      {!isLast ? (
        <span
          aria-hidden
          className="absolute bottom-0 left-[5.5px] top-[6px] w-px"
          style={{ background: 'var(--line)' }}
        />
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="min-w-0 truncate text-[12.5px] font-semibold">{event.title}</h4>
        <RightFigure event={event} />
      </div>
      <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: 'var(--ink-secondary)' }}>
        {event.detail}
      </p>
      <p className="mt-0.5 text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
        {formatDate(event.date)}
        {event.accountMask ? ` · ····${event.accountMask}` : ''}
      </p>
    </li>
  );
}

function RightFigure({ event }: { event: TimelineEvent }) {
  if (event.amount !== undefined && Math.abs(event.amount) >= MONEY_EPSILON) {
    const inflow = event.amount < 0;
    return (
      <span
        className="num shrink-0 text-[12px] font-semibold"
        style={{ color: inflow ? 'var(--good)' : 'var(--ink)' }}
      >
        {inflow ? '+' : ''}
        {formatMoney(Math.abs(event.amount))}
      </span>
    );
  }
  if (event.balance !== undefined) {
    return (
      <span
        className="num shrink-0 text-[12px] font-medium"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {formatMoney(event.balance)}
      </span>
    );
  }
  return null;
}

function FilterChip({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-[background-color,color,border-color] duration-150 ease-out"
      style={{
        background: active ? 'var(--accent-wash)' : 'var(--surface-sunken)',
        color: active ? 'var(--ink)' : 'var(--ink-muted)',
        border: `1px solid ${active ? 'var(--line-strong)' : 'var(--line)'}`,
      }}
    >
      {color ? (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: color, opacity: active ? 1 : 0.5 }}
        />
      ) : null}
      {label}
      {count !== undefined ? <span className="num opacity-70">{count}</span> : null}
    </button>
  );
}
