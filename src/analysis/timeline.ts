import type { Issuer, IsoDate, Money, Statement, Txn } from '@/domain/types';
import { ISSUER_LABEL } from '@/domain/types';
import { formatDate, formatMonthKey, monthKey } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import type { AnomalySeverity } from './anomalies';
import type { Portfolio } from './portfolio';

/**
 * The timeline view-model: everything the loaded statements record, placed on
 * one chronological axis.
 *
 * Pure data, no UI type in sight -- the view decides colour and shape per kind.
 * Derived on demand from an already-assembled portfolio rather than folded into
 * `buildPortfolio`, so it costs nothing until the Timeline is opened.
 *
 * It is a *narrative*, not a ledger: the Transactions view is the line-by-line
 * record. Here each cycle contributes its statement, its payments, its single
 * largest purchase, the instalment plans that start and retire, the charges the
 * bank reversed, and anything flagged -- the events of the account's life, not
 * every row of it.
 */

export type TimelineKind =
  | 'statement'
  | 'payment'
  | 'charge'
  | 'plan-start'
  | 'plan-end'
  | 'reversal'
  | 'anomaly';

export interface TimelineEvent {
  id: string;
  date: IsoDate;
  kind: TimelineKind;
  title: string;
  detail: string;
  /** Signed cash flow, when the event moved money. Negative = money in. */
  amount?: Money;
  /** A neutral figure (a balance, an amount still owed) that is not a flow. */
  balance?: Money;
  issuer?: Issuer;
  accountMask?: string;
  /** Only on `anomaly` events, so the view can colour by severity. */
  severity?: AnomalySeverity;
  /** A `plan-end` whose final payment falls after the last loaded cycle. */
  future?: boolean;
}

/** Stable within-day ordering, so a day's events always read in this order. */
const KIND_ORDER: Record<TimelineKind, number> = {
  statement: 0,
  payment: 1,
  charge: 2,
  reversal: 3,
  'plan-start': 4,
  'plan-end': 5,
  anomaly: 6,
};

export function buildTimeline(portfolio: Portfolio): TimelineEvent[] {
  if (portfolio.isEmpty) return [];
  const { statements, reversals, register, anomalies } = portfolio;

  const statementById = new Map(statements.map((s) => [s.id, s]));
  const txnById = new Map<string, Txn>();
  for (const s of statements) for (const t of s.transactions) txnById.set(t.id, t);

  // `statements` is sorted ascending by date in the portfolio, so the last one
  // is the most recent cycle loaded -- the boundary between past and future.
  const latestMonth = monthKey(statements[statements.length - 1]!.statementDate);

  // A reversal that originated a plan is told as the plan starting, not as a
  // bare reversal, so it is not counted on the timeline twice.
  const planOriginationIds = new Set(
    register.plans
      .map((p) => p.originationTxnId)
      .filter((id): id is string => id !== undefined),
  );

  const events: TimelineEvent[] = [];

  for (const s of statements) {
    events.push({
      id: `stmt:${s.id}`,
      date: s.statementDate,
      kind: 'statement',
      title: `${ISSUER_LABEL[s.issuer]} ····${s.accountMask}`,
      detail: `Statement issued · minimum ${formatMoney(s.minimumPayment)} due ${formatDate(s.paymentDueDate)}`,
      balance: s.closingBalance,
      issuer: s.issuer,
      accountMask: s.accountMask,
    });

    for (const t of s.transactions) {
      if (t.classification !== 'payment') continue;
      events.push({
        id: `pay:${t.id}`,
        date: t.postDate,
        kind: 'payment',
        title: 'Payment received',
        detail: tidy(t.description) || `····${s.accountMask}`,
        amount: t.amount,
        issuer: s.issuer,
        accountMask: s.accountMask,
      });
    }

    // The single largest everyday purchase of the cycle -- a reversed charge
    // never really happened (and a financed one becomes a plan), so both are
    // excluded here.
    let biggest: Txn | undefined;
    for (const t of s.transactions) {
      if (t.amount <= 0 || t.classification !== 'purchase') continue;
      if (reversals.byTxnId.has(t.id)) continue;
      if (!biggest || t.amount > biggest.amount) biggest = t;
    }
    if (biggest) {
      events.push({
        id: `big:${biggest.id}`,
        date: biggest.postDate,
        kind: 'charge',
        title: merchantHead(biggest.description),
        detail:
          `Largest purchase in ${formatMonthKey(monthKey(s.statementDate))}` +
          (biggest.category ? ` · ${biggest.category}` : ''),
        amount: biggest.amount,
        issuer: s.issuer,
        accountMask: s.accountMask,
      });
    }
  }

  for (const p of register.plans) {
    if (p.originationTxnId) {
      const origin = txnById.get(p.originationTxnId);
      if (origin) {
        events.push({
          id: `plan-start:${p.id}`,
          date: origin.postDate,
          kind: 'plan-start',
          title: `Plan started — ${merchantHead(p.merchant)}`,
          detail:
            `${p.termCount} months · ${formatMoney(p.monthly)}/mo` +
            (p.effectiveApr !== undefined ? ` · ${(p.effectiveApr * 100).toFixed(1)}% EAR` : ''),
          ...(p.originalPrincipal !== undefined ? { amount: p.originalPrincipal } : {}),
          issuer: p.issuer as Issuer,
        });
      }
    }

    const future = p.finalPaymentMonth > latestMonth && p.remaining > 0;
    events.push({
      id: `plan-end:${p.id}`,
      date: lastDayOfMonth(p.finalPaymentMonth),
      kind: 'plan-end',
      title: `Plan ends — ${merchantHead(p.merchant)}`,
      detail:
        p.remaining > 0
          ? `Final of ${p.termCount} · ${p.remaining} payment(s) and ${formatMoney(p.remainingValue)} left`
          : `Completed · ${p.termCount} payments`,
      ...(p.remaining > 0 ? { balance: p.remainingValue } : {}),
      future,
      issuer: p.issuer as Issuer,
    });
  }

  for (const m of reversals.matches) {
    if (planOriginationIds.has(m.origination.id)) continue;
    events.push({
      id: `rev:${m.reversal.id}`,
      date: m.reversal.postDate,
      kind: 'reversal',
      title: `Reversed — ${merchantHead(m.origination.description)}`,
      detail: `${formatMoney(Math.abs(m.amount))} charge undone after ${m.gapDays} day(s)`,
      amount: m.reversal.amount,
    });
  }

  for (const a of anomalies) {
    const date = anomalyDate(a.reference, statementById, txnById);
    if (!date) continue; // keep the axis honestly chronological
    events.push({
      id: `anom:${a.id}`,
      date,
      kind: 'anomaly',
      title: a.title,
      detail: a.detail,
      severity: a.severity,
    });
  }

  events.sort(
    (x, y) => x.date.localeCompare(y.date) || KIND_ORDER[x.kind] - KIND_ORDER[y.kind],
  );
  return events;
}

/** Resolve an anomaly's `reference` to the date it belongs on, when it can. */
function anomalyDate(
  reference: string | undefined,
  statementById: ReadonlyMap<string, Statement>,
  txnById: ReadonlyMap<string, Txn>,
): IsoDate | undefined {
  if (!reference) return undefined;
  const statement = statementById.get(reference);
  if (statement) return statement.statementDate;
  const txn = txnById.get(reference);
  if (txn) return txn.postDate;
  const window = /(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(reference);
  if (window) return window[2];
  return undefined;
}

/** Last calendar day of a `YYYY-MM` key, so a plan-end sorts after that month's rows. */
function lastDayOfMonth(key: string): IsoDate {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${key}-${String(day).padStart(2, '0')}`;
}

function tidy(description: string): string {
  return description.replace(/\s+/g, ' ').trim();
}

/** The merchant head: the name before the location tail, capped for a title. */
function merchantHead(description: string): string {
  const head = tidy(description).split(/\s+[-–]\s+/)[0] ?? description;
  return head.length > 42 ? `${head.slice(0, 42).trim()}…` : head;
}
