import { PageBuilder, type PageSpec } from '../helpers/makePdf';

/**
 * Sampath statement in the layout the bank actually prints.
 *
 * Modelled on a real e-statement, with every merchant, figure and account
 * digit replaced. No real statement data appears here or anywhere in the
 * repository. What is reproduced is the structure the parser depends on:
 *
 *  - a trilingual header -- English labels, a row of mojibake where the
 *    Sinhala/Tamil glyphs did not map to Unicode, a Tamil row, then the value
 *    row -- so the value rows must be found by shape, not by pairing labels;
 *  - the header repeating on every page, to be de-duplicated;
 *  - a credit (overpaid) opening balance printed `10,000.00CR`;
 *  - `PostDate TranDate Description [ (CUR - n.nn) ] Amount`, CR for credits;
 *  - the reversal-and-plan mechanic: an origination, a same-amount CR the next
 *    day, then INSTALLMENT REPAYMENT and a recurring PROCESSING FEES line that
 *    carries no n/m of its own;
 *  - `(*)` account-level rows, and a fuel-surcharge reversal.
 *
 * Figures close exactly:
 *   opening (10,000.00CR) + debits 60,000.00 - credits 40,000.00 = 10,000.00
 */

export const SAMPATH_REAL_EXPECTED = {
  accountMask: '1811',
  statementDate: '2026-03-30',
  paymentDueDate: '2026-04-20',
  creditLimit: 1_300_000,
  interestRateAnnual: 0.26,
  openingBalance: -10_000, // 10,000.00CR -- an overpaid account
  charges: 60_000,
  payments: 40_000,
  closingBalance: 10_000,
  minimumPayment: 500,
  transactionCount: 11,
  damroPrincipal: 30_000,
  damroMonthly: 1_900, // 1,500 repayment + 400 recurring fee
} as const;

interface Row {
  post: string;
  tran: string;
  description: string;
  amount: string;
  credit?: boolean;
  foreign?: string;
}

/** Page 1 transactions. */
const ROWS_PAGE_ONE: Row[] = [
  { post: '01/03/26', tran: '28/02/26', description: 'GLOBEX*ONLINE, LONDON', amount: '1,600.00', foreign: '(USD - 5.00)' },
  { post: '01/03/26', tran: '28/02/26', description: '(*)INTEREST CHARGED', amount: '200.00' },
  { post: '02/03/26', tran: '01/03/26', description: 'FAST PHONE SHOP INSTALLMENT REPAYMENT 6/30', amount: '5,000.00' },
  { post: '05/03/26', tran: '05/03/26', description: 'KEELLS SUPER - KOTTAWA, KOTTAWA', amount: '21,000.00' },
  { post: '06/03/26', tran: '06/03/26', description: 'FUEL CHARGE RVSD FOR 21,000.00', amount: '50.00', credit: true },
];

/** Page 2 transactions, including the reversal-and-plan sequence. */
const ROWS_PAGE_TWO: Row[] = [
  { post: '15/03/26', tran: '15/03/26', description: 'PAYMENT RECEIVED - ABC', amount: '9,950.00', credit: true },
  { post: '15/03/26', tran: '15/03/26', description: 'DAMRO - KOTTAWA, KOTTAWA', amount: '30,000.00' },
  { post: '16/03/26', tran: '16/03/26', description: 'DAMRO - KOTTAWA, KOTTAWA', amount: '30,000.00', credit: true },
  { post: '16/03/26', tran: '16/03/26', description: 'DAMRO - KOTTAWA INSTALLMENT REPAYMENT 1/36', amount: '1,500.00' },
  { post: '16/03/26', tran: '16/03/26', description: 'DAMRO - KOTTAWA INSTALLMENT PROCESSING FEES', amount: '400.00' },
  { post: '30/03/26', tran: '30/03/26', description: 'GOVERNMENT STAMP DUTY', amount: '300.00' },
];

const COL = { post: 47, tran: 122, desc: 173, foreign: 439, amountRight: 545 } as const;

export interface SampathFixtureOptions {
  /** Override the printed clearing balance, to exercise a failing cycle. */
  clearingOverride?: string;
}

export function sampathRealLayoutPages(options: SampathFixtureOptions = {}): PageSpec[] {
  return [buildPage(1, ROWS_PAGE_ONE, options), buildPage(2, ROWS_PAGE_TWO, options, true)];
}

function buildPage(
  pageNo: number,
  rows: Row[],
  options: SampathFixtureOptions,
  last = false,
): PageSpec {
  const p = new PageBuilder();
  const clearing = options.clearingOverride ?? '10,000.00';

  p.at(40, 'SAMPATH CREDIT CARD ACCOUNT eSTATEMENT', { size: 9, bold: true }).down(16);
  p.at(40, 'Name/  / ngau;  : A SAMPLE CARDHOLDER', { size: 7 }).down(12);
  p.at(40, 'Credit Limit/   / fld; vy;iy : 1,300,000.00', { size: 7 }).down(12);
  p.at(40, 'Annualized Interest Rate : 26%', { size: 7 }).down(20);

  // Band 1: English labels, mojibake, Tamil, then the value row.
  p.at(40, 'Account Number', { size: 7, bold: true })
    .at(150, 'Statement Date', { size: 7, bold: true })
    .at(250, 'Total Outstanding', { size: 7, bold: true })
    .at(360, 'Payment Due Date', { size: 7, bold: true })
    .at(470, 'Minimum Payment', { size: 7, bold: true })
    .down(12);
  p.at(40, '!     !', { size: 7 }).down(12); // mojibake symbol row
  p.at(40, 'fzf;F ,yf;fk;  mwpf;if jpfjp  nrYj;j', { size: 7 }).down(14); // Tamil row
  p.at(40, '4375 09XX XXXX 1811', { size: 7 })
    .at(150, '30/03/2026', { size: 7 })
    .at(255, '10,000.00', { size: 7 })
    .at(365, '20/04/2026', { size: 7 })
    .at(485, '500.00', { size: 7 })
    .down(20);

  // Band 2: page marker + the four statement totals; opening is a CR balance.
  p.at(40, 'Page', { size: 7, bold: true })
    .at(120, 'Opening Balance', { size: 7, bold: true })
    .at(250, 'Debits', { size: 7, bold: true })
    .at(340, 'Credits', { size: 7, bold: true })
    .at(450, 'Clearing Balance', { size: 7, bold: true })
    .down(12);
  p.at(40, '"#  $ !  %$', { size: 7 }).down(14); // mojibake symbol row
  p.at(40, `Page ${pageNo} of 2`, { size: 7 })
    .at(120, '10,000.00CR', { size: 7 })
    .at(250, '60,000.00', { size: 7 })
    .at(350, '40,000.00', { size: 7 })
    .rightAt(COL.amountRight, clearing, { size: 7 })
    .down(20);

  p.at(COL.post, 'Post Date', { size: 7, bold: true })
    .at(COL.tran, 'Transaction Date', { size: 7, bold: true })
    .at(COL.desc, 'Description', { size: 7, bold: true })
    .rightAt(COL.amountRight, 'Amount', { size: 7, bold: true })
    .down(16);

  for (const row of rows) writeRow(p, row);

  if (last) {
    p.down(6);
    p.at(COL.desc, 'SUB TOTAL - DEBITS', { size: 7, bold: true })
      .rightAt(COL.amountRight, '60,000.00', { size: 7 })
      .down(12);
    p.at(COL.desc, 'TOTAL DEBITS', { size: 7, bold: true })
      .rightAt(COL.amountRight, '60,000.00', { size: 7 })
      .down(20);
    // Loyalty block -- a different shape from Seylan's rewards identity.
    p.at(40, 'YOUR LOYALTY POINTS BALANCE', { size: 7, bold: true }).down(14);
    p.at(40, 'TYPE  TOTAL AVAILABLE  POINTS TO BE EXPIRED BY', { size: 7 }).down(12);
    p.at(40, 'ULTRA REWARDS  737.00  0.00  0.00', { size: 7 }).down(16);
  }

  p.at(40, 'Please check this statement against sales slip copies.', { size: 6 });
  return p.build();
}

function writeRow(p: PageBuilder, row: Row): void {
  p.at(COL.post, row.post, { size: 7 }).at(COL.tran, row.tran, { size: 7 });
  p.at(COL.desc, row.description, { size: 7 });
  if (row.foreign) p.at(COL.foreign, row.foreign, { size: 7 });
  p.rightAt(COL.amountRight, row.amount, { size: 7 });
  if (row.credit) p.at(COL.amountRight + 3, 'CR', { size: 7 });
  p.down(13);
}
