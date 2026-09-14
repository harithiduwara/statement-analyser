import type { ReactNode } from 'react';
import { cn } from './lib';

/**
 * Small presentational primitives. Deliberately plain: dense and readable
 * over decorative, and no component here decides anything about the data.
 */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        'rounded-lg border border-neutral-200 bg-white shadow-sm',
        'dark:border-neutral-800 dark:bg-neutral-900',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, aside }: { title: ReactNode; subtitle?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </header>
  );
}

export type Tone = 'neutral' | 'pass' | 'fail' | 'warn' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  pass: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
  fail: 'bg-red-50 text-red-800 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
  warn: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  info: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Button({
  onClick,
  children,
  variant = 'default',
  type = 'button',
}: {
  onClick?: () => void;
  children: ReactNode;
  variant?: 'default' | 'danger';
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        variant === 'danger'
          ? 'border border-red-300 text-red-700 hover:bg-red-50 focus-visible:outline-red-600 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950'
          : 'border border-neutral-300 hover:bg-neutral-100 focus-visible:outline-neutral-600 dark:border-neutral-700 dark:hover:bg-neutral-800',
      )}
    >
      {children}
    </button>
  );
}

/**
 * A money cell. Tabular figures, right-aligned, credits in parentheses --
 * never colour alone, which would carry the sign for anyone who cannot
 * distinguish the colours.
 */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('num tabular-nums', className)}>{children}</span>
  );
}
