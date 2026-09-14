import {
  POINTS_EPSILON,
  type CardSubtotal,
  type ParseWarning,
  type Statement,
  type Txn,
} from '@/domain/types';
import { parseDate, resolveYearlessDate } from '@/lib/dates';
import { moneyEquals, parseAmount, roundMoney, sumMoney } from '@/lib/money';
import { maskCardNumber, scrubPan } from '@/lib/mask';
import { classifyTxn, readSeylanPlanCode } from '../classify';
import { readGrid, tokenise, type GridField, type GridHit } from '../headerGrid';
import { solveRewards, type RewardsRole } from '../rewards';
import { registerParser, type ParseResult, type StatementParser } from '../parser';
import { allLines, documentText, type Line } from '../textLayer';

/**
 * Seylan Bank credit card e-statement adapter.
 *
 * Layout notes that drive the implementation:
 *  - Header is a label row over a value row, read by column (see headerGrid).
 *  - Amounts carry a trailing `CR` for credits; `parseAmount` signs them.
 *  - Transaction rows lead with two dates: post date then transaction date.
 *  - A foreign transaction adds a second line carrying the original currency.
 *  - Per-card subtotals delimit the rows belonging to each card.
 *  - Instalments print `SEYLAN EASY PAY - SP nnn of mmm`; `SP nnn` is the
 *    plan identifier and `mmm` the term count.
 *  - The statement date drifts around the start of the month, so nothing is
 *    keyed off a particular day number.
 */

const FIELDS: readonly GridField[] = [
  { key: 'cardNumber', label: /\bCard\s*(?:Number|No\.?)\b/i },
  { key: 'interestRate', label: /\bInterest\s*Rate\b/i },
  { key: 'rewardsBalance', label: /\bReward(?:s)?\s*Points?\s*Balance\b/i },
  { key: 'statementDate', label: /\bStatement\s*Date\b/i },
  { key: 'creditLimit', label: /\bCredit\s*Limit\b/i },
  { key: 'minimumPayment', label: /\bMin(?:imum|\.)?\s*Payment\s*Due\b/i },
  { key: 'paymentDueDate', label: /\bPayment\s*Due\s*Date\b/i },
  { key: 'pastDue', label: /\bPast\s*Due\s*Amount\b/i },
  { key: 'openingBalance', label: /\bOpening\s*Balance\b/i },
  { key: 'charges', label: /\bNew\s*Charges?\s*(?:&|and)\s*Debits?\b/i },
  { key: 'financeCharge', label: /\bFinance\s*Charge\b/i },
  { key: 'payments', label: /\bPayments?\s*(?:&|and)\s*Credits?\b/i },
  { key: 'closingBalance', label: /\bClosing\s*Balance\b/i },
];

/** `** CARD - 40463300****2470 SUBTOTAL- LKR 34,513.95CR` */
const SUBTOTAL_RE =
  /\*+\s*CARD\s*[-–—]?\s*([0-9Xx*\s]{6,})\s*SUBTOTAL\s*[-–—]?\s*(?:LKR)?\s*([\d,]+\.\d{2}\s*(?:CR|DR)?)/i;

/**
 * A row leading with post date then transaction date.
 *
 * The year is optional because Seylan prints transaction dates as `DD/MM`
 * and leaves the year to the statement header -- so a row reads `10/08 09/08`,
 * not `10/08/26 09/08/26`. Requiring the year matched nothing at all.
 */
const TXN_LEAD_RE =
  /^(\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?)\s+(\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?)\s+(.*)$/;

/** A continuation line carrying the original currency of a foreign purchase. */
const FOREIGN_RE = /^([A-Z]{3})\s+([\d,]+(?:\.\d{1,2})?)$/;

/**
 * The reference at the head of the description column.
 *
 * Seylan prints it masked -- `****0770` -- which is a per-transaction auth
 * reference, not a card: it differs on every row, while the card is named
 * only in the per-card subtotal lines.
 */
const REFERENCE_RE = /^(\*{2,}\d{3,}|\d{6,}|[A-Z]{1,3}\d{5,}|[A-Z0-9]{8,})$/;

/** `Seylan Rewards Points Details (For The Period)` -- the block's own heading. */
const REWARDS_HEADING_RE = /Reward(?:s)?\s+Points\s+Details/i;

/**
 * The block as actually printed: one label per line with its value beside it.
 *
 *   Opening Balance      202
 *   Points Accumulated 1,388
 *   Points Adjusted        0
 *   Points Redeemed      816
 *   Points Balance       774
 */
const REWARDS_ROWS: { role: RewardsRole; pattern: RegExp }[] = [
  { role: 'opening', pattern: /^Opening\s+(?:Balance|Points)\b/i },
  { role: 'accumulated', pattern: /^Points?\s+Accumulated\b/i },
  { role: 'adjusted', pattern: /^Points?\s+Adjust/i },
  { role: 'redeemed', pattern: /^Points?\s+Redeem/i },
  { role: 'balance', pattern: /^Points?\s+Balance\b/i },
];

const REWARDS_LABELS: { role: RewardsRole; pattern: RegExp }[] = [
  { role: 'opening', pattern: /\bOPENING\b/i },
  { role: 'accumulated', pattern: /\bACCUMULAT|\bEARNED\b/i },
  { role: 'redeemed', pattern: /\bREDEEM/i },
  { role: 'adjusted', pattern: /\bADJUST/i },
  { role: 'balance', pattern: /\bBALANCE\b/i },
];

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

export const seylanParser: StatementParser = {
  issuer: 'seylan',
  label: 'Seylan Bank',

  detect(doc) {
    const text = documentText(doc);
    let score = 0;
    if (/\bSEYLAN\b/i.test(text)) score += 0.6;
    if (/SEYLAN\s+EASY\s*PAY/i.test(text)) score += 0.2;
    if (SUBTOTAL_RE.test(text)) score += 0.15;
    if (/\bNew\s*Charges?\s*(?:&|and)\s*Debits?\b/i.test(text)) score += 0.15;
    // Guard against a Sampath statement that happens to mention Seylan.
    if (/\bSAMPATH\s*BANK\b/i.test(text) && !/\bSEYLAN\s*BANK\b/i.test(text)) score -= 0.5;
    return Math.max(0, Math.min(1, score));
  },

  parse(doc): ParseResult {
    const warnings = new Warnings();
    const lines = allLines(doc);
    // Read the grid from the header region first. Several field labels also
    // occur as transaction descriptions (`FINANCE CHARGE` most obviously), so
    // excluding transaction rows keeps a line item from being read as a
    // header total. Anything still missing is looked for across the whole
    // document, since some layouts repeat totals in a trailing summary.
    const grid = readGrid(headerRegion(lines), FIELDS);
    for (const [key, hit] of readGrid(lines, FIELDS)) {
      if (!grid.has(key)) grid.set(key, hit);
    }

    const accountMask = readMask(grid, warnings);
    const statementDate = readDate(grid, 'statementDate', 'Statement Date', warnings);
    const paymentDueDate =
      readOptionalDate(grid, 'paymentDueDate') ??
      (warnings.add('warning', 'missing-due-date', 'Payment due date not found; it is left blank.'),
      '');

    const openingBalance = readMoney(grid, 'openingBalance', 'Opening Balance', warnings);
    const charges = readMoney(grid, 'charges', 'New Charges & Debits', warnings);
    const payments = Math.abs(readMoney(grid, 'payments', 'Payment & Credits', warnings));
    const financeCharge = readMoney(grid, 'financeCharge', 'Finance Charge', warnings);
    const closingBalance = readMoney(grid, 'closingBalance', 'Closing Balance', warnings);
    const creditLimit = readMoney(grid, 'creditLimit', 'Credit Limit', warnings);
    const minimumPayment = readMoney(grid, 'minimumPayment', 'Min. Payment Due', warnings);
    const pastDueAmount = grid.has('pastDue')
      ? (parseAmount(grid.get('pastDue')!.value)?.value ?? 0)
      : undefined;

    const interestRateAnnual = readRate(grid, warnings);

    const { transactions, cardSubtotals } = readTransactions(
      lines,
      doc.fileName,
      accountMask,
      statementDate,
      warnings,
    );

    const rewards = readRewards(lines, grid, warnings);

    const statement: Statement = {
      id: `seylan:${accountMask}:${statementDate}`,
      issuer: 'seylan',
      accountMask,
      statementDate,
      paymentDueDate,
      creditLimit,
      interestRateAnnual,
      openingBalance,
      charges,
      payments,
      financeCharge,
      closingBalance,
      minimumPayment,
      ...(pastDueAmount === undefined ? {} : { pastDueAmount }),
      transactions,
      ...(rewards === undefined ? {} : { rewards }),
      ...(cardSubtotals.length === 0 ? {} : { cardSubtotals }),
      sourceFileName: doc.fileName,
      // Overwritten by the loader when the layer came from OCR; a parser
      // cannot tell, and should not guess.
      source: 'text',
      pageCount: doc.pages.length,
      warnings: warnings.list,
    };

    checkSubtotals(statement, warnings);

    return {
      ok: true,
      issuer: 'seylan',
      statement,
      warnings: warnings.list,
      sourceFileName: doc.fileName,
    };
  },
};

/** Lines that are not transaction rows, per-card subtotals or currency legs. */
function headerRegion(lines: readonly Line[]): Line[] {
  return lines.filter((line) => {
    const text = line.text.trim();
    return !TXN_LEAD_RE.test(text) && !SUBTOTAL_RE.test(text) && !FOREIGN_RE.test(text);
  });
}

// --- header fields ---------------------------------------------------------

function readMask(grid: Map<string, GridHit>, warnings: Warnings): string {
  const raw = grid.get('cardNumber')?.value;
  // Masked here, at the point of extraction. The full value is never returned,
  // assigned to a variable that outlives this call, or logged.
  const mask = maskCardNumber(raw);
  if (!mask) {
    warnings.add(
      'error',
      'missing-card-number',
      'The card number could not be read from the header. On a scanned statement this is the ' +
        'usual casualty: the number is printed mostly as asterisks (****2470), and character ' +
        'recognition reads runs of asterisks poorly. The cycle can still be reconciled, but this ' +
        'statement cannot be matched to others from the same card, so the balance chain and the ' +
        'per-card position will be unreliable until a text-layer copy is loaded.',
    );
    return '????';
  }
  return mask;
}

function readDate(
  grid: Map<string, GridHit>,
  key: string,
  label: string,
  warnings: Warnings,
): string {
  const parsed = readOptionalDate(grid, key);
  if (!parsed) {
    warnings.add('error', 'missing-date', `${label} not found or unparseable.`, grid.get(key)?.value);
    return '';
  }
  return parsed;
}

function readOptionalDate(grid: Map<string, GridHit>, key: string): string | undefined {
  return parseDate(grid.get(key)?.value);
}

function readMoney(
  grid: Map<string, GridHit>,
  key: string,
  label: string,
  warnings: Warnings,
): number {
  const hit = grid.get(key);
  const parsed = parseAmount(hit?.value);
  if (parsed === undefined) {
    warnings.add('error', 'missing-amount', `${label} not found or unparseable.`, hit?.value);
    return 0;
  }
  return parsed.value;
}

/** `28.00%` / `28.00% p.a.` / `2.33% per month` -> annual fraction. */
function readRate(grid: Map<string, GridHit>, warnings: Warnings): number {
  const raw = grid.get('interestRate')?.value;
  if (!raw) {
    warnings.add('warning', 'missing-rate', 'Interest rate not found; recorded as 0.');
    return 0;
  }
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(raw);
  if (!m?.[1]) {
    warnings.add('warning', 'unparseable-rate', 'Interest rate could not be parsed.', raw);
    return 0;
  }
  const percent = Number(m[1]);
  const monthly = /\b(?:p\.?m\.?|per\s*month|monthly)\b/i.test(raw);
  return roundRate(monthly ? percent * 12 : percent);
}

function roundRate(percent: number): number {
  return Math.round(percent * 1e6) / 1e8; // percent -> fraction, 6dp
}

// --- transactions ----------------------------------------------------------

interface TransactionReadResult {
  transactions: Txn[];
  cardSubtotals: CardSubtotal[];
}

function readTransactions(
  lines: readonly Line[],
  fileName: string,
  accountMask: string,
  statementDate: string,
  warnings: Warnings,
): TransactionReadResult {
  const transactions: Txn[] = [];
  const cardSubtotals: CardSubtotal[] = [];
  /** Rows seen since the last subtotal, awaiting a card assignment. */
  let pending: Txn[] = [];
  let index = 0;

  for (const line of lines) {
    const text = line.text.trim();
    if (text === '') continue;

    const subtotal = SUBTOTAL_RE.exec(text);
    if (subtotal?.[1] && subtotal[2]) {
      const mask = maskCardNumber(subtotal[1]) ?? accountMask;
      const amount = parseAmount(subtotal[2])?.value ?? 0;
      for (const txn of pending) txn.cardMask = mask;
      const assignedSum = sumMoney(pending.map((t) => t.amount));
      cardSubtotals.push({
        cardMask: mask,
        amount,
        assignedSum,
        matches: moneyEquals(amount, assignedSum),
      });
      pending = [];
      continue;
    }

    const foreign = FOREIGN_RE.exec(text);
    if (foreign?.[1] && foreign[2] && foreign[1].toUpperCase() !== 'LKR') {
      attachForeign(transactions, foreign[1].toUpperCase(), foreign[2], warnings);
      continue;
    }

    const txn = readTransactionRow(line, fileName, statementDate, index);
    if (txn) {
      transactions.push(txn);
      pending.push(txn);
      index += 1;
    }
  }

  if (pending.length > 0 && cardSubtotals.length > 0) {
    warnings.add(
      'warning',
      'unassigned-transactions',
      `${pending.length} transaction(s) appear after the last per-card subtotal and could not be assigned to a card.`,
    );
  }

  return { transactions, cardSubtotals };
}

function readTransactionRow(
  line: Line,
  fileName: string,
  statementDate: string,
  index: number,
): Txn | undefined {
  const lead = TXN_LEAD_RE.exec(line.text.trim());
  if (!lead?.[1] || !lead[2] || lead[3] === undefined) return undefined;

  const postDate = readRowDate(lead[1], statementDate);
  const txnDate = readRowDate(lead[2], statementDate);
  if (!postDate || !txnDate) return undefined;

  const amountRead = readTrailingAmount(line);
  if (!amountRead) return undefined;

  let rest = lead[3];
  // Strip the amount, then the currency code that sits just left of it.
  rest = stripSuffix(rest, amountRead.text);
  rest = rest.replace(/\s*\b[A-Z]{3}\b\s*$/, '');
  let description = rest.replace(/\s+/g, ' ').trim();

  let reference: string | undefined;
  const firstSpace = description.indexOf(' ');
  const head = firstSpace === -1 ? description : description.slice(0, firstSpace);
  if (REFERENCE_RE.test(head) && /\d/.test(head)) {
    reference = head;
    description = description.slice(head.length).trim();
  }

  const classification = classifyTxn({ description, amount: amountRead.value });
  const planCode = readSeylanPlanCode(description);

  return {
    id: `${fileName}#${index}`,
    postDate,
    txnDate,
    ...(reference === undefined ? {} : { reference }),
    description,
    amount: amountRead.value,
    classification: classification.className,
    ...(classification.installmentSeq === undefined
      ? {}
      : {
          installmentSeq: classification.installmentSeq,
          installmentTerm: classification.installmentTerm,
        }),
    ...(planCode === undefined ? {} : { installmentPlanId: `seylan:${planCode}` }),
    // Defence in depth: the row is kept verbatim for the drill-down, so it is
    // scrubbed of anything card-shaped on the way in rather than on the way out.
    raw: scrubPan(line.text.trim()),
  };
}

/**
 * Resolve a transaction date that may carry no year.
 *
 * `10/08` on a statement dated 07/09/26 is August 2026, and `02/09` is
 * September 2026 -- the cycle straddles a month boundary, and at a year
 * boundary it straddles that too. The year is chosen as the one that puts
 * the date nearest the statement date, rather than assumed to be the
 * statement's own year.
 */
function readRowDate(raw: string, statementDate: string): string | undefined {
  const withYear = parseDate(raw);
  if (withYear) return withYear;

  const parts = /^(\d{1,2})[/\-.](\d{1,2})$/.exec(raw);
  if (!parts?.[1] || !parts[2] || statementDate === '') return undefined;
  return resolveYearlessDate(Number(parts[1]), Number(parts[2]), statementDate);
}

/**
 * Read the amount at the right of a row.
 *
 * Taken from the rightmost token rather than from a regex over the whole line,
 * because a description can itself end in something amount-shaped. A bare
 * `CR`/`DR` extracted as its own token is folded back onto the number.
 */
function readTrailingAmount(line: Line): { value: number; text: string } | undefined {
  const tokens = tokenise(line);
  if (tokens.length === 0) return undefined;

  let text = tokens[tokens.length - 1]!.text.trim();
  if (/^(?:CR|DR)$/i.test(text) && tokens.length >= 2) {
    text = `${tokens[tokens.length - 2]!.text.trim()}${text}`;
  }
  // A token may arrive as `LKR 12,450.00` when the gap is narrow.
  const stripped = text.replace(/^[A-Z]{3}\s+/i, '');
  const parsed = parseAmount(stripped);
  if (parsed === undefined) return undefined;
  return { value: parsed.value, text };
}

function stripSuffix(source: string, suffix: string): string {
  const normalisedSource = source.trimEnd();
  const normalisedSuffix = suffix.trim();
  if (normalisedSource.endsWith(normalisedSuffix)) {
    return normalisedSource.slice(0, normalisedSource.length - normalisedSuffix.length);
  }
  // The token may have been joined differently than the line text; fall back
  // to removing the last amount-shaped run.
  return normalisedSource.replace(/[\d,]+\.\d{2}\s*(?:CR|DR)?\s*$/i, '');
}

/**
 * Attach a foreign-currency continuation line to the transaction above it and
 * derive the implied rate. The rate is derived, never assumed -- if the bank
 * prints its own rate elsewhere it would disagree slightly, since the LKR
 * figure already includes the issuer's markup.
 */
function attachForeign(
  transactions: readonly Txn[],
  code: string,
  amountText: string,
  warnings: Warnings,
): void {
  const target = transactions[transactions.length - 1];
  if (!target) {
    warnings.add(
      'warning',
      'orphan-foreign-line',
      `A ${code} currency line appeared before any transaction and was ignored.`,
      amountText,
    );
    return;
  }
  const amount = Number(amountText.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount === 0) {
    warnings.add('warning', 'bad-foreign-amount', `Could not read the ${code} amount.`, amountText);
    return;
  }
  target.currency = {
    code,
    amount,
    impliedRate: roundMoney(Math.abs(target.amount) / amount),
  };
}

// --- per-card subtotals ----------------------------------------------------

/**
 * The per-card subtotals must add up to the cycle's net movement. This is the
 * one cross-check available inside a single statement that tests whether the
 * transaction list was read completely.
 */
function checkSubtotals(statement: Statement, warnings: Warnings): void {
  const subtotals = statement.cardSubtotals;
  if (!subtotals || subtotals.length === 0) return;

  for (const subtotal of subtotals) {
    if (!subtotal.matches) {
      warnings.add(
        'error',
        'subtotal-mismatch',
        `Card ****${subtotal.cardMask} prints a subtotal of ${subtotal.amount.toFixed(2)} ` +
          `but its transactions sum to ${subtotal.assignedSum.toFixed(2)}.`,
      );
    }
  }

  const printedSum = sumMoney(subtotals.map((s) => s.amount));
  const movement = roundMoney(statement.charges - statement.payments);
  if (!moneyEquals(printedSum, movement)) {
    warnings.add(
      'error',
      'subtotal-sum-mismatch',
      `Per-card subtotals sum to ${printedSum.toFixed(2)}, but the header's charges less ` +
        `payments is ${movement.toFixed(2)}.`,
    );
  }
}

// --- rewards ---------------------------------------------------------------

function readRewards(
  lines: readonly Line[],
  grid: Map<string, GridHit>,
  warnings: Warnings,
): Statement['rewards'] {
  // The printed layout pairs each label with its value on one line, which is
  // unambiguous -- so read it directly and use the identity to check the
  // reading rather than to discover it. The column form below remains as a
  // fallback for a layout that puts the values in a separate row.
  const vertical = readVerticalRewards(lines, warnings);
  if (vertical) return vertical;

  return readColumnRewards(lines, grid, warnings);
}

/** Read the one-label-per-line form, and verify the identity holds. */
function readVerticalRewards(
  lines: readonly Line[],
  warnings: Warnings,
): Statement['rewards'] {
  const start = lines.findIndex((line) => REWARDS_HEADING_RE.test(line.text));
  if (start === -1) return undefined;

  const found = new Map<RewardsRole, number>();
  for (const line of lines.slice(start + 1, start + 14)) {
    const text = line.text.trim();
    const row = REWARDS_ROWS.find((r) => r.pattern.test(text));
    if (!row || found.has(row.role)) continue;
    const value = trailingNumber(line);
    if (value !== undefined) found.set(row.role, value);
  }

  const opening = found.get('opening');
  const accumulated = found.get('accumulated');
  const redeemed = found.get('redeemed');
  const balance = found.get('balance');
  // A block that prints no adjustment line is stating zero, not withholding it.
  const adjusted = found.get('adjusted') ?? 0;

  if (
    opening === undefined ||
    accumulated === undefined ||
    redeemed === undefined ||
    balance === undefined
  ) {
    return undefined; // fall through to the column reader
  }

  const observed = [opening, accumulated, redeemed, adjusted, balance];
  const reconciled =
    Math.abs(opening + accumulated - redeemed - adjusted - balance) < POINTS_EPSILON;

  if (!reconciled) {
    warnings.add(
      'error',
      'rewards-unreconciled',
      `The rewards block reads opening ${opening} + accumulated ${accumulated} - redeemed ` +
        `${redeemed} - adjusted ${adjusted}, which comes to ` +
        `${opening + accumulated - redeemed - adjusted}, but it prints a balance of ${balance}.`,
    );
    return { reconciled: false, observed };
  }

  return {
    opening,
    accumulated,
    redeemed,
    adjusted,
    balance,
    reconciled: true,
    observed,
    method: 'labels',
  };
}

/** The last amount-shaped token on a line. */
function trailingNumber(line: Line): number | undefined {
  const amounts = tokenise(line)
    .map((t) => parseAmount(t.text))
    .filter((a): a is NonNullable<typeof a> => a !== undefined);
  return amounts[amounts.length - 1]?.value;
}

function readColumnRewards(
  lines: readonly Line[],
  grid: Map<string, GridHit>,
  warnings: Warnings,
): Statement['rewards'] {
  const labelIndex = lines.findIndex((line) => countRewardsLabels(line) >= 3);
  if (labelIndex === -1) return undefined;

  const labelLine = lines[labelIndex]!;
  const valueLine = lines
    .slice(labelIndex + 1, labelIndex + 4)
    .find((line) => tokenise(line).filter((t) => parseAmount(t.text) !== undefined).length >= 3);
  if (!valueLine) {
    warnings.add('warning', 'rewards-values-missing', 'Found a rewards heading but no value row.');
    return undefined;
  }

  const valueTokens = tokenise(valueLine).filter((t) => parseAmount(t.text) !== undefined);
  const labelTokens = tokenise(labelLine);

  const values = valueTokens.map((t) => parseAmount(t.text)!.value);
  const positionalRoles = valueTokens.map((token) => {
    const centre = (token.x + token.right) / 2;
    const nearest = labelTokens.reduce<{ label: string; distance: number } | undefined>(
      (best, label) => {
        const distance = Math.abs((label.x + label.right) / 2 - centre);
        return best === undefined || distance < best.distance
          ? { label: label.text, distance }
          : best;
      },
      undefined,
    );
    return nearest ? roleOf(nearest.label) : undefined;
  });

  const anchor = parseAmount(grid.get('rewardsBalance')?.value)?.value;
  const block = solveRewards({
    values,
    positionalRoles,
    ...(anchor === undefined ? {} : { anchorBalance: anchor }),
  });

  if (!block.reconciled) {
    warnings.add(
      'error',
      'rewards-unreconciled',
      `The rewards block does not satisfy opening + accumulated - redeemed - adjusted = balance ` +
        `for any assignment of the values it prints (${values.join(', ')}). It is marked unreconciled ` +
        `rather than assigned a plausible-looking reading.`,
    );
  } else if (block.additivePair) {
    warnings.add(
      'info',
      'rewards-pair-open',
      `The rewards identity holds, but the labels are mis-aligned so it is not yet determined ` +
        `which of ${block.additivePair.join(' / ')} is the opening balance. Loading the previous ` +
        `cycle resolves it.`,
    );
  }

  return block;
}

function countRewardsLabels(line: Line): number {
  return REWARDS_LABELS.filter((l) => l.pattern.test(line.text)).length;
}

function roleOf(label: string): RewardsRole | undefined {
  return REWARDS_LABELS.find((l) => l.pattern.test(label))?.role;
}

registerParser(seylanParser);
