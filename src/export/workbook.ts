import type * as ExcelJS from 'exceljs';
import { type Statement, ISSUER_LABEL } from '@/domain/types';
import { EXCEL_MONEY_FORMAT } from '@/lib/money';
import type { Portfolio } from '@/analysis/portfolio';
import { type CategoryRule, compileRules, breakdownByCategory } from '@/analysis/categories';
import { buildTimeline } from '@/analysis/timeline';
import { downloadBlob, todayStamp } from './download';

/**
 * The Excel export.
 *
 * The workbook is two things at once. The `Statements` and `Transactions`
 * sheets are the *authoritative* record: between them they carry every field
 * needed to rebuild the exact statements, so the file re-imports losslessly and
 * is the app's portable save -- load it back and you never re-read the same PDF.
 * The remaining sheets are *derived* reports for reading; the importer ignores
 * them and recomputes everything from the two authoritative sheets.
 *
 * Nothing here reaches the network: exceljs builds the workbook in the page and
 * the browser downloads it. exceljs is imported dynamically (and its types are
 * imported type-only) so its weight loads only when someone actually exports.
 */

/** Stamped into the workbook so the importer can recognise its own format. */
export const WORKBOOK_MARKER = 'statement-analyser-workbook';
export const WORKBOOK_VERSION = 1;

const PCT = '0.00%';

export async function buildWorkbookBuffer(
  portfolio: Portfolio,
  rules: readonly CategoryRule[],
): Promise<ArrayBuffer> {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  wb.creator = 'Statement Analyser';
  wb.created = new Date();
  // A marker the importer checks before trusting the sheets.
  wb.description = `${WORKBOOK_MARKER} v${WORKBOOK_VERSION}`;

  writeStatementsSheet(wb, portfolio.statements);
  writeTransactionsSheet(wb, portfolio.statements);
  writePositionsSheet(wb, portfolio);
  writeCyclesSheet(wb, portfolio);
  writeInstalmentsSheet(wb, portfolio);
  writeCategoriesSheet(wb, portfolio, rules);
  writeCashflowSheet(wb, portfolio);
  writeTimelineSheet(wb, portfolio);

  return wb.xlsx.writeBuffer();
}

export async function downloadWorkbook(
  portfolio: Portfolio,
  rules: readonly CategoryRule[],
): Promise<void> {
  const buffer = await buildWorkbookBuffer(portfolio, rules);
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `statement-analyser-${todayStamp()}.xlsx`,
  );
}

interface Column {
  header: string;
  key: string;
  width: number;
  money?: boolean;
  pct?: boolean;
}

/** Add a sheet, set its columns, freeze and bold the header, and format money. */
function sheet(wb: ExcelJS.Workbook, name: string, columns: Column[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  for (const c of columns) {
    if (c.money) ws.getColumn(c.key).numFmt = EXCEL_MONEY_FORMAT;
    if (c.pct) ws.getColumn(c.key).numFmt = PCT;
  }
  return ws;
}

/** Null for an absent optional, so the cell is blank rather than `undefined`. */
function opt<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function writeStatementsSheet(wb: ExcelJS.Workbook, statements: readonly Statement[]): void {
  const ws = sheet(wb, 'Statements', [
    { header: 'Statement ID', key: 'id', width: 28 },
    { header: 'Issuer', key: 'issuer', width: 10 },
    { header: 'Card', key: 'accountMask', width: 8 },
    { header: 'Statement date', key: 'statementDate', width: 14 },
    { header: 'Due date', key: 'paymentDueDate', width: 14 },
    { header: 'Opening', key: 'openingBalance', width: 14, money: true },
    { header: 'Charges', key: 'charges', width: 14, money: true },
    { header: 'Payments', key: 'payments', width: 14, money: true },
    { header: 'Finance charge', key: 'financeCharge', width: 14, money: true },
    { header: 'Closing', key: 'closingBalance', width: 14, money: true },
    { header: 'Minimum due', key: 'minimumPayment', width: 14, money: true },
    { header: 'Past due', key: 'pastDueAmount', width: 12, money: true },
    { header: 'Credit limit', key: 'creditLimit', width: 14, money: true },
    { header: 'Rate (annual)', key: 'interestRateAnnual', width: 12 },
    { header: 'Source', key: 'source', width: 8 },
    { header: 'OCR confidence', key: 'ocrConfidence', width: 13 },
    { header: 'Pages', key: 'pageCount', width: 7 },
    { header: 'Source file', key: 'sourceFileName', width: 28 },
    { header: 'Rewards (JSON)', key: 'rewardsJson', width: 20 },
    { header: 'Card subtotals (JSON)', key: 'cardSubtotalsJson', width: 20 },
  ]);

  for (const s of statements) {
    ws.addRow({
      id: s.id,
      issuer: s.issuer,
      accountMask: s.accountMask,
      statementDate: s.statementDate,
      paymentDueDate: s.paymentDueDate,
      openingBalance: s.openingBalance,
      charges: s.charges,
      payments: s.payments,
      financeCharge: s.financeCharge,
      closingBalance: s.closingBalance,
      minimumPayment: s.minimumPayment,
      pastDueAmount: opt(s.pastDueAmount),
      creditLimit: s.creditLimit,
      interestRateAnnual: s.interestRateAnnual,
      source: s.source,
      ocrConfidence: opt(s.ocrConfidence),
      pageCount: opt(s.pageCount),
      sourceFileName: s.sourceFileName,
      rewardsJson: s.rewards ? JSON.stringify(s.rewards) : '',
      cardSubtotalsJson: s.cardSubtotals ? JSON.stringify(s.cardSubtotals) : '',
    });
  }
}

function writeTransactionsSheet(wb: ExcelJS.Workbook, statements: readonly Statement[]): void {
  const ws = sheet(wb, 'Transactions', [
    { header: 'Statement ID', key: 'statementId', width: 28 },
    { header: 'Posted', key: 'postDate', width: 12 },
    { header: 'Transaction', key: 'txnDate', width: 12 },
    { header: 'Reference', key: 'reference', width: 16 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Amount', key: 'amount', width: 14, money: true },
    { header: 'Class', key: 'classification', width: 22 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Card', key: 'cardMask', width: 8 },
    { header: 'Instalment no.', key: 'installmentSeq', width: 12 },
    { header: 'Instalment term', key: 'installmentTerm', width: 13 },
    { header: 'Currency', key: 'currencyCode', width: 9 },
    { header: 'FX amount', key: 'currencyAmount', width: 12 },
    { header: 'FX rate', key: 'currencyRate', width: 12 },
  ]);

  for (const s of statements) {
    for (const t of s.transactions) {
      ws.addRow({
        statementId: s.id,
        postDate: t.postDate,
        txnDate: t.txnDate,
        reference: opt(t.reference),
        description: t.description,
        amount: t.amount,
        classification: t.classification,
        category: opt(t.category),
        cardMask: opt(t.cardMask),
        installmentSeq: opt(t.installmentSeq),
        installmentTerm: opt(t.installmentTerm),
        currencyCode: opt(t.currency?.code),
        currencyAmount: opt(t.currency?.amount),
        currencyRate: opt(t.currency?.impliedRate),
      });
    }
  }
}

function writePositionsSheet(wb: ExcelJS.Workbook, portfolio: Portfolio): void {
  const ws = sheet(wb, 'Positions', [
    { header: 'Issuer', key: 'issuer', width: 14 },
    { header: 'Card', key: 'card', width: 8 },
    { header: 'Latest cycle', key: 'latest', width: 14 },
    { header: 'Due', key: 'due', width: 14 },
    { header: 'Balance', key: 'balance', width: 14, money: true },
    { header: 'Limit', key: 'limit', width: 14, money: true },
    { header: 'Utilisation', key: 'util', width: 12, pct: true },
    { header: 'Rate (annual)', key: 'rate', width: 12, pct: true },
    { header: 'Minimum due', key: 'min', width: 14, money: true },
  ]);
  for (const p of portfolio.positions) {
    ws.addRow({
      issuer: ISSUER_LABEL[p.issuer],
      card: p.accountMask,
      latest: p.latestStatementDate,
      due: p.paymentDueDate,
      balance: p.currentBalance,
      limit: p.creditLimit,
      util: opt(p.utilisation),
      rate: p.interestRateAnnual,
      min: p.minimumPayment,
    });
  }
}

function writeCyclesSheet(wb: ExcelJS.Workbook, portfolio: Portfolio): void {
  const ws = sheet(wb, 'Cycles', [
    { header: 'Statement ID', key: 'id', width: 28 },
    { header: 'Opening', key: 'opening', width: 14, money: true },
    { header: 'Charges', key: 'charges', width: 14, money: true },
    { header: 'Payments', key: 'payments', width: 14, money: true },
    { header: 'Computed closing', key: 'computed', width: 16, money: true },
    { header: 'Printed closing', key: 'printed', width: 16, money: true },
    { header: 'Delta', key: 'delta', width: 12, money: true },
    { header: 'Reconciles', key: 'passes', width: 11 },
  ]);
  for (const r of portfolio.reconciliations) {
    ws.addRow({
      id: r.statementId,
      opening: r.opening,
      charges: r.charges,
      payments: r.payments,
      computed: r.computedClosing,
      printed: r.printedClosing,
      delta: r.delta,
      passes: r.passes ? 'yes' : 'no',
    });
  }
}

function writeInstalmentsSheet(wb: ExcelJS.Workbook, portfolio: Portfolio): void {
  const ws = sheet(wb, 'Instalments', [
    { header: 'Issuer', key: 'issuer', width: 10 },
    { header: 'Merchant', key: 'merchant', width: 30 },
    { header: 'Term', key: 'term', width: 7 },
    { header: 'Paid', key: 'latest', width: 7 },
    { header: 'Remaining', key: 'remaining', width: 10 },
    { header: 'Monthly', key: 'monthly', width: 14, money: true },
    { header: 'Remaining value', key: 'remainingValue', width: 16, money: true },
    { header: 'Principal', key: 'principal', width: 14, money: true },
    { header: 'Effective APR', key: 'apr', width: 13, pct: true },
    { header: 'Financing cost', key: 'cost', width: 14, money: true },
  ]);
  for (const p of portfolio.register.plans) {
    ws.addRow({
      issuer: p.issuer,
      merchant: p.merchant,
      term: p.termCount,
      latest: p.latestInstallment,
      remaining: p.remaining,
      monthly: p.monthly,
      remainingValue: p.remainingValue,
      principal: opt(p.originalPrincipal),
      apr: opt(p.effectiveApr),
      cost: opt(p.financingCost),
    });
  }
}

function writeCategoriesSheet(
  wb: ExcelJS.Workbook,
  portfolio: Portfolio,
  rules: readonly CategoryRule[],
): void {
  const breakdown = breakdownByCategory(
    portfolio.statements,
    compileRules(rules),
    portfolio.reversals,
    portfolio.register,
    'economic',
  );
  const ws = sheet(wb, 'Categories', [
    { header: 'Category', key: 'category', width: 24 },
    { header: 'Amount', key: 'amount', width: 16, money: true },
    { header: 'Transactions', key: 'count', width: 13 },
    { header: 'Share', key: 'share', width: 10, pct: true },
  ]);
  for (const t of breakdown.totals) {
    ws.addRow({ category: t.category, amount: t.amount, count: t.count, share: t.share });
  }
}

function writeCashflowSheet(wb: ExcelJS.Workbook, portfolio: Portfolio): void {
  const ws = sheet(wb, 'Cash flow', [
    { header: 'Month', key: 'month', width: 12 },
    { header: 'In (paid)', key: 'moneyIn', width: 14, money: true },
    { header: 'Out (spent)', key: 'moneyOut', width: 14, money: true },
    { header: 'Net', key: 'net', width: 14, money: true },
  ]);
  for (const f of portfolio.flow) {
    ws.addRow({ month: f.month, moneyIn: f.moneyIn, moneyOut: f.moneyOut, net: f.net });
  }
}

function writeTimelineSheet(wb: ExcelJS.Workbook, portfolio: Portfolio): void {
  const ws = sheet(wb, 'Timeline', [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Kind', key: 'kind', width: 12 },
    { header: 'Event', key: 'title', width: 36 },
    { header: 'Detail', key: 'detail', width: 60 },
    { header: 'Amount', key: 'amount', width: 14, money: true },
  ]);
  for (const e of buildTimeline(portfolio)) {
    ws.addRow({
      date: e.date,
      kind: e.kind,
      title: e.title,
      detail: e.detail,
      amount: e.amount ?? e.balance ?? null,
    });
  }
}
