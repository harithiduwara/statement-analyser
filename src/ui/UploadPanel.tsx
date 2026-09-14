import { useCallback, useRef, useState } from 'react';
import type { FileState } from '@/state/useStatementLibrary';
import { Badge, Button, Card, CardHeader } from './primitives';
import { cn } from './lib';

export function UploadPanel({
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

  return (
    <Card>
      <CardHeader
        title="Statements"
        subtitle={`${files.length} file${files.length === 1 ? '' : 's'} in this session`}
        aside={files.length > 0 ? <Button variant="danger" onClick={onClear}>Clear all data</Button> : null}
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
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600',
            dragging
              ? 'border-sky-400 bg-sky-50 dark:border-sky-600 dark:bg-sky-950/40'
              : 'border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/50',
          )}
        >
          <p className="text-sm font-medium">
            {busy ? 'Reading…' : 'Drop credit card statement PDFs here'}
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
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
          <ul className="mt-4 space-y-1.5">
            {files.map((file, i) => (
              <FileRow key={`${file.fileName}-${i}`} file={file} />
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function FileRow({ file }: { file: FileState }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
      <span className="mt-0.5 shrink-0">{statusBadge(file)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{file.fileName}</span>
        <span className="mt-0.5 block text-neutral-500 dark:text-neutral-400">{detail(file)}</span>
      </span>
    </li>
  );
}

function statusBadge(file: FileState) {
  switch (file.kind) {
    case 'parsing':
      return <Badge>reading</Badge>;
    case 'ok':
      return file.reconciliation.passes ? (
        <Badge tone="pass">reconciles</Badge>
      ) : (
        <Badge tone="fail">does not reconcile</Badge>
      );
    case 'duplicate':
      return <Badge tone="warn">duplicate</Badge>;
    case 'conflict':
      return <Badge tone="fail">conflict</Badge>;
    case 'error':
      return <Badge tone="fail">unreadable</Badge>;
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
        `${s.issuer} ····${s.accountMask} · statement ${s.statementDate} · ` +
        `${s.transactions.length} transactions` +
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
