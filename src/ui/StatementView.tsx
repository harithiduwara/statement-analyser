import type { Reconciliation, Statement, Txn } from '@/domain/types';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { Badge, Card, CardHeader, Num, type Tone } from './primitives';
import { cn } from './lib';

export function StatementView({
  statement,
  reconciliation,
}: {
  statement: Statement;
  reconciliation: Reconciliation;
}) {
  return (
    <Card>
      <CardHeader
        title={`${statement.issuer === 'seylan' ? 'Seylan Bank' : 'Sampath Bank'} ···· ${statement.accountMask}`}
        subtitle={`Statement ${formatDate(statement.statementDate)}${
          statement.paymentDueDate ? ` · due ${formatDate(statement.paymentDueDate)}` : ''
        } · ${statement.sourceFileName}`}
        aside={
          reconciliation.passes ? (
            <Badge tone="pass">reconciles exactly</Badge>
          ) : (
            <Badge tone="fail">off by {formatMoney(reconciliation.delta)}</Badge>
          )
        }
      />

      <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Reconciled reconciliation={reconciliation} statement={statement} />
          <Terms statement={statement} />
          {statement.cardSubtotals?.length ? <Subtotals statement={statement} /> : null}
          {statement.rewards ? <Rewards statement={statement} /> : null}
        </div>
        <div className="space-y-6 min-w-0">
          <Transactions transactions={statement.transactions} />
          <Warnings statement={statement} />
        </div>
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, value, strong, rule }: { label: string; value: string; strong?: boolean; rule?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1 text-xs',
        rule && 'border-t border-neutral-200 pt-1.5 dark:border-neutral-800',
        strong && 'font-semibold',
      )}
    >
      <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
      <Num>{value}</Num>
    </div>
  );
}

function Reconciled({ reconciliation, statement }: { reconciliation: Reconciliation; statement: Statement }) {
  return (
    <Section title="Reconciliation — LKR">
      <Row label="Opening balance" value={formatMoney(reconciliation.opening)} />
      <Row label="+ Charges" value={formatMoney(reconciliation.charges)} />
      <Row label="− Payments & credits" value={formatMoney(reconciliation.payments)} />
      <Row label="= Computed closing" value={formatMoney(reconciliation.computedClosing)} rule />
      <Row label="Printed closing" value={formatMoney(reconciliation.printedClosing)} />
      <Row label="Difference" value={formatMoney(reconciliation.delta)} strong rule />
      <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
        Line items sum to <Num>{formatMoney(reconciliation.transactionSum)}</Num>, which{' '}
        {reconciliation.transactionsMatchHeader ? 'agrees with' : 'disagrees with'} the header.
        {' '}Finance charge of <Num>{formatMoney(statement.financeCharge)}</Num> is the disclosed
        interest portion, already inside the charges total.
      </p>
      {reconciliation.hint ? (
        <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {reconciliation.hint}
        </p>
      ) : null}
    </Section>
  );
}

function Terms({ statement }: { statement: Statement }) {
  return (
    <Section title="Terms">
      <Row label="Credit limit" value={formatMoney(statement.creditLimit)} />
      <Row label="Interest rate" value={`${(statement.interestRateAnnual * 100).toFixed(2)}% p.a.`} />
      <Row label="Minimum payment due" value={formatMoney(statement.minimumPayment)} />
      {statement.pastDueAmount !== undefined ? (
        <Row label="Past due" value={formatMoney(statement.pastDueAmount)} />
      ) : null}
    </Section>
  );
}

function Subtotals({ statement }: { statement: Statement }) {
  return (
    <Section title="Per-card subtotals">
      {statement.cardSubtotals?.map((s) => (
        <div key={s.cardMask} className="flex items-baseline justify-between gap-3 py-1 text-xs">
          <span className="text-neutral-600 dark:text-neutral-400">···· {s.cardMask}</span>
          <span className="flex items-baseline gap-2">
            <Num>{formatMoney(s.amount)}</Num>
            <Badge tone={s.matches ? 'pass' : 'fail'}>{s.matches ? 'agrees' : 'mismatch'}</Badge>
          </span>
        </div>
      ))}
    </Section>
  );
}

function Rewards({ statement }: { statement: Statement }) {
  const r = statement.rewards;
  if (!r) return null;

  if (!r.reconciled) {
    return (
      <Section title="Reward points">
        <p className="rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          Unreconciled. No assignment of the printed values{' '}
          ({r.observed.join(', ')}) satisfies opening + accumulated − redeemed − adjusted = balance,
          so none has been assumed.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Reward points">
      <Row label="Balance" value={String(r.balance ?? '—')} strong />
      {r.additivePair ? (
        <>
          <Row label="Added (opening, earned)" value={r.additivePair.join('  ·  ')} />
          <Row label="Subtracted (redeemed, adjusted)" value={r.subtractivePair?.join('  ·  ') ?? '—'} />
          <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            The identity holds, but the printed labels are mis-aligned with their values, so the
            order within each pair is not yet determined. Loading the previous cycle resolves it.
          </p>
        </>
      ) : (
        <>
          <Row label="Opening" value={String(r.opening ?? '—')} />
          <Row label="Accumulated" value={String(r.accumulated ?? '—')} />
          <Row label="Redeemed" value={String(r.redeemed ?? '—')} />
          <Row label="Adjusted" value={String(r.adjusted ?? '—')} />
        </>
      )}
    </Section>
  );
}

const CLASS_TONE: Partial<Record<Txn['classification'], Tone>> = {
  payment: 'info',
  reversal: 'info',
  interest: 'warn',
  installment_repayment: 'warn',
  installment_processing_fee: 'warn',
  annual_fee: 'warn',
  stamp_duty: 'warn',
  fuel_surcharge: 'warn',
};

function Transactions({ transactions }: { transactions: Txn[] }) {
  return (
    <Section title={`Transactions (${transactions.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-xs">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <th className="py-1.5 pr-3 font-medium">Posted</th>
              <th className="py-1.5 pr-3 font-medium">Card</th>
              <th className="py-1.5 pr-3 font-medium">Description</th>
              <th className="py-1.5 pr-3 text-right font-medium">Amount (LKR)</th>
              <th className="py-1.5 font-medium">Class</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-b border-neutral-100 align-top dark:border-neutral-800/60">
                <td className="whitespace-nowrap py-1.5 pr-3 text-neutral-600 dark:text-neutral-400">
                  {t.postDate.slice(5)}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-neutral-500 dark:text-neutral-500">
                  {t.cardMask ?? '—'}
                </td>
                <td className="py-1.5 pr-3">
                  {t.description}
                  {t.currency ? (
                    <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                      {t.currency.code} {t.currency.amount.toFixed(2)} · implied{' '}
                      {t.currency.impliedRate?.toFixed(2)} LKR/{t.currency.code}
                    </span>
                  ) : null}
                  {t.installmentSeq ? (
                    <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                      instalment {t.installmentSeq} of {t.installmentTerm}
                      {t.installmentPlanId ? ` · ${t.installmentPlanId}` : ''}
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-3 text-right">
                  <Num>{formatMoney(t.amount)}</Num>
                </td>
                <td className="py-1.5">
                  <Badge tone={CLASS_TONE[t.classification] ?? 'neutral'}>
                    {t.classification.replace(/_/g, ' ')}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Warnings({ statement }: { statement: Statement }) {
  if (statement.warnings.length === 0) {
    return (
      <Section title="Parser notes">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Nothing flagged. Every field was found and every internal check passed.
        </p>
      </Section>
    );
  }
  return (
    <Section title={`Parser notes (${statement.warnings.length})`}>
      <ul className="space-y-1.5">
        {statement.warnings.map((w, i) => (
          <li key={`${w.code}-${i}`} className="flex items-start gap-2 text-xs">
            <Badge tone={w.level === 'error' ? 'fail' : w.level === 'warning' ? 'warn' : 'info'}>
              {w.level}
            </Badge>
            <span className="text-neutral-600 dark:text-neutral-400">{w.message}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
