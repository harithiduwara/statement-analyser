import type { ReactNode } from 'react';
import { cn } from './lib';

/**
 * Presentational primitives. Dense and readable over decorative; nothing here
 * decides anything about the data it is handed.
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
          <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
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
 * the hues.
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
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-[3px] text-[11px] font-medium whitespace-nowrap"
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
  const base =
    'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const sizing = size === 'sm' ? 'px-2 py-1 text-[11.5px]' : 'px-2.5 py-1.5 text-[12px]';

  const style: React.CSSProperties =
    variant === 'primary'
      ? { background: 'var(--accent)', color: 'var(--accent-ink)', border: '1px solid transparent' }
      : variant === 'danger'
        ? { color: 'var(--critical)', border: '1px solid var(--line-strong)', background: 'transparent' }
        : variant === 'ghost'
          ? { color: 'var(--ink-secondary)', border: '1px solid transparent', background: 'transparent' }
          : { color: 'var(--ink)', border: '1px solid var(--line-strong)', background: 'var(--surface)' };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(base, sizing, !disabled && 'hover:brightness-95')}
      style={style}
    >
      {children}
    </button>
  );
}

/** A labelled figure. Hero numbers keep proportional figures by design. */
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
    <div className="panel px-4 py-3">
      <div
        className="text-[10.5px] font-semibold uppercase tracking-[0.07em]"
        style={{ color: 'var(--ink-muted)' }}
      >
        {label}
        {unit ? <span className="ml-1 font-normal normal-case tracking-normal">· {unit}</span> : null}
      </div>
      <div
        className="mt-1.5 text-[22px] font-semibold leading-none"
        style={{ color: tone ? TONE_VAR[tone] : 'var(--ink)' }}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-[11.5px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
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
      className="panel flex flex-col items-center justify-center px-6 py-14 text-center"
      style={{ borderStyle: 'dashed' }}
    >
      <p className="text-[13px] font-semibold">{title}</p>
      {children ? (
        <p
          className="mt-1.5 max-w-md text-[12px] leading-relaxed"
          style={{ color: 'var(--ink-muted)' }}
        >
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
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
