import type * as ExcelJS from 'exceljs';
import {
  type Statement,
  type Txn,
  type Issuer,
  type TxnClass,
  type RewardsBlock,
  type CardSubtotal,
  ISSUERS,
  TXN_CLASSES,
} from '@/domain/types';

/**
 * Restore statements from a workbook this app exported.
 *
 * Only the two authoritative sheets are read -- `Statements` and
 * `Transactions`; every report sheet is ignored and recomputed. The rebuild is
 * deliberately defensive: a workbook may have been opened and edited in Excel,
 * so each row is validated and a bad one is skipped with a note rather than
 * poisoning the analysis. Statement ids are recomputed from issuer, card and
 * date, so they stay the canonical dedupe key no matter what a cell was changed
 * to.
 *
 * exceljs is imported dynamically, so reading a workbook loads its weight only
 * when someone actually restores one.
 */

export interface ImportResult {
  statements: Statement[];
  /** Human-readable notes about rows that could not be read. */
  issues: string[];
}

export async function importWorkbook(data: ArrayBuffer | Uint8Array): Promise<ImportResult> {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const statementsSheet = wb.getWorksheet('Statements');
  const transactionsSheet = wb.getWorksheet('Transactions');
  if (!statementsSheet || !transactionsSheet) {
    throw new Error(
      "This file isn't a Statement Analyser workbook — it has no Statements and Transactions " +
        'sheets. Export one from here first, then it can be restored.',
    );
  }

  const issues: string[] = [];
  const byId = new Map<string, Statement>();
  const order: string[] = [];

  const sCol = headerMap(statementsSheet);
  statementsSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const issuer = text(cell(row, sCol, 'Issuer'));
    const mask = text(cell(row, sCol, 'Card'));
    const date = text(cell(row, sCol, 'Statement date'));
    if (!isIssuer(issuer)) {
      issues.push(`Statements row ${rowNumber}: unknown issuer "${issuer ?? ''}", skipped`);
      return;
    }
    if (!isIsoDate(date)) {
      issues.push(`Statements row ${rowNumber}: statement date is not a date, skipped`);
      return;
    }
    if (!mask) {
      issues.push(`Statements row ${rowNumber}: no card number, skipped`);
      return;
    }
    const id = `${issuer}:${mask}:${date}`;
    if (byId.has(id)) {
      issues.push(`Statements row ${rowNumber}: ${id} appears twice in the file, kept the first`);
      return;
    }

    const statement: Statement = {
      id,
      issuer,
      accountMask: mask,
      statementDate: date,
      paymentDueDate: isoOr(text(cell(row, sCol, 'Due date')), date),
      creditLimit: num(cell(row, sCol, 'Credit limit')) ?? 0,
      interestRateAnnual: num(cell(row, sCol, 'Rate (annual)')) ?? 0,
      openingBalance: num(cell(row, sCol, 'Opening')) ?? 0,
      charges: num(cell(row, sCol, 'Charges')) ?? 0,
      payments: num(cell(row, sCol, 'Payments')) ?? 0,
      financeCharge: num(cell(row, sCol, 'Finance charge')) ?? 0,
      closingBalance: num(cell(row, sCol, 'Closing')) ?? 0,
      minimumPayment: num(cell(row, sCol, 'Minimum due')) ?? 0,
      transactions: [],
      sourceFileName: text(cell(row, sCol, 'Source file')) ?? `${issuer}-${date}`,
      source: text(cell(row, sCol, 'Source')) === 'ocr' ? 'ocr' : 'text',
      warnings: [],
    };
    const pastDue = num(cell(row, sCol, 'Past due'));
    if (pastDue !== undefined) statement.pastDueAmount = pastDue;
    const ocr = num(cell(row, sCol, 'OCR confidence'));
    if (ocr !== undefined) statement.ocrConfidence = ocr;
    const pages = num(cell(row, sCol, 'Pages'));
    if (pages !== undefined) statement.pageCount = pages;
    const rewards = parseJson<RewardsBlock>(text(cell(row, sCol, 'Rewards (JSON)')));
    if (rewards) statement.rewards = rewards;
    const subtotals = parseJson<CardSubtotal[]>(text(cell(row, sCol, 'Card subtotals (JSON)')));
    if (subtotals) statement.cardSubtotals = subtotals;

    byId.set(id, statement);
    order.push(id);
  });

  const tCol = headerMap(transactionsSheet);
  transactionsSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const sid = text(cell(row, tCol, 'Statement ID'));
    const statement = sid ? byId.get(sid) : undefined;
    if (!statement) {
      issues.push(`Transactions row ${rowNumber}: no statement "${sid ?? ''}", skipped`);
      return;
    }
    const post = text(cell(row, tCol, 'Posted'));
    const amount = num(cell(row, tCol, 'Amount'));
    if (!isIsoDate(post)) {
      issues.push(`Transactions row ${rowNumber}: posted date is not a date, skipped`);
      return;
    }
    if (amount === undefined) {
      issues.push(`Transactions row ${rowNumber}: amount is not a number, skipped`);
      return;
    }
    const klass = text(cell(row, tCol, 'Class'));
    const txn: Txn = {
      id: '', // assigned once the statement's rows are all in, below
      postDate: post,
      txnDate: isoOr(text(cell(row, tCol, 'Transaction')), post),
      description: text(cell(row, tCol, 'Description')) ?? '',
      amount,
      classification: isTxnClass(klass) ? klass : 'purchase',
    };
    const reference = text(cell(row, tCol, 'Reference'));
    if (reference) txn.reference = reference;
    const category = text(cell(row, tCol, 'Category'));
    if (category) txn.category = category;
    const cardMask = text(cell(row, tCol, 'Card'));
    if (cardMask) txn.cardMask = cardMask;
    const seq = num(cell(row, tCol, 'Instalment no.'));
    if (seq !== undefined) txn.installmentSeq = seq;
    const term = num(cell(row, tCol, 'Instalment term'));
    if (term !== undefined) txn.installmentTerm = term;
    const code = text(cell(row, tCol, 'Currency'));
    const fxAmount = num(cell(row, tCol, 'FX amount'));
    if (code && fxAmount !== undefined) {
      const rate = num(cell(row, tCol, 'FX rate'));
      txn.currency = { code, amount: fxAmount, ...(rate !== undefined ? { impliedRate: rate } : {}) };
    }
    statement.transactions.push(txn);
  });

  // Give every transaction a stable, unique id now the groups are complete.
  for (const id of order) {
    const statement = byId.get(id)!;
    statement.transactions.forEach((txn, index) => {
      txn.id = `${id}#${index}`;
    });
  }

  return { statements: order.map((id) => byId.get(id)!), issues };
}

function headerMap(ws: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => {
    const header = text(c.value as unknown);
    if (header) map.set(header.trim(), col);
  });
  return map;
}

function cell(row: ExcelJS.Row, columns: ReadonlyMap<string, number>, name: string): unknown {
  const col = columns.get(name);
  if (col === undefined) return undefined;
  return row.getCell(col).value as unknown;
}

/** Read any exceljs cell value as plain text, unwrapping its richer shapes. */
function text(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as { text?: unknown; result?: unknown; richText?: { text?: string }[] };
    if (typeof v.text === 'string') return v.text;
    if ('result' in v) return text(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text ?? '').join('');
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const t = text(value);
  if (t === undefined) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function parseJson<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function isIssuer(value: string | undefined): value is Issuer {
  return value !== undefined && (ISSUERS as readonly string[]).includes(value);
}

function isTxnClass(value: string | undefined): value is TxnClass {
  return value !== undefined && (TXN_CLASSES as readonly string[]).includes(value);
}

function isIsoDate(value: string | undefined): value is string {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isoOr(value: string | undefined, fallback: string): string {
  return isIsoDate(value) ? value : fallback;
}
