import { useMemo, useState } from 'react';
import type { Portfolio } from '@/analysis/portfolio';
import {
  breakdownByCategory,
  CATEGORIES,
  compileRules,
  type Category,
  type CategoryRule,
  type SpendView,
} from '@/analysis/categories';
import { formatMoney } from '@/lib/money';
import { Button, Chip, EmptyState, Panel, PanelHeader } from '../primitives';
import { RankedBarChart } from '../charts';

export function CategoriesView({
  portfolio,
  rules,
  onRulesChange,
  onResetRules,
}: {
  portfolio: Portfolio;
  rules: CategoryRule[];
  onRulesChange: (rules: CategoryRule[]) => void;
  onResetRules: () => void;
}) {
  const [view, setView] = useState<SpendView>('economic');
  const compiled = useMemo(() => compileRules(rules), [rules]);

  const breakdown = useMemo(
    () =>
      breakdownByCategory(
        portfolio.statements,
        compiled,
        portfolio.reversals,
        portfolio.register,
        view,
      ),
    [portfolio.statements, portfolio.reversals, portfolio.register, compiled, view],
  );

  if (portfolio.isEmpty) {
    return (
      <EmptyState title="No spending to categorise">
        Spending is classified by an ordered rules table you can edit here. Unmatched spend goes to
        <i> unclassified</i> with a visible count rather than into an &ldquo;other&rdquo; bucket.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title={view === 'economic' ? 'Economic view' : 'Cash view'}
          subtitle={
            view === 'economic'
              ? 'An instalment-financed purchase counts at full value in the month it was acquired, and its repayments are not counted again. A plan that started before the earliest loaded statement has no origination to count, so it appears in the cash view only.'
              : 'An instalment-financed purchase counts as its monthly repayment. This answers what actually left your account.'
          }
          aside={
            <div className="flex items-center gap-1 rounded-md p-0.5" style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line)' }}>
              <Toggle active={view === 'economic'} onClick={() => setView('economic')}>
                Economic
              </Toggle>
              <Toggle active={view === 'cash'} onClick={() => setView('cash')}>
                Cash
              </Toggle>
            </div>
          }
        />
        <div className="flex flex-wrap items-center gap-4 px-4 py-3">
          <Figure label="Total" value={formatMoney(breakdown.grandTotal)} />
          <Figure label="Categories used" value={String(breakdown.totals.length)} />
          <Figure
            label="Unclassified"
            value={`${breakdown.unclassifiedCount} txn`}
            tone={breakdown.unclassifiedCount > 0 ? 'warning' : 'good'}
          />
        </div>
      </Panel>

      {breakdown.totals.length > 0 ? (
        <RankedBarChart
          title={`Spend by purpose — ${view} view`}
          unit="LKR"
          note={
            view === 'economic'
              ? 'financed purchases at full value in the month acquired'
              : 'financed purchases as the monthly repayment'
          }
          data={breakdown.totals.map((t) => ({
            label: t.category,
            value: t.amount,
            highlight: t.category === 'unclassified',
          }))}
          {...(breakdown.unclassifiedCount > 0 ? { highlightNote: 'unclassified' } : {})}
        />
      ) : null}

      <Panel>
        <PanelHeader title="Breakdown" subtitle="Shares are of the total on this view" />
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="right">Amount</th>
                <th className="right">Share</th>
                <th className="right">Transactions</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.totals.map((t) => (
                <tr key={t.category}>
                  <td className="font-medium">
                    {t.category}
                    {t.category === 'unclassified' ? (
                      <span className="ml-1.5">
                        <Chip tone="warning" dot={false}>needs a rule</Chip>
                      </span>
                    ) : null}
                  </td>
                  <td className="num right">{formatMoney(t.amount)}</td>
                  <td className="num right">{(t.share * 100).toFixed(1)}%</td>
                  <td className="num right">{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <RulesTable rules={rules} onChange={onRulesChange} onReset={onResetRules} />
    </div>
  );
}

function RulesTable({
  rules,
  onChange,
  onReset,
}: {
  rules: CategoryRule[];
  onChange: (rules: CategoryRule[]) => void;
  onReset: () => void;
}) {
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState<Category>('groceries');
  const compiled = useMemo(() => compileRules(rules), [rules]);

  const add = (): void => {
    const trimmed = pattern.trim();
    if (trimmed === '') return;
    onChange([
      { id: `user-${Date.now()}`, pattern: trimmed, category, enabled: true },
      ...rules,
    ]);
    setPattern('');
  };

  return (
    <Panel>
      <PanelHeader
        title="Classification rules"
        subtitle="Ordered — the first matching pattern wins, so put specific rules above general ones. Edits are saved on this device."
        aside={
          <Button size="sm" onClick={onReset}>
            Reset to defaults
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <label className="flex-1 min-w-[220px]">
          <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--ink-muted)' }}>
            Pattern (regular expression)
          </span>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
            placeholder="KEELLS|CARGILLS"
            className="w-full rounded-md px-2.5 py-1.5 text-[12px] font-mono"
            style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line-strong)', color: 'var(--ink)' }}
          />
        </label>
        <label>
          <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--ink-muted)' }}>
            Category
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="rounded-md px-2.5 py-1.5 text-[12px]"
            style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line-strong)', color: 'var(--ink)' }}
          >
            {CATEGORIES.filter((c) => c !== 'unclassified').map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" onClick={add}>
          Add rule
        </Button>
      </div>

      <div className="max-h-[420px] overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>On</th>
              <th>Pattern</th>
              <th>Category</th>
              <th>Source</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {compiled.map((rule, index) => (
              <tr key={rule.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    aria-label={`Enable rule ${rule.pattern}`}
                    onChange={() =>
                      onChange(
                        rules.map((r) =>
                          r.id === rule.id ? { ...r, enabled: !r.enabled } : r,
                        ),
                      )
                    }
                  />
                </td>
                <td className="font-mono text-[11.5px]">
                  {rule.pattern}
                  {rule.error ? (
                    <span className="ml-2" style={{ color: 'var(--critical)' }}>
                      invalid: {rule.error}
                    </span>
                  ) : null}
                </td>
                <td>{rule.category}</td>
                <td style={{ color: 'var(--ink-muted)' }}>
                  {rule.seeded ? 'built in' : 'yours'} · #{index + 1}
                </td>
                <td className="right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded px-2.5 py-1 text-[11.5px] font-medium"
      style={{
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--accent-ink)' : 'var(--ink-secondary)',
      }}
    >
      {children}
    </button>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warning' }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em]" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </div>
      <div
        className="mt-1 text-[16px] font-semibold"
        style={{ color: tone === 'warning' ? 'var(--warning)' : 'var(--ink)' }}
      >
        {value}
      </div>
    </div>
  );
}
