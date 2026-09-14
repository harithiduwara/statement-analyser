import { type ParseWarning, type Statement, type Txn } from '@/domain/types';
import { parseDate } from '@/lib/dates';
import { moneyEquals, parseAmount, roundMoney, sumMoney } from '@/lib/money';
import { maskCardNumber, scrubPan } from '@/lib/mask';
import { classifyTxn } from '../classify';
import { tokenise } from '../headerGrid';
import { registerParser, type ParseResult, type StatementParser } from '../parser';
import { allLines, type Line } from '../textLayer';

/**
 * Sampath Bank credit card e-statement adapter.
 *
 * Layout notes that drive the implementation, from the printed statement:
 *  - The header is trilingual: an English label row, a row of mojibake where
 *    the Sinhala/Tamil glyphs failed to map to Unicode, and a Tamil row, then
 *    the value row. Only the English is usable, so the value rows are found by
 *    their own shape (account + dates + amounts) rather than by pairing with a
 *    label row -- pairing would catch the mojibake row in between.
 *  - The header repeats on every page with identical totals, so it is read
 *    once and its rows are skipped when collecting transactions.
 *  - Reconciliation is `opening + debits - credits = clearing`. "Credits" is
 *    gross: it includes both payments and the reversals of instalment
 *    originations. The ReversalMatcher separates the two downstream; here the
 *    printed totals are taken as-is so the invariant is checked against what
 *    the bank actually stated.
 *  - Rows are `PostDate TranDate Description [ (CUR - n.nn) ] Amount`, with a
 *    trailing `CR` for credits. A foreign purchase carries its original
 *    amount inline before the LKR amount, not on a continuation line.
 *  - The reversal-and-plan mechanic appears in full: an origination debit, a
 *    same-amount `CR` the next day, then an INSTALLMENT REPAYMENT and a
 *    recurring INSTALLMENT PROCESSING FEES line. The fee line carries no `n/m`
 *    marker, so it inherits the plan of the repayment it follows.
 *  - There is no finance-charge field; interest is a `(*)INTEREST CHARGED`
 *    transaction line. `(*)` marks account-level rows that name no merchant.
 */

/** A transaction row: two dates, a description, then the amount. */
const TXN_LEAD_RE = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.*)$/;

/** A printed amount, optionally carrying a trailing CR/DR credit marker. */
const AMT = String.raw`[\d,]+\.\d{2}(?:\s?(?:CR|DR))?`;

/** Band-1 value row: account, statement date, outstanding, due date, min. */
const HEADER_ROW_RE = new RegExp(
  String.raw`(\d[\dX\s]{6,}\d)\s+(\d{2}\/\d{2}\/\d{4})\s+(${AMT})\s+(\d{2}\/\d{2}\/\d{4})\s+(${AMT})`,
  'i',
);

/**
 * Band-2 value row: page marker, opening, debits, credits, clearing. The
 * opening balance prints with a CR suffix when the account was in credit
 * (overpaid) at the start of the cycle, so every figure here is CR-aware.
 */
const TOTALS_ROW_RE = new RegExp(
  String.raw`Page\s+\d+\s+of\s+\d+\s+(${AMT})\s+(${AMT})\s+(${AMT})\s+(${AMT})`,
  'i',
);

/** Inline foreign leg, e.g. `(USD - 5.00)`. */
const FOREIGN_RE = /\(([A-Z]{3})\s*-\s*([\d,]+(?:\.\d{1,2})?)\)/;

/** Structural rows that lead with a date-shaped run but are not transactions. */
const NON_TXN_RE = /\bSUB\s*TOTAL\b|\bTOTAL\s+DEBITS\b|\bBALANCE\s+B\/?F\b/i;

class Warnings {
  readonly list: ParseWarning[] = [];
  add(level: ParseWarning['level'], code: string, message: string, context?: string): void {
    this.list.push({
      level,
      code,
      message,
      ...(context === undefined ? {} : { context: scrubPan(context) }),
    });
  }
}

export const sampathParser: StatementParser = {
  issuer: 'sampath',
  label: 'Sampath Bank',

  detect(doc) {
    const text = allLines(doc).map((l) => l.text).join('\n');
    let score = 0;
    if (/\bSAMPATH\b/i.test(text)) score += 0.5;
    if (/SAMPATH\s+CREDIT\s+CARD\s+ACCOUNT/i.test(text)) score += 0.3;
    if (/\bClearing\s+Balance\b/i.test(text)) score += 0.15;
    if (/Annualized\s+Interest\s+Rate/i.test(text)) score += 0.1;
    // Guard against a Seylan statement that merely mentions Sampath.
    if (/\bSEYLAN\s*BANK\b/i.test(text) && !/\bSAMPATH\s*BANK\b/i.test(text)) score -= 0.5;
    return Math.max(0, Math.min(1, score));
  },

  parse(doc): ParseResult {
    const warnings = new Warnings();
    const lines = allLines(doc);

    const header = readHeader(lines, warnings);
    const transactions = readTransactions(lines, doc.fileName, header.accountMask);
    inheritPlanForFees(transactions);

    const statement: Statement = {
      id: `sampath:${header.accountMask}:${header.statementDate}`,
      issuer: 'sampath',
      accountMask: header.accountMask,
      statementDate: header.statementDate,
      paymentDueDate: header.paymentDueDate,
      creditLimit: header.creditLimit,
      interestRateAnnual: header.interestRateAnnual,
      openingBalance: header.openingBalance,
      charges: header.debits,
      payments: header.credits,
      // No header finance charge; interest is a transaction line.
      financeCharge: 0,
      closingBalance: header.clearingBalance,
      minimumPayment: header.minimumPayment,
      transactions,
      sourceFileName: doc.fileName,
      source: 'text',
      pageCount: doc.pages.length,
      warnings: warnings.list,
    };

    checkLineItems(statement, warnings);

    return {
      ok: true,
      issuer: 'sampath',
      statement,
      warnings: warnings.list,
      sourceFileName: doc.fileName,
    };
  },
};

// --- header -----------------------------------------------------------------

interface Header {
  accountMask: string;
  statementDate: string;
  paymentDueDate: string;
  minimumPayment: number;
  openingBalance: number;
  debits: number;
  credits: number;
  clearingBalance: number;
  creditLimit: number;
  interestRateAnnual: number;
}

function readHeader(lines: readonly Line[], warnings: Warnings): Header {
  const bandOne = lines.map((l) => HEADER_ROW_RE.exec(l.text)).find((m) => m !== null);
  const bandTwo = lines.map((l) => TOTALS_ROW_RE.exec(l.text)).find((m) => m !== null);

  const accountMask = maskCardNumber(bandOne?.[1]);
  if (!accountMask) {
    warnings.add('error', 'missing-account', 'Account number row not found in the header.');
  }
  const statementDate = parseDate(bandOne?.[2]);
  const paymentDueDate = parseDate(bandOne?.[4]);
  if (!statementDate) warnings.add('error', 'missing-date', 'Statement date not found.', bandOne?.[2]);

  if (!bandTwo) {
    warnings.add('error', 'missing-totals', 'The opening/debits/credits/clearing row was not found.');
  }

  return {
    accountMask: accountMask ?? '????',
    statementDate: statementDate ?? '',
    paymentDueDate: paymentDueDate ?? '',
    minimumPayment: Math.abs(parseAmount(bandOne?.[5])?.value ?? 0),
    // Opening and clearing keep their sign: a credit balance is negative.
    openingBalance: parseAmount(bandTwo?.[1])?.value ?? 0,
    debits: Math.abs(parseAmount(bandTwo?.[2])?.value ?? 0),
    credits: Math.abs(parseAmount(bandTwo?.[3])?.value ?? 0),
    clearingBalance: parseAmount(bandTwo?.[4])?.value ?? 0,
    creditLimit: readCreditLimit(lines),
    interestRateAnnual: readRate(lines),
  };
}

function readCreditLimit(lines: readonly Line[]): number {
  const line = lines.find((l) => /Credit\s*Limit/i.test(l.text));
  const m = line ? /([\d,]+\.\d{2})\s*$/.exec(line.text) : null;
  return m ? (parseAmount(m[1])?.value ?? 0) : 0;
}

function readRate(lines: readonly Line[]): number {
  const line = lines.find((l) => /Annualized\s+Interest\s+Rate/i.test(l.text));
  const m = line ? /(\d+(?:\.\d+)?)\s*%/.exec(line.text) : null;
  return m?.[1] ? Math.round(Number(m[1]) * 1e6) / 1e8 : 0;
}

// --- transactions -----------------------------------------------------------

function readTransactions(lines: readonly Line[], fileName: string, accountMask: string): Txn[] {
  const transactions: Txn[] = [];
  let index = 0;

  for (const line of lines) {
    const text = line.text.trim();
    if (text === '' || NON_TXN_RE.test(text)) continue;

    const lead = TXN_LEAD_RE.exec(text);
    if (!lead?.[1] || !lead[2] || lead[3] === undefined) continue;

    const postDate = parseDate(lead[1]);
    const txnDate = parseDate(lead[2]);
    // The band-1 header value row leads with an account number, not a date,
    // so it never reaches here; a failed date parse means a genuine oddity.
    if (!postDate || !txnDate) continue;

    const amount = readTrailingAmount(line);
    if (!amount) continue;

    let rest = stripSuffix(lead[3], amount.text);

    let currency: Txn['currency'];
    const foreign = FOREIGN_RE.exec(rest);
    if (foreign?.[1] && foreign[2]) {
      const value = Number(foreign[2].replace(/,/g, ''));
      if (Number.isFinite(value) && value !== 0) {
        currency = {
          code: foreign[1],
          amount: value,
          impliedRate: roundMoney(Math.abs(amount.value) / value),
        };
      }
      rest = rest.replace(FOREIGN_RE, '');
    }

    const description = rest.replace(/\s+/g, ' ').trim();
    // `(*)` marks account-level rows with no merchant; drop it for matching
    // but keep the meaningful text.
    const cleanDescription = description.replace(/^\(\*\)\s*/, '').trim();
    const classification = classifyTxn({ description: cleanDescription, amount: amount.value });

    transactions.push({
      id: `${fileName}#${index}`,
      postDate,
      txnDate,
      description: cleanDescription,
      amount: amount.value,
      ...(currency === undefined ? {} : { currency }),
      cardMask: accountMask,
      classification: classification.className,
      ...(classification.installmentSeq === undefined
        ? {}
        : {
            installmentSeq: classification.installmentSeq,
            installmentTerm: classification.installmentTerm,
          }),
      raw: scrubPan(text),
    });
    index += 1;
  }

  return transactions;
}

/** Read the amount at the right of a row, folding a stray `CR`/`DR` token in. */
function readTrailingAmount(line: Line): { value: number; text: string } | undefined {
  const tokens = tokenise(line);
  if (tokens.length === 0) return undefined;

  let text = tokens[tokens.length - 1]!.text.trim();
  if (/^(?:CR|DR)$/i.test(text) && tokens.length >= 2) {
    text = `${tokens[tokens.length - 2]!.text.trim()}${text}`;
  }
  const parsed = parseAmount(text);
  if (parsed === undefined) return undefined;
  return { value: parsed.value, text };
}

function stripSuffix(source: string, suffix: string): string {
  const s = source.trimEnd();
  const suf = suffix.trim();
  if (s.endsWith(suf)) return s.slice(0, s.length - suf.length);
  return s.replace(/[\d,]+\.\d{2}\s*(?:CR|DR)?\s*$/i, '');
}

/**
 * Fold a processing-fee line into the plan of the repayment it follows.
 *
 * Sampath prints `... INSTALLMENT PROCESSING FEES` with no `n/m` marker of its
 * own, on the row after `... INSTALLMENT REPAYMENT n/m`. Without this, the fee
 * carries no plan sequence and the register cannot fold it into the monthly
 * cost, which is the figure the whole instalment view turns on.
 */
function inheritPlanForFees(transactions: Txn[]): void {
  for (let i = 1; i < transactions.length; i += 1) {
    const fee = transactions[i]!;
    if (fee.classification !== 'installment_processing_fee') continue;
    if (fee.installmentSeq !== undefined) continue;

    const prev = transactions[i - 1]!;
    if (prev.classification !== 'installment_repayment' || prev.installmentSeq === undefined) {
      continue;
    }
    fee.installmentSeq = prev.installmentSeq;
    fee.installmentTerm = prev.installmentTerm;
  }
}

/**
 * The transaction lines must reproduce the header's net movement. This is the
 * single cross-check available inside one Sampath statement -- it has no
 * per-card subtotals -- and it catches a missed or misread row before the
 * figure reaches any total.
 */
function checkLineItems(statement: Statement, warnings: Warnings): void {
  const sum = sumMoney(statement.transactions.map((t) => t.amount));
  const movement = roundMoney(statement.charges - statement.payments);
  if (!moneyEquals(sum, movement)) {
    warnings.add(
      'error',
      'line-items-mismatch',
      `The transaction lines sum to ${sum.toFixed(2)}, but the header's debits less credits is ` +
        `${movement.toFixed(2)}. Some rows were missed or misread.`,
    );
  }
}

registerParser(sampathParser);
