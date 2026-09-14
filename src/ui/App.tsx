import { useStatementLibrary } from '@/state/useStatementLibrary';
import { UploadPanel } from './UploadPanel';
import { StatementView } from './StatementView';

export function App() {
  const { files, statements, addFiles, clearAll, busy } = useStatementLibrary();
  const parsed = files.flatMap((f) => (f.kind === 'ok' ? [f] : []));

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-2 px-4 py-4">
          <h1 className="text-base font-semibold tracking-tight">
            Credit Card Statement Analyser
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Seylan parser · reconciliation engine
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <PrivacyNotice />
        <UploadPanel files={files} busy={busy} onAdd={addFiles} onClear={clearAll} />

        {parsed.map((file) => (
          <StatementView
            key={file.statement.id}
            statement={file.statement}
            reconciliation={file.reconciliation}
          />
        ))}

        {statements.length === 0 ? <WhatThisDoes /> : null}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-[11px] text-neutral-500 dark:text-neutral-400">
        Reports what the statements say and flags what looks wrong. It does not give financial advice.
      </footer>
    </div>
  );
}

function PrivacyNotice() {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
      <p className="font-semibold">Your statements stay on this device.</p>
      <p className="mt-1 leading-relaxed">
        PDFs are read inside this browser tab. There is no upload endpoint, no third-party API and
        no analytics script — the page has nowhere to send a statement even if something tried.
        Card numbers are cut to their last four digits while the file is being read, before
        anything is displayed. Nothing is saved: close or reload the tab and it is gone.
      </p>
    </div>
  );
}

function WhatThisDoes() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-4 text-xs leading-relaxed text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
      <p className="font-semibold text-neutral-900 dark:text-neutral-100">What works so far</p>
      <p className="mt-1.5">
        Seylan statements are parsed and checked against the reconciliation invariant
        (opening + charges − payments = closing). Every figure is read from its column position
        rather than from flattened page text, so credits marked <code>CR</code> keep their sign,
        foreign-currency legs stay attached to their purchase, and per-card subtotals are
        cross-checked against the header.
      </p>
      <p className="mt-2">
        Uploading the same cycle twice is refused rather than double-counted — and if two files
        claim the same cycle with different figures, that is reported as a conflict rather than
        treated as a harmless repeat.
      </p>
      <p className="mt-2">
        Still to come: the Sampath parser, the reversal matcher that separates real payments from
        instalment reversals, the instalment plan register and cost of credit, the forward
        schedule, and the Excel export.
      </p>
    </div>
  );
}
