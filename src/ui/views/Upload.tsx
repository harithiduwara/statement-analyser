import { useCallback, useRef, useState } from 'react';
import { FileDown, FileUp, Lock } from 'lucide-react';
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
  onSubmitPassword,
  onExportExcel,
  onImportExcel,
  canExport,
}: {
  files: FileState[];
  busy: boolean;
  onAdd: (files: File[]) => void;
  onClear: () => void;
  onSubmitPassword: (fileName: string, password: string) => void;
  onExportExcel: () => Promise<void>;
  onImportExcel: (file: File) => Promise<{ read: number; issues: string[] }>;
  canExport: boolean;
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

      <div aria-live="polite" className="sr-only">
        {busy
          ? 'Reading statements…'
          : files.length > 0
            ? `${accepted} accepted, ${rejected} not added, ${failed} unreadable.`
            : ''}
      </div>

      <Panel>
        <PanelHeader
          title="Add statements"
          subtitle="Seylan and Sampath PDFs are supported, including scanned images and password-protected files."
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
            aria-busy={busy}
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
                  <FileRow key={`${file.fileName}-${i}`} file={file} onSubmitPassword={onSubmitPassword} />
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </Panel>

      <BackupRestore
        onExportExcel={onExportExcel}
        onImportExcel={onImportExcel}
        canExport={canExport}
      />

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

function BackupRestore({
  onExportExcel,
  onImportExcel,
  canExport,
}: {
  onExportExcel: () => Promise<void>;
  onImportExcel: (file: File) => Promise<{ read: number; issues: string[] }>;
  canExport: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const prefetched = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<{ read: number; issues: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Warm the lazy export chunks the moment the reader shows intent, so the
  // first click is instant -- and so they are cached from the deploy this tab
  // loaded, before a later deploy can replace the files they point at.
  const prefetch = (): void => {
    if (prefetched.current) return;
    prefetched.current = true;
    import('@/export/workbook').catch(() => {});
    import('@/export/importWorkbook').catch(() => {});
  };

  const doExport = async (): Promise<void> => {
    setError(null);
    setExporting(true);
    try {
      await onExportExcel();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The workbook could not be created.');
    } finally {
      setExporting(false);
    }
  };

  const doImport = async (file: File): Promise<void> => {
    setError(null);
    setNote(null);
    setImporting(true);
    try {
      setNote(await onImportExcel(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The workbook could not be read.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title="Back up & restore"
        subtitle="Save everything loaded as an Excel file — a readable report that also loads back here, so you never re-read a statement you already have."
      />
      <div className="p-4">
        <div className="flex flex-wrap gap-2" onMouseEnter={prefetch} onFocus={prefetch}>
          <Button variant="primary" onClick={() => void doExport()} disabled={!canExport || exporting}>
            <FileDown size={13} aria-hidden />
            {exporting ? 'Preparing…' : 'Export to Excel'}
          </Button>
          <Button onClick={() => inputRef.current?.click()} disabled={importing}>
            <FileUp size={13} aria-hidden />
            {importing ? 'Reading…' : 'Restore from Excel'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file);
              e.target.value = '';
            }}
          />
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          The workbook is built and read in this tab — nothing is uploaded. Restoring adds its
          statements alongside whatever is loaded; a cycle already present is skipped, never counted
          twice.
          {canExport ? '' : ' Load a statement first to export.'}
        </p>

        {note ? (
          <div
            className="mt-3 rounded-md px-3 py-2 text-[11.5px]"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-sunken)' }}
          >
            <p className="font-medium">
              Read {note.read} statement{note.read === 1 ? '' : 's'} from the workbook — see the list
              above for which were added and which were already loaded.
            </p>
            {note.issues.length > 0 ? (
              <ul className="mt-1.5 space-y-0.5" style={{ color: 'var(--ink-muted)' }}>
                {note.issues.slice(0, 6).map((issue, i) => (
                  <li key={i}>· {issue}</li>
                ))}
                {note.issues.length > 6 ? <li>· …and {note.issues.length - 6} more</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        {error ? (
          looksLikeStaleChunk(error) ? (
            <div
              className="mt-3 rounded-md px-3 py-2.5 text-[11.5px]"
              style={{ border: '1px solid var(--warning)' }}
            >
              <p className="font-medium" style={{ color: 'var(--warning)' }}>
                The app updated since this tab was opened.
              </p>
              <p className="mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
                The export tools could not load because this page is from an older version. Reload to
                get the latest, then export again. (Reloading clears loaded statements, so if you have
                not backed them up, note them first.)
              </p>
              <div className="mt-2">
                <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
                  Reload page
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[11.5px]" style={{ color: 'var(--critical)' }}>
              {error}
            </p>
          )
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * A dynamic import that fails almost always means this tab is from a deploy
 * whose chunk files a newer deploy has replaced -- the lazy export code 404s.
 * Reloading fixes it, so that failure gets its own actionable message.
 */
function looksLikeStaleChunk(message: string): boolean {
  return /module script|dynamically imported|failed to fetch|importing a module|load.*chunk|chunk.*load/i.test(
    message,
  );
}

function FileRow({
  file,
  onSubmitPassword,
}: {
  file: FileState;
  onSubmitPassword: (fileName: string, password: string) => void;
}) {
  if (file.kind === 'password') return <PasswordRow file={file} onSubmit={onSubmitPassword} />;
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
    case 'ocr':
      return <Chip tone="accent">reading image</Chip>;
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
    case 'password':
      return <Chip tone="warning">locked</Chip>;
  }
}

function detail(file: FileState): string {
  switch (file.kind) {
    case 'parsing':
      return 'Extracting the text layer…';
    case 'ocr':
      return (
        `This statement is an image, so it is being read by character recognition — ` +
        `page ${file.page} of ${file.pageCount}, ${file.status} ` +
        `${Math.round(file.progress * 100)}%. It stays on this device; the recogniser runs here.`
      );
    case 'ok': {
      const s = file.statement;
      const warnings = s.warnings.filter((w) => w.level !== 'info').length;
      return (
        `${s.issuer} ····${s.accountMask} · ${formatDate(s.statementDate)} · ` +
        `${s.transactions.length} transactions · closing ${formatMoney(s.closingBalance)}` +
        (s.source === 'ocr'
          ? ` · read by OCR at ${Math.round(s.ocrConfidence ?? 0)}% confidence`
          : '') +
        (warnings > 0 ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : '')
      );
    }
    case 'duplicate':
      return `Same cycle as ${file.existingFileName}, and the figures match. Not added again, so no total is counted twice.`;
    case 'conflict':
      return `Same cycle as ${file.existingFileName}, but the figures differ: ${file.detail}. Not added — one of the two readings is wrong, or the bank reissued this statement.`;
    case 'error':
      return file.message;
    case 'password':
      return 'This statement is password protected.';
  }
}

function PasswordRow({
  file,
  onSubmit,
}: {
  file: Extract<FileState, { kind: 'password' }>;
  onSubmit: (fileName: string, password: string) => void;
}) {
  const [value, setValue] = useState('');
  const submit = (): void => {
    if (value) onSubmit(file.fileName, value);
  };
  return (
    <li className="rounded-md px-3 py-2.5" style={{ border: '1px solid var(--warning)' }}>
      <div className="flex items-start gap-3 text-[11.5px]">
        <span className="mt-[2px] shrink-0">
          <Chip tone="warning">
            <Lock size={11} aria-hidden /> locked
          </Chip>
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-medium">{file.fileName}</span>
          <span
            className="mt-0.5 block leading-snug"
            style={{ color: file.wrong ? 'var(--critical)' : 'var(--ink-muted)' }}
          >
            {file.wrong
              ? 'That password did not work. Try again.'
              : 'This statement is password protected. Enter its password to unlock it — the password stays on this device.'}
          </span>
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              type="password"
              value={value}
              autoFocus
              placeholder="PDF password"
              aria-label={`Password for ${file.fileName}`}
              onChange={(e) => setValue(e.target.value)}
              className="min-w-0 flex-1 rounded-md px-2 py-1 text-[12px]"
              style={{ border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink)' }}
            />
            <Button variant="primary" size="sm" onClick={submit} disabled={!value}>
              Unlock
            </Button>
          </form>
        </div>
      </div>
    </li>
  );
}
