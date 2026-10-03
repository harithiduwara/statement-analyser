import type { ReactNode } from 'react';
import { cn } from './lib';

/**
 * Presentational primitives. Dense and readable over decorative; nothing here
 * decides anything about the data it is handed. The 2026 refresh gives them a
 * shared depth, radius and motion language -- a tile lifts on hover, a button
 * presses, a hero figure is set in lining numerals -- without changing what
 * any of them means or the props a caller passes.
 */

export function Panel({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cn('panel', className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  subtitle,
  aside,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header
      className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
      style={{ borderBottom: '1px solid var(--line)' }}
    >
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </header>
  );
}

export type Tone = 'neutral' | 'good' | 'warning' | 'serious' | 'critical' | 'accent';

const TONE_VAR: Record<Tone, string> = {
  neutral: 'var(--ink-muted)',
  good: 'var(--good)',
  warning: 'var(--warning)',
  serious: 'var(--serious)',
  critical: 'var(--critical)',
  accent: 'var(--accent)',
};

/**
 * A status chip. Status colour never carries the meaning alone -- the label
 * is always present, and a dot marks the tone for anyone who cannot separate
 * the hues. A pill shape and a hairline keep it legible on any surface.
 */
export function Chip({
  tone = 'neutral',
  children,
  dot = true,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-medium whitespace-nowrap"
      style={{
        color: tone === 'neutral' ? 'var(--ink-secondary)' : TONE_VAR[tone],
        background: 'var(--surface-sunken)',
        border: '1px solid var(--line)',
      }}
    >
      {dot ? (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: TONE_VAR[tone] }}
        />
      ) : null}
      {children}
    </span>
  );
}

export function Button({
  onClick,
  children,
  variant = 'default',
  size = 'md',
  disabled,
  title,
}: {
  onClick?: () => void;
  children: ReactNode;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
}) {
  // Colours and hover affordances are all classes -- never inline style -- so
  // the :hover background is not overridden by an inline background (an inline
  // style outranks a hover rule, which would leave the hover dead).
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium select-none ' +
    'transition-[background-color,box-shadow,transform,filter,border-color] duration-150 ease-out ' +
    'active:translate-y-px disabled:opacity-50 disabled:pointer-events-none';
  const sizing = size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1.5 text-[12px]';

  const variantClass: Record<NonNullable<typeof variant>, string> = {
    default:
      'text-[var(--ink)] bg-[var(--surface)] border-[var(--line-strong)] hover:bg-[var(--surface-sunken)]',
    primary:
      'text-[var(--accent-ink)] bg-[var(--accent)] border-transparent ' +
      'shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] hover:brightness-95',
    danger:
      'text-[var(--critical)] bg-transparent border-[var(--line-strong)] hover:bg-[var(--surface-sunken)]',
    ghost: 'text-[var(--ink-secondary)] bg-transparent border-transparent hover:bg-[var(--surface-sunken)]',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(base, sizing, variantClass[variant])}
    >
      {children}
    </button>
  );
}

/**
 * A labelled figure. The value is a hero number -- lining numerals, tightly
 * tracked -- not a column entry, so it keeps proportional figures by design.
 * A toned stat carries a dot by its label as well as the colour, so the state
 * it reports never rests on hue alone. The tile lifts a little on hover.
 */
export function Stat({
  label,
  value,
  hint,
  tone,
  unit = 'LKR',
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: Tone;
  unit?: string | null;
}) {
  return (
    <div className="panel lift px-4 py-3.5">
      <div
        className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em]"
        style={{ color: 'var(--ink-muted)' }}
      >
        {tone ? (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: TONE_VAR[tone] }}
          />
        ) : null}
        <span>
          {label}
          {unit ? (
            <span className="ml-1 font-normal normal-case tracking-normal">· {unit}</span>
          ) : null}
        </span>
      </div>
      <div
        className="figure mt-2 text-[23px] font-semibold leading-none"
        style={{ color: tone ? TONE_VAR[tone] : 'var(--ink)' }}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-2 text-[11.5px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="panel flex flex-col items-center justify-center px-6 py-16 text-center"
      style={{ borderStyle: 'dashed', boxShadow: 'none' }}
    >
      <p className="text-[14px] font-semibold tracking-tight">{title}</p>
      {children ? (
        <p
          className="mt-2 max-w-md text-[12px] leading-relaxed"
          style={{ color: 'var(--ink-muted)' }}
        >
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3
      className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.07em]"
      style={{ color: 'var(--ink-muted)' }}
    >
      {children}
    </h3>
  );
}
