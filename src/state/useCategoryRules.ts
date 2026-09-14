import { useCallback, useEffect, useState } from 'react';
import { SEED_RULES, type CategoryRule } from '@/analysis/categories';

/**
 * The user's classification rules.
 *
 * These are preferences, not statement data: a regex and a category name, with
 * nothing from a statement in them. So they are persisted to localStorage,
 * which is per-device and never leaves the browser. Storage can be blocked or
 * cleared, so every read and write is guarded and the seeds are the fallback.
 */

const KEY = 'sa.categoryRules.v1';

function load(): CategoryRule[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return SEED_RULES;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return SEED_RULES;
    const rules = parsed.filter(isRule);
    return rules.length > 0 ? rules : SEED_RULES;
  } catch {
    return SEED_RULES;
  }
}

function isRule(value: unknown): value is CategoryRule {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    typeof r['pattern'] === 'string' &&
    typeof r['category'] === 'string' &&
    typeof r['enabled'] === 'boolean'
  );
}

export function useCategoryRules() {
  const [rules, setRules] = useState<CategoryRule[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(rules));
    } catch {
      // The rules still apply for this session.
    }
  }, [rules]);

  const reset = useCallback(() => setRules(SEED_RULES), []);

  const clearStored = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to clear.
    }
    setRules(SEED_RULES);
  }, []);

  return { rules, setRules, reset, clearStored };
}
