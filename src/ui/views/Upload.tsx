import { useCallback, useRef, useState } from 'react';
import type { FileState } from '@/state/useStatementLibrary';
import { Button, Chip, EmptyState, Panel, PanelHeader } from '../primitives';
import { cn } from '../lib';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';

export function UploadView({
  files,
  busy,
  onAdd,
  onClear,
}: {
  files: FileState[];
  busy: boolean;
  onAdd: (files: File[]) => void;
  onClear: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const takePdfs = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const pdfs = [...list].filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (pdfs.length > 0) onAdd(pdfs);
    },
    [onAdd],
  );

  const accepted = files.filter((f) => f.kind === 'ok').length;
  const rejected = files.filter((f) => f.kind === 'duplicate' || f.kind === 'conflict').length;
  const failed = files.filter((f) => f.kind === 'error').length;

  return (
    <div className="space-y-4">
      <PrivacyBanner />

      <Panel>
        <PanelHeader
          title="Add statements"
          subtitle="Seylan PDFs are supported today. Sampath is next."
          aside={
            files.length > 0 ? (
              <Button variant="danger" size="sm" onClick={onClear}>
                Clear all data
              </Button>
            ) : null
          }
        />
        <div className="p-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              takePdfs(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
            }}
            role="button"
            tabIndex={0}
            aria-label="Choose statement PDFs"
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-md px-6 py-12 text-center transition-colors',
            )}
            style={{
              border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--line-strong)'}`,
              background: dragging ? 'var(--surface-sunken)' : 'transparent',
            }}
          >
            <p className="text-[13px] font-semibold">
              {busy ? 'Reading…' : 'Drop credit card statement PDFs here'}
            </p>
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              or click to choose files — several at once is fine
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                takePdfs(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {files.length > 0 ? (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                <Chip tone="good">{accepted} accepted</Chip>
                {rejected > 0 ? <Chip tone="warning">{rejected} not added</Chip> : null}
                {failed > 0 ? <Chip tone="critical">{failed} unreadable</Chip> : null}
              </div>
              <ul className="mt-3 space-y-1.5">
                {files.map((file, i) => (
                  <FileRow key={`${file.fileName}-${i}`} file={file} />
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </Panel>

      {files.length === 0 ? (
        <EmptyState title="Nothing loaded yet">
          Every figure in this app is derived from the statements you add here, in this browser tab.
          Reload the page and it starts empty again.
        </EmptyState>
      ) : null}
    </div>
  );
}

function PrivacyBanner() {
  return (
    <div
      className="panel px-4 py-3"
      style={{ borderColor: 'var(--good)', background: 'var(--surface)' }}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-[5px] h-2 w-2 shrink-0 rounded-full"
          style={{ background: 'var(--good)' }}
        />
        <div className="text-[12px] leading-relaxed">
          <p className="font-semibold">Your statements stay on this device.</p>
          <p className="mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
            PDFs are read inside this browser tab. There is no upload endpoint, no third-party API
            and no analytics script — the page has nowhere to send a statement even if something
            tried. Card numbers are cut to their last four digits while the file is being read,
            before anything is displayed. Nothing is saved: close or reload the tab and it is gone.
          </p>
        </div>
      </div>
    </div>
  );
}

function FileRow({ file }: { file: FileState }) {
  return (
    <li
      className="flex items-start gap-3 rounded-md px-3 py-2 text-[11.5px]"
      style={{ border: '1px solid var(--line)' }}
    >
      <span className="mt-[1px] shrink-0">{statusChip(file)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{file.fileName}</span>
        <span className="mt-0.5 block leading-snug" style={{ color: 'var(--ink-muted)' }}>
          {detail(file)}
        </span>
      </span>
    </li>
  );
}

function statusChip(file: FileState) {
  switch (file.kind) {
    case 'parsing':
      return <Chip>reading</Chip>;
    case 'ok':
      return file.reconciliation.passes ? (
        <Chip tone="good">reconciles</Chip>
      ) : (
        <Chip tone="critical">does not reconcile</Chip>
      );
    case 'duplicate':
      return <Chip tone="warning">duplicate</Chip>;
    case 'conflict':
      return <Chip tone="critical">conflict</Chip>;
    case 'error':
      return <Chip tone="critical">unreadable</Chip>;
  }
}

function detail(file: FileState): string {
  switch (file.kind) {
    case 'parsing':
      return 'Extracting the text layer…';
    case 'ok': {
      const s = file.statement;
      const warnings = s.warnings.filter((w) => w.level !== 'info').length;
      return (
        `${s.issuer} ····${s.accountMask} · ${formatDate(s.statementDate)} · ` +
        `${s.transactions.length} transactions · closing ${formatMoney(s.closingBalance)}` +
        (warnings > 0 ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : '')
      );
    }
    case 'duplicate':
      return `Same cycle as ${file.existingFileName}, and the figures match. Not added again, so no total is counted twice.`;
    case 'conflict':
      return `Same cycle as ${file.existingFileName}, but the figures differ: ${file.detail}. Not added — one of the two readings is wrong, or the bank reissued this statement.`;
    case 'error':
      return file.message;
  }
}
