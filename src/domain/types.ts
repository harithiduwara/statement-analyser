/**
 * Domain model for credit-card statement analysis.
 *
 * Sign convention, applied everywhere without exception:
 *   positive = debit  (money owed by the cardholder: purchases, fees, interest)
 *   negative = credit (money owed to the cardholder: payments, reversals, cashback)
 *
 * A `CR` suffix on a printed amount therefore parses to a NEGATIVE number.
 * Aggregate fields on `Statement` (`charges`, `payments`) are the exception:
 * they are stored as printed magnitudes (both positive) because that is how
 * the reconciliation identity is stated on the statement itself.
 */

/** Amount in LKR. Positive = debit, negative = credit. */
export type Money = number;

/** ISO-8601 calendar date, `YYYY-MM-DD`. No time component, no timezone. */
export type IsoDate = string;

export type Issuer = 'seylan' | 'sampath';

export const ISSUERS: readonly Issuer[] = ['seylan', 'sampath'] as const;

export const ISSUER_LABEL: Record<Issuer, string> = {
  seylan: 'Seylan Bank',
  sampath: 'Sampath Bank',
};

/**
 * Transaction classification. Drives the charge decomposition, the
 * payments-vs-reversals split, and the instalment registry.
 */
export type TxnClass =
  | 'purchase'
  | 'payment'
  | 'reversal'
  | 'installment_repayment'
  | 'installment_processing_fee'
  | 'interest'
  | 'interest_reversal'
  | 'annual_fee'
  | 'stamp_duty'
  | 'cashback'
  /**
   * Extension to the specified set: the levy itself, as distinct from its
   * reversal. Without it a levy would have to be booked as a `purchase`,
   * which would both overstate spending and make the "surcharge levied
   * without a matching reversal" anomaly undetectable.
   */
  | 'fuel_surcharge'
  | 'fuel_surcharge_reversal'
  /** The purchase that is subsequently reversed and re-booked as a plan. */
  | 'installment_origination';

export const TXN_CLASSES: readonly TxnClass[] = [
  'purchase',
  'payment',
  'reversal',
  'installment_repayment',
  'installment_processing_fee',
  'interest',
  'interest_reversal',
  'annual_fee',
  'stamp_duty',
  'cashback',
  'fuel_surcharge',
  'fuel_surcharge_reversal',
  'installment_origination',
] as const;

/** Classes that represent fees or the cost of credit rather than spending. */
export const FEE_CLASSES: readonly TxnClass[] = [
  'installment_processing_fee',
  'interest',
  'interest_reversal',
  'annual_fee',
  'stamp_duty',
  'fuel_surcharge',
  'fuel_surcharge_reversal',
] as const;

/** Classes that settle the account rather than add to it. */
export const CREDIT_CLASSES: readonly TxnClass[] = [
  'payment',
  'reversal',
  'cashback',
  'interest_reversal',
  'fuel_surcharge_reversal',
] as const;

/** A foreign-currency leg printed beneath an LKR transaction line. */
export interface ForeignAmount {
  /** ISO-4217-ish code as printed, e.g. `USD`. */
  code: string;
  /** Magnitude in the foreign currency, always positive. */
  amount: number;
  /**
   * LKR per unit of foreign currency, derived as |lkr| / amount.
   * Undefined when the foreign amount is zero.
   */
  impliedRate?: number;
}

export interface Txn {
  /** Stable within a parse; `${sourceFileName}#${index}`. */
  id: string;
  postDate: IsoDate;
  txnDate: IsoDate;
  reference?: string;
  description: string;
  /** Signed. Positive = debit, negative = credit. */
  amount: Money;
  currency?: ForeignAmount;
  /** Last-4 mask of the card this row was billed to, when the statement says. */
  cardMask?: string;
  classification: TxnClass;
  category?: string;
  /** Set by the instalment registry once plans are resolved. */
  installmentPlanId?: string;
  /** `n` of `n/m` on an instalment line. */
  installmentSeq?: number;
  /** `m` of `n/m` on an instalment line. */
  installmentTerm?: number;
  /** Raw source line(s), kept for the transaction drill-down and debugging. */
  raw?: string;
}

/**
 * Seylan prints a rewards table whose columns extract out of positional order.
 * The identity `opening + accumulated - redeemed - adjusted = balance` is the
 * only reliable way to assign them; when no assignment satisfies it the block
 * is marked `unreconciled` rather than guessed at.
 */
export interface RewardsBlock {
  opening?: number;
  accumulated?: number;
  redeemed?: number;
  adjusted?: number;
  balance?: number;
  /**
   * The two values the identity proved are added, when it could not be
   * determined which is the opening balance and which the points earned.
   * Populated instead of `opening`/`accumulated`, never alongside them.
   */
  additivePair?: [number, number];
  /** As `additivePair`, for the redeemed/adjusted pair. */
  subtractivePair?: [number, number];
  /** True only when the identity holds within tolerance. */
  reconciled: boolean;
  /** The numbers as extracted, before assignment, for display on failure. */
  observed: number[];
  /** How the roles were established, shown in the parse report. */
  method?: 'labels' | 'identity' | 'identity+prior';
}

/** Per-card subtotal line, e.g. `** CARD - 4046 33XX XXXX 2470 SUBTOTAL- LKR n`. */
export interface CardSubtotal {
  cardMask: string;
  /** As printed, signed. */
  amount: Money;
  /** Sum of the transactions this parser assigned to the mask. */
  assignedSum: Money;
  /** |amount - assignedSum| within tolerance. */
  matches: boolean;
}

export interface Statement {
  /** `${issuer}:${accountMask}:${statementDate}` -- the duplicate-upload key. */
  id: string;
  issuer: Issuer;
  /** Last four digits only. Never the full PAN. */
  accountMask: string;
  statementDate: IsoDate;
  paymentDueDate: IsoDate;
  creditLimit: Money;
  /** Annual rate as a fraction, e.g. 0.28 for 28% p.a. */
  interestRateAnnual: number;
  openingBalance: Money;
  /** Total debits for the cycle, as printed (positive). */
  charges: Money;
  /** Total credits for the cycle, as printed (positive magnitude). */
  payments: Money;
  financeCharge: Money;
  /** Closing balance as printed -- never recomputed. */
  closingBalance: Money;
  minimumPayment: Money;
  pastDueAmount?: Money;
  transactions: Txn[];
  rewards?: RewardsBlock;
  cardSubtotals?: CardSubtotal[];
  sourceFileName: string;
  /**
   * How the text was obtained. `ocr` means the figures were read off an image
   * and could be wrong in ways that still look like money -- so an `ocr`
   * statement is only believed once the reconciliation invariant confirms it.
   */
  source: 'text' | 'ocr';
  /** Mean OCR word confidence, 0-100. Only present when `source` is `ocr`. */
  ocrConfidence?: number;
  /** Page count of the source PDF, for the parse report. */
  pageCount?: number;
  /** Non-fatal observations raised while parsing this statement. */
  warnings: ParseWarning[];
}

export type ParseWarningLevel = 'info' | 'warning' | 'error';

export interface ParseWarning {
  level: ParseWarningLevel;
  code: string;
  message: string;
  /** Source line or fragment the warning refers to. */
  context?: string;
}

/**
 * The reconciliation invariant: opening + charges - payments = closing.
 *
 * Non-negotiable. A statement that fails this is surfaced loudly and its
 * numbers are not folded into any aggregate silently.
 */
export interface Reconciliation {
  statementId: string;
  opening: Money;
  charges: Money;
  payments: Money;
  /** opening + charges - payments */
  computedClosing: Money;
  /** As printed on the statement. */
  printedClosing: Money;
  /** computedClosing - printedClosing */
  delta: Money;
  passes: boolean;
  /** Sum of signed transaction amounts, for the second-opinion check. */
  transactionSum: Money;
  /**
   * Whether the transaction list itself reproduces the printed movement.
   * A statement can reconcile on its header totals while the line items
   * disagree -- that is a different, quieter failure worth reporting.
   */
  transactionsMatchHeader: boolean;
  /**
   * Plain-language reading of a failure, when the shape of the delta points
   * at a specific cause (e.g. a delta exactly equal to the finance charge).
   */
  hint?: string;
}

/** Tolerance for money comparisons, in LKR. Statements print 2dp. */
export const MONEY_EPSILON = 0.005;

/** Tolerance for rewards-point identities. Points are integers. */
export const POINTS_EPSILON = 0.5;
