import { useCallback, useEffect, useState } from 'react';
import { emptyPlan, type MonthlyPlan, type PlanLine } from '@/domain/plan';
import { addMonths, monthKey } from '@/lib/dates';

/**
 * The monthly plans, kept per month and persisted locally.
 *
 * Like the category rules, a plan is the reader's own input -- income and
 * savings figures, not statement data -- so it lives in localStorage, on this
 * device only, and "Clear all data" wipes it. Storage can be blocked, so every
 * read and write is guarded and an absent plan falls back to an empty one.
 */

const KEY = 'sa.plan.v1';
type Store = Record<string, MonthlyPlan>;

function thisMonth(): string {
  return monthKey(new Date().toISOString().slice(0, 10));
}

function isLine(v: unknown): v is PlanLine {
  if (typeof v !== 'object' || v === null) return false;
  const l = v as Record<string, unknown>;
  return typeof l['id'] === 'string' && typeof l['label'] === 'string' && typeof l['amount'] === 'number';
}

function isPlan(v: unknown): v is MonthlyPlan {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p['month'] === 'string' &&
    (['income', 'deductions', 'bills', 'savings'] as const).every(
      (k) => Array.isArray(p[k]) && (p[k] as unknown[]).every(isLine),
    )
  );
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Store = {};
    for (const [k, v] of Object.entries(parsed)) if (isPlan(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function clone(p: MonthlyPlan): MonthlyPlan {
  return JSON.parse(JSON.stringify(p)) as MonthlyPlan;
}

export function usePlanStore() {
  const [store, setStore] = useState<Store>(load);
  const [month, setMonth] = useState<string>(thisMonth);

  useEffect(() => {
    try {
      if (Object.keys(store).length === 0) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      // The plan still holds for this session.
    }
  }, [store]);

  const plan = store[month] ?? emptyPlan(month);

  const update = useCallback((next: MonthlyPlan) => {
    setStore((s) => ({ ...s, [next.month]: next }));
  }, []);

  const prevMonth = useCallback(() => setMonth((m) => addMonths(m, -1)), []);
  const nextMonth = useCallback(() => setMonth((m) => addMonths(m, 1)), []);

  /** Carry this month's plan into the next one and move there. */
  const startNextMonth = useCallback(() => {
    setMonth((m) => {
      const next = addMonths(m, 1);
      setStore((s) => {
        if (s[next]) return s;
        const source = s[m];
        return source ? { ...s, [next]: { ...clone(source), month: next } } : s;
      });
      return next;
    });
  }, []);

  const clearStored = useCallback(() => setStore({}), []);

  return { plan, month, update, prevMonth, nextMonth, startNextMonth, clearStored };
}
