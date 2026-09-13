import type { TxnClass } from '@/domain/types';

/**
 * Transaction classification from description text and sign.
 *
 * Ordered rules, first match wins. Kept issuer-agnostic and shared, because
 * the same merchant conventions appear on both issuers' statements; an issuer
 * with genuinely unique wording passes extra rules via `extraRules`.
 *
 * Sign is part of the decision: `FINANCE CHARGE 6,420.30` is interest, while
 * `FINANCE CHARGE 6,420.30CR` is an interest reversal, and no amount of
 * description matching can tell them apart.
 */

export interface ClassifyRule {
  /** Applies only to debits (`debit`), credits (`credit`), or both. */
  side: 'debit' | 'credit' | 'both';
  pattern: RegExp;
  className: TxnClass;
  /** Why this rule exists, surfaced in the transaction drill-down. */
  note?: string;
}

/** Instalment lines: `... 1/24`, `... 12 / 36`, or Seylan's `SP 010 of 036`. */
export const INSTALLMENT_SEQ_RE = /(\d{1,3})\s*\/\s*(\d{1,3})/;
export const SEYLAN_PLAN_RE = /\bSP\s*(\d{1,3})\s*(?:of|OF)\s*(\d{1,3})\b/;

/** A description that names an instalment programme. */
export const INSTALLMENT_CONTEXT_RE =
  /\b(?:EASY\s*PAY|EASYPAY|INSTAL?L?MENT|INSTALMENT|EASY\s*PLAN|FLEXI\s*PLAN)\b/i;

const RULES: ClassifyRule[] = [
  // --- credits -----------------------------------------------------------
  {
    side: 'credit',
    pattern: /\b(?:FUEL\s*(?:SUR)?CHARGE|SURCHARGE)\b/i,
    className: 'fuel_surcharge_reversal',
    note: 'Fuel surcharge refunded',
  },
  {
    side: 'credit',
    pattern: /\b(?:FINANCE\s*CHARGE|INTEREST)\b/i,
    className: 'interest_reversal',
  },
  {
    side: 'credit',
    pattern: /\bCASH\s*BACK\b|\bCASHBACK\b|\bREWARD\s*REDEMPTION\b/i,
    className: 'cashback',
  },
  {
    side: 'credit',
    pattern:
      /\b(?:PAYMENT|THANK\s*YOU|CASH\s*DEPOSIT|FUND\s*TRANSFER|CEFT|SLIPS|STANDING\s*ORDER|DIRECT\s*DEBIT|ONLINE\s*TRANSFER)\b/i,
    className: 'payment',
    note: 'Settles the account',
  },
  // Anything else on the credit side is a reversal candidate. The
  // ReversalMatcher confirms or demotes it once the whole set is loaded --
  // the payments/reversals split is decided there, not here.
  { side: 'credit', pattern: /.*/, className: 'reversal' },

  // --- debits ------------------------------------------------------------
  {
    side: 'debit',
    pattern: /\b(?:PROCESS(?:ING)?\s*FEE|PROC\.?\s*FEE|HANDLING\s*FEE|SERVICE\s*FEE)\b/i,
    className: 'installment_processing_fee',
    note: 'Recurring plan fee; folded into the plan instalment',
  },
  {
    side: 'debit',
    pattern: /\b(?:FINANCE\s*CHARGE|INTEREST\s*CHARGE|INTEREST)\b/i,
    className: 'interest',
  },
  {
    side: 'debit',
    pattern: /\b(?:ANNUAL\s*FEE|CARD\s*FEE|JOINING\s*FEE|RENEWAL\s*FEE|MEMBERSHIP\s*FEE)\b/i,
    className: 'annual_fee',
  },
  { side: 'debit', pattern: /\bSTAMP\s*DUTY\b/i, className: 'stamp_duty' },
  {
    side: 'debit',
    pattern: /\b(?:FUEL\s*(?:SUR)?CHARGE|SURCHARGE)\b/i,
    className: 'fuel_surcharge',
  },
  { side: 'debit', pattern: /.*/, className: 'purchase' },
];

export interface ClassifyInput {
  description: string;
  /** Signed amount; only its sign is consulted. */
  amount: number;
  extraRules?: readonly ClassifyRule[];
}

export interface Classification {
  className: TxnClass;
  note?: string;
  installmentSeq?: number;
  installmentTerm?: number;
}

export function classifyTxn(input: ClassifyInput): Classification {
  const { description, amount } = input;
  const side: 'debit' | 'credit' = amount < 0 ? 'credit' : 'debit';
  const seq = readInstallmentSequence(description);

  // Instalment lines are decided before the generic table: a repayment line
  // is a repayment whatever else its merchant name happens to contain, and a
  // processing fee inside a plan is a plan fee rather than a bank fee.
  if (seq && side === 'debit') {
    const isFee = /\b(?:PROCESS(?:ING)?\s*FEE|PROC\.?\s*FEE|FEES?)\b/i.test(description);
    return {
      className: isFee ? 'installment_processing_fee' : 'installment_repayment',
      installmentSeq: seq.seq,
      installmentTerm: seq.term,
      note: isFee ? 'Recurring plan fee' : 'Scheduled plan instalment',
    };
  }

  for (const rule of [...(input.extraRules ?? []), ...RULES]) {
    if (rule.side !== 'both' && rule.side !== side) continue;
    if (!rule.pattern.test(description)) continue;
    return {
      className: rule.className,
      ...(rule.note === undefined ? {} : { note: rule.note }),
      ...(seq ? { installmentSeq: seq.seq, installmentTerm: seq.term } : {}),
    };
  }

  return { className: side === 'credit' ? 'reversal' : 'purchase' };
}

export interface InstallmentSequence {
  seq: number;
  term: number;
}

/**
 * Read `n of m` from an instalment description.
 *
 * Seylan's `SP 010 of 036` is checked first because `SP 010` also contains a
 * bare number that a loose `n/m` match could misread. A plain `n/m` is only
 * accepted when the line names an instalment programme, so that a merchant
 * name containing a fraction (`24/7 PHARMACY`) is not read as a schedule.
 */
export function readInstallmentSequence(description: string): InstallmentSequence | undefined {
  const seylan = SEYLAN_PLAN_RE.exec(description);
  if (seylan?.[1] && seylan[2]) {
    return { seq: Number(seylan[1]), term: Number(seylan[2]) };
  }

  if (!INSTALLMENT_CONTEXT_RE.test(description)) return undefined;

  const generic = INSTALLMENT_SEQ_RE.exec(description);
  if (generic?.[1] && generic[2]) {
    const seq = Number(generic[1]);
    const term = Number(generic[2]);
    // A schedule position cannot exceed its term, and a one-payment "plan"
    // is not a plan -- both indicate the match caught something else.
    if (term >= 2 && seq >= 1 && seq <= term) return { seq, term };
  }
  return undefined;
}

/** Seylan's `SP nnn` plan identifier, independent of the term count. */
export function readSeylanPlanCode(description: string): string | undefined {
  const m = SEYLAN_PLAN_RE.exec(description);
  return m?.[1] ? `SP${m[1]}` : undefined;
}
