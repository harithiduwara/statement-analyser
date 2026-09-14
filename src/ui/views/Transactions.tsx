import { useMemo, useState } from 'react';
import type { Portfolio } from '@/analysis/portfolio';
import { TXN_CLASSES, type Txn, type TxnClass } from '@/domain/types';
import { categoriseTxn, compileRules, type CategoryRule } from '@/analysis/categories';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { Button, Chip, EmptyState, Panel, PanelHeader } from '../primitives';

/** Rows rendered beyond the viewport at a time. */
const PAGE_SIZE = 200;

interface Row {
  txn: Txn;
  issuer: string;
  statementDate: string;
  category: string;
  isReversal: boolean;
  isReversed: boolean;
}

export function TransactionsView({
  portfolio,
  rules,
}: {
  portfolio: Portfolio;
  rules: CategoryRule[];
}) {
  const [query, setQuery] = useState('');
  const [issuer, setIssuer] = useState('all');
  const [card, setCard] = useState('all');
  const [klass, setKlass] = useState<'all' | TxnClass>('all');
  const [category, setCategory] = useState('all');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const compiled = useMemo(() => compileRules(rules), [rules]);

  const rows = useMemo<Row[]>(
    () =>
      portfolio.statements.flatMap((s) =>
        s.transactions.map((txn) => {
          const match = portfolio.reversals.byTxnId.get(txn.id);
          return {
            txn,
            issuer: s.issuer,
            statementDate: s.statementDate,
            category: categoriseTxn(txn, compiled),
            isReversal: match?.reversal.id === txn.id,
            isReversed: match?.origination.id === txn.id,
          };
        }),
      ),
    [portfolio, compiled],
  );

  const cards = useMemo(
    () => [...new Set(rows.map((r) => r.txn.cardMask).filter((m): m is string => !!m))].sort(),
    [rows],
  );
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((r) => issuer === 'all' || r.issuer === issuer)
      .filter((r) => card === 'all' || r.txn.cardMask === card)
      .filter((r) => klass === 'all' || r.txn.classification === klass)
      .filter((r) => category === 'all' || r.category === category)
      .filter(
        (r) =>
          needle === '' ||
          r.txn.description.toLowerCase().includes(needle) ||
          (r.txn.reference?.toLowerCase().includes(needle) ?? false),
      )
      .sort((a, b) => b.txn.postDate.localeCompare(a.txn.postDate));
  }, [rows, query, issuer, card, klass, category]);

  const shown = filtered.slice(0, limit);
  const total = filtered.reduce((acc, r) => acc + r.txn.amount, 0);

  if (portfolio.isEmpty) {
    return (
      <EmptyState title="No transactions">
        Every transaction from every loaded statement appears here, filterable and exportable.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader
          title="Transactions"
          subtitle={`${filtered.length} of ${rows.length} rows · net ${formatMoney(total)} LKR`}
          aside={
            <Button size="sm" onClick={() => downloadCsv(filtered)}>
              Export CSV
            </Button>
          }
        />
        <div className="flex flex-wrap gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            placeholder="Search description or reference…"
            aria-label="Search transactions"
            className="min-w-[220px] flex-1 rounded-md px-2.5 py-1.5 text-[12px]"
            style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line-strong)', color: 'var(--ink)' }}
          />
          <Select label="Issuer" value={issuer} onChange={setIssuer} options={['all', ...new Set(rows.map((r) => r.issuer))]} />
          <Select label="Card" value={card} onChange={setCard} options={['all', ...cards]} />
          <Select
            label="Class"
            value={klass}
            onChange={(v) => setKlass(v as 'all' | TxnClass)}
            options={['all', ...TXN_CLASSES]}
          />
          <Select label="Category" value={category} onChange={setCategory} options={['all', ...categories]} />
        </div>

        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Posted</th>
                <th>Txn</th>
                <th>Card</th>
                <th>Reference</th>
                <th>Description</th>
                <th className="right">Amount</th>
                <th>Class</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.txn.id}>
                  <td className="whitespace-nowrap">{formatDate(r.txn.postDate)}</td>
                  <td className="whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                    {formatDate(r.txn.txnDate)}
                  </td>
                  <td style={{ color: 'var(--ink-secondary)' }}>{r.txn.cardMask ?? '—'}</td>
                  <td className="font-mono text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {r.txn.reference ?? '—'}
                  </td>
                  <td>
                    <span className="font-medium">{r.txn.description}</span>
                    {r.txn.currency ? (
                      <span className="block text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        {r.txn.currency.code} {r.txn.currency.amount.toFixed(2)} · implied{' '}
                        {r.txn.currency.impliedRate?.toFixed(2)} LKR/{r.txn.currency.code}
                      </span>
                    ) : null}
                    {r.txn.installmentSeq ? (
                      <span className="block text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        instalment {r.txn.installmentSeq} of {r.txn.installmentTerm}
                      </span>
                    ) : null}
                    {r.isReversed ? (
                      <span className="mt-0.5 inline-block">
                        <Chip tone="warning" dot={false}>reversed — excluded from charges</Chip>
                      </span>
                    ) : null}
                    {r.isReversal ? (
                      <span className="mt-0.5 inline-block">
                        <Chip tone="accent" dot={false}>reversal, not a payment</Chip>
                      </span>
                    ) : null}
                  </td>
                  <td className="num right font-medium">{formatMoney(r.txn.amount)}</td>
                  <td className="whitespace-nowrap" style={{ color: 'var(--ink-secondary)' }}>
                    {r.txn.classification.replace(/_/g, ' ')}
                  </td>
                  <td style={{ color: 'var(--ink-secondary)' }}>{r.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length > shown.length ? (
          <div className="flex items-center justify-center gap-3 px-4 py-3">
            <span className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              Showing {shown.length} of {filtered.length}
            </span>
            <Button size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
              Show more
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Iterable<string>;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md px-2 py-1.5 text-[11.5px]"
        style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line-strong)', color: 'var(--ink)' }}
      >
        {[...options].map((o) => (
          <option key={o} value={o}>
            {o === 'all' ? 'all' : o.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * CSV export. Built and downloaded in the page -- like everything else here,
 * the data never goes anywhere to be converted.
 */
function downloadCsv(rows: readonly Row[]): void {
  const header = [
    'post_date', 'txn_date', 'issuer', 'card_mask', 'reference', 'description',
    'amount_lkr', 'currency_code', 'currency_amount', 'implied_rate',
    'classification', 'category', 'installment_seq', 'installment_term',
    'is_reversal', 'is_reversed',
  ];
  const body = rows.map((r) => [
    r.txn.postDate, r.txn.txnDate, r.issuer, r.txn.cardMask ?? '', r.txn.reference ?? '',
    r.txn.description, r.txn.amount.toFixed(2), r.txn.currency?.code ?? '',
    r.txn.currency?.amount?.toFixed(2) ?? '', r.txn.currency?.impliedRate?.toFixed(4) ?? '',
    r.txn.classification, r.category, r.txn.installmentSeq ?? '', r.txn.installmentTerm ?? '',
    r.isReversal ? 'yes' : 'no', r.isReversed ? 'yes' : 'no',
  ]);

  const csv = [header, ...body].map((line) => line.map(escapeCsv).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
