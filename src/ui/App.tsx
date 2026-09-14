import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  LayoutDashboard,
  ListTree,
  Moon,
  Receipt,
  Scale,
  Sun,
  Tags,
  Upload as UploadIcon,
} from 'lucide-react';
import { useStatementLibrary } from '@/state/useStatementLibrary';
import { useCategoryRules } from '@/state/useCategoryRules';
import { buildPortfolio } from '@/analysis/portfolio';
import { formatMoney } from '@/lib/money';
import { href, useRoute, type Route } from './router';
import { applyTheme, readTheme, type ThemeChoice } from './theme';
import { Chip } from './primitives';
import { cn } from './lib';
import { UploadView } from './views/Upload';
import { OverviewView } from './views/Overview';
import { CyclesView } from './views/Cycles';
import { InstalmentsView } from './views/Instalments';
import { ForwardView } from './views/Forward';
import { CategoriesView } from './views/Categories';
import { TransactionsView } from './views/Transactions';

interface NavItem {
  route: Route;
  label: string;
  icon: typeof LayoutDashboard;
  description: string;
}

const NAV: NavItem[] = [
  { route: 'upload', label: 'Upload', icon: UploadIcon, description: 'Add statement PDFs' },
  { route: 'overview', label: 'Overview', icon: LayoutDashboard, description: 'Position and findings' },
  { route: 'cycles', label: 'Cycles', icon: Scale, description: 'Reconciliation and gaps' },
  { route: 'instalments', label: 'Instalments', icon: ListTree, description: 'Plan register' },
  { route: 'forward', label: 'Forward', icon: CalendarClock, description: 'Obligation schedule' },
  { route: 'categories', label: 'Categories', icon: Tags, description: 'Spend by purpose' },
  { route: 'transactions', label: 'Transactions', icon: Receipt, description: 'Every line' },
];

const TITLES: Record<Route, { title: string; subtitle: string }> = {
  upload: { title: 'Upload', subtitle: 'Statements are read in this browser tab and never sent anywhere' },
  overview: { title: 'Overview', subtitle: 'Where you stand, and what in the figures does not look right' },
  cycles: { title: 'Cycles', subtitle: 'Opening + charges − payments = closing, checked on every cycle' },
  instalments: { title: 'Instalments', subtitle: 'Every plan across every statement, and what each one costs' },
  forward: { title: 'Forward schedule', subtitle: 'What the contracted plans require, month by month' },
  categories: { title: 'Categories', subtitle: 'Spend by purpose, on an economic or a cash basis' },
  transactions: { title: 'Transactions', subtitle: 'Every line from every loaded statement' },
};

export function App() {
  const [route, navigate] = useRoute();
  const { files, statements, addFiles, clearAll, busy } = useStatementLibrary();
  const { rules, setRules, reset, clearStored } = useCategoryRules();
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => applyTheme(theme), [theme]);

  const portfolio = useMemo(() => buildPortfolio(statements), [statements]);
  const openAnomalies = portfolio.anomalies.filter((a) => !dismissed.has(a.id)).length;

  const clearEverything = (): void => {
    clearAll();
    clearStored();
    setDismissed(new Set());
  };

  const meta = TITLES[route];

  return (
    <div className="flex min-h-screen">
      <Sidebar
        route={route}
        navigate={navigate}
        counts={{
          upload: files.length,
          overview: openAnomalies,
          cycles: portfolio.reconciliationSummary.failed.length + portfolio.chain.gaps.length,
          instalments: portfolio.register.plans.filter((p) => p.remaining > 0).length,
          forward: 0,
          categories: 0,
          transactions: portfolio.statements.reduce((n, s) => n + s.transactions.length, 0),
        }}
        portfolioEmpty={portfolio.isEmpty}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}
        >
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight">{meta.title}</h1>
            <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              {meta.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!portfolio.isEmpty ? (
              <>
                <Chip tone={portfolio.reconciliationSummary.failed.length === 0 ? 'good' : 'critical'}>
                  {portfolio.reconciliationSummary.passed}/{portfolio.reconciliationSummary.total} reconcile
                </Chip>
                <Chip tone="neutral" dot={false}>
                  true obligation {formatMoney(portfolio.trueObligation)}
                </Chip>
                {openAnomalies > 0 ? (
                  <button type="button" onClick={() => navigate('overview')}>
                    <Chip tone="serious">
                      <AlertTriangle size={11} aria-hidden /> {openAnomalies} to review
                    </Chip>
                  </button>
                ) : null}
              </>
            ) : null}
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-5 py-5">
          {route === 'upload' ? (
            <UploadView files={files} busy={busy} onAdd={addFiles} onClear={clearEverything} />
          ) : null}
          {route === 'overview' ? (
            <OverviewView
              portfolio={portfolio}
              dismissed={dismissed}
              onDismiss={(id) => setDismissed((prev) => new Set(prev).add(id))}
              onGoToUpload={() => navigate('upload')}
            />
          ) : null}
          {route === 'cycles' ? <CyclesView portfolio={portfolio} /> : null}
          {route === 'instalments' ? <InstalmentsView portfolio={portfolio} /> : null}
          {route === 'forward' ? <ForwardView portfolio={portfolio} /> : null}
          {route === 'categories' ? (
            <CategoriesView
              portfolio={portfolio}
              rules={rules}
              onRulesChange={setRules}
              onResetRules={reset}
            />
          ) : null}
          {route === 'transactions' ? (
            <TransactionsView portfolio={portfolio} rules={rules} />
          ) : null}
        </main>

        <footer className="px-5 pb-6 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Reports what the statements say and flags what looks wrong. It does not give financial
          advice.
        </footer>
      </div>
    </div>
  );
}

function Sidebar({
  route,
  navigate,
  counts,
  portfolioEmpty,
}: {
  route: Route;
  navigate: (r: Route) => void;
  counts: Record<Route, number>;
  portfolioEmpty: boolean;
}) {
  return (
    <nav
      className="hidden w-[232px] shrink-0 flex-col md:flex"
      style={{ background: 'var(--surface)', borderRight: '1px solid var(--line)' }}
      aria-label="Sections"
    >
      <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="text-[13px] font-semibold leading-tight tracking-tight">
          Statement Analyser
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--good)' }}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--good)' }} />
          processed on this device
        </div>
      </div>

      <ul className="flex-1 space-y-0.5 p-2">
        {NAV.map((item) => {
          const active = route === item.route;
          const count = counts[item.route];
          const disabled = portfolioEmpty && item.route !== 'upload';
          const Icon = item.icon;
          return (
            <li key={item.route}>
              <a
                href={href(item.route)}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.route);
                }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors',
                  disabled && 'opacity-45',
                )}
                style={{
                  background: active ? 'var(--surface-sunken)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink-secondary)',
                  boxShadow: active ? 'inset 2px 0 0 var(--accent)' : undefined,
                }}
              >
                <Icon size={14} className="mt-[2px] shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-medium">{item.label}</span>
                    {count > 0 ? (
                      <span
                        className="num rounded px-1.5 text-[10.5px] font-semibold"
                        style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}
                      >
                        {count > 999 ? '999+' : count}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
                    {item.description}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <div className="p-3 text-[10.5px] leading-relaxed" style={{ color: 'var(--ink-muted)', borderTop: '1px solid var(--line)' }}>
        Seylan parser live. Sampath next. No file leaves this tab.
      </div>
    </nav>
  );
}

function ThemeToggle({
  theme,
  onChange,
}: {
  theme: ThemeChoice;
  onChange: (t: ThemeChoice) => void;
}) {
  const order: ThemeChoice[] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(theme) + 1) % order.length]!;
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={`Theme: ${theme}. Click for ${next}.`}
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium"
      style={{ border: '1px solid var(--line-strong)', color: 'var(--ink-secondary)' }}
    >
      {theme === 'dark' ? <Moon size={12} aria-hidden /> : <Sun size={12} aria-hidden />}
      {theme}
    </button>
  );
}
