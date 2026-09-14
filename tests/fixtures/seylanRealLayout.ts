import { PageBuilder, type PageSpec } from '../helpers/makePdf';

/**
 * Seylan statement in the layout the bank actually prints.
 *
 * Modelled on a real e-statement, with every merchant name, reference and
 * figure replaced. No real statement data appears here or anywhere in the
 * repository. What is reproduced is the *structure*, which is what the parser
 * reads and what earlier fixtures got wrong:
 *
 *  - transaction dates are `DD/MM` with no year, and the cycle crosses a
 *    month boundary (August rows on a statement dated 07/09)
 *  - the reference column is a masked auth code, `****nnnn`, different on
 *    every row -- it is not a card number
 *  - the header grid comes in three bands of 3, 5 and 5 fields
 *  - per-card subtotals separate the cards, and the second card's rows follow
 *    the first card's subtotal
 *  - the rewards block is one label per line with its value beside it, not a
 *    column grid
 *
 * The figures close exactly:
 *   146,696.28 + 61,841.12 - 66,400.88 = 142,136.52
 *   subtotals (11,710.60)CR + 7,150.84 = movement (4,559.76)
 *   rewards 202 + 1,388 - 816 - 0 = 774
 */

export const SEYLAN_REAL_EXPECTED = {
  accountMask: '2470',
  supplementaryMask: '9136',
  statementDate: '2026-09-07',
  paymentDueDate: '2026-09-28',
  creditLimit: 1_000_000,
  interestRateAnnual: 0.26,
  openingBalance: 146_696.28,
  charges: 61_841.12,
  payments: 66_400.88,
  financeCharge: 0,
  closingBalance: 142_136.52,
  minimumPayment: 4_201.45,
  transactionCount: 11,
  mainCardSubtotal: -11_710.6,
  supplementaryCardSubtotal: 7_150.84,
  rewards: { opening: 202, accumulated: 1_388, redeemed: 816, adjusted: 0, balance: 774 },
} as const;

interface Row {
  post: string;
  tran: string;
  reference?: string;
  description: string;
  amount: string;
  credit?: boolean;
  foreign?: { code: string; amount: string };
}

const MAIN_ROWS: Row[] = [
  { post: '10/08', tran: '09/08', reference: '****0770', description: 'CEFT PAYMENT', amount: '12,000.00', credit: true },
  { post: '11/08', tran: '09/08', reference: '****1236', description: 'ACME HEALTH - KOTTAWA  LK', amount: '1,071.30' },
  { post: '11/08', tran: '11/08', reference: '****4424', description: 'SEYLAN EASY PAY - SP 010 of 036', amount: '27,777.77' },
  { post: '11/08', tran: '11/08', reference: '****4812', description: 'SEYLAN EASY PAY - SP 009 of 036', amount: '2,890.00' },
  { post: '12/08', tran: '08/08', reference: '****2168', description: 'NORTHWAY FUEL MART  PANNIPITIYA  LK', amount: '15,930.73' },
  { post: '25/08', tran: '25/08', reference: '****8688', description: 'CEFT PAYMENT', amount: '50,000.00', credit: true },
  // A settlement line with no reference at all.
  { post: '28/08', tran: '28/08', description: 'Payment', amount: '4,400.88', credit: true },
];

/** Rows that fall on page two, including the foreign-currency purchase. */
const MAIN_ROWS_PAGE_TWO: Row[] = [
  {
    post: '02/09', tran: '28/08', reference: '****1864',
    description: 'GLOBEX*ONLINE  Wilmington DEUS', amount: '6,861.48',
    foreign: { code: 'USD', amount: '20.00' },
  },
  { post: '07/09', tran: '05/09', reference: '****8924', description: 'TELCO PLC  Colombo 02  LK', amount: '159.00' },
];

const SUPPLEMENTARY_ROWS: Row[] = [
  { post: '07/08', tran: '05/08', reference: '****2845', description: 'ACME HEALTH - KOTTAWA  LK', amount: '4,736.80' },
  { post: '31/08', tran: '27/08', reference: '****5753', description: 'VALUE SUPER - KOTTAWA  LK', amount: '2,414.04' },
];

const COL = { post: 40, tran: 85, reference: 130, description: 185, currency: 440, amountRight: 520 } as const;

export interface RealLayoutOptions {
  /** Override the printed closing balance, to exercise a failing cycle. */
  closingBalanceOverride?: string;
  /** Override the rewards balance, to exercise a block that does not add up. */
  rewardsBalanceOverride?: string;
}

export function seylanRealLayoutPages(options: RealLayoutOptions = {}): PageSpec[] {
  return [buildPageOne(options), buildPageTwo(options)];
}

function buildPageOne(options: RealLayoutOptions): PageSpec {
  const p = new PageBuilder();

  p.at(40, 'Seylan Card Centre', { size: 8 }).down(13);
  p.at(40, 'No : 90 Galle Road,', { size: 7 }).down(13);
  p.at(40, 'Colombo 03, Sri Lanka.', { size: 7 }).down(13);
  p.at(40, 'Hot Line : 0112008888', { size: 7 }).down(33);
  p.at(40, 'A SAMPLE CARDHOLDER', { size: 7 }).down(13);
  p.at(40, '000/0 X', { size: 7 }).down(13);
  p.at(40, 'SAMPLE ROAD', { size: 7 }).down(70);

  // --- header grid, three bands -------------------------------------------
  p.at(40, 'Card Number', { size: 7, bold: true })
    .at(150, 'Interest Rate', { size: 7, bold: true })
    .at(260, 'Rewards Points Balance', { size: 7, bold: true })
    .down(17);
  p.at(40, '****2470', { size: 7 })
    .at(150, '26% P.A.', { size: 7 })
    .rightAt(360, '774.00', { size: 7 })
    .down(20);

  p.at(40, 'Statement Date', { size: 7, bold: true })
    .at(130, 'Credit Limit', { size: 7, bold: true })
    .at(230, 'Min. Payment Due', { size: 7, bold: true })
    .at(340, 'Payment Due Date', { size: 7, bold: true })
    .at(450, 'Past Due Amount', { size: 7, bold: true })
    .down(17);
  p.at(40, '07/09/26', { size: 7 })
    .rightAt(210, '1,000,000.00', { size: 7 })
    .rightAt(310, '4,201.45', { size: 7 })
    .at(340, '28/09/26', { size: 7 })
    .rightAt(530, '0.00', { size: 7 })
    .down(26);

  p.at(40, 'Opening Balance', { size: 7, bold: true })
    .at(130, 'New Charges & Debits', { size: 7, bold: true })
    .at(260, 'Finance Charge (int)', { size: 7, bold: true })
    .at(370, 'Payment & Credits', { size: 7, bold: true })
    .at(470, 'Closing Balance', { size: 7, bold: true })
    .down(18);
  p.rightAt(110, '146,696.28', { size: 7 })
    .rightAt(240, '61,841.12', { size: 7 })
    .rightAt(350, '0.00', { size: 7 })
    .rightAt(460, '66,400.88', { size: 7 })
    .rightAt(555, options.closingBalanceOverride ?? '142,136.52', { size: 7 })
    .down(16);

  p.at(40, 'Page 1 of 2', { size: 7 }).down(16);
  writeTableHeader(p);
  p.at(40, 'Opening Balance', { size: 7, bold: true })
    .rightAt(COL.amountRight, '146,696.28', { size: 7 })
    .down(24);

  for (const row of MAIN_ROWS) writeRow(p, row);

  p.down(28);
  p.at(40, 'Seylan Card Centre: No. 90, Galle Road, Colombo 3', { size: 6 });
  return p.build();
}

function buildPageTwo(options: RealLayoutOptions): PageSpec {
  const p = new PageBuilder();

  p.at(40, 'Page 2 of 2', { size: 7 }).down(16);
  writeTableHeader(p);

  for (const row of MAIN_ROWS_PAGE_TWO) writeRow(p, row);

  p.at(COL.description, '** CARD - 40463300****2470 SUBTOTAL-', { size: 7, bold: true })
    .at(COL.currency, 'LKR', { size: 7 })
    .rightAt(COL.amountRight, '11,710.60', { size: 7 })
    .at(COL.amountRight + 3, 'CR', { size: 7 })
    .down(14);

  for (const row of SUPPLEMENTARY_ROWS) writeRow(p, row);

  p.at(COL.description, '** CARD - 40463300****9136 SUBTOTAL-', { size: 7, bold: true })
    .at(COL.currency, 'LKR', { size: 7 })
    .rightAt(COL.amountRight, '7,150.84', { size: 7 })
    .down(14);

  p.at(40, 'Closing Balance', { size: 7, bold: true })
    .rightAt(COL.amountRight, options.closingBalanceOverride ?? '142,136.52', { size: 7 })
    .down(60);

  // --- rewards, one label per line ----------------------------------------
  p.at(40, 'Seylan Rewards Points Details (For The Period)', { size: 7, bold: true }).down(24);
  const rewards: [string, string][] = [
    ['Opening Balance', '202'],
    ['Points Accumulated', '1,388'],
    ['Points Adjusted', '0'],
    ['Points Redeemed', '816'],
    ['Points Balance', options.rewardsBalanceOverride ?? '774'],
  ];
  for (const [label, value] of rewards) {
    p.at(40, label, { size: 7 }).rightAt(220, value, { size: 7 }).down(17);
  }
  p.at(40, 'Expiring Points / Date', { size: 7 }).at(190, '774/ 2029-12-31', { size: 7 }).down(40);

  p.at(40, 'Seylan Card Centre: No. 90, Galle Road, Colombo 3', { size: 6 });
  return p.build();
}

function writeTableHeader(p: PageBuilder): void {
  p.at(COL.post, 'Post Date', { size: 7, bold: true })
    .at(COL.tran, 'Tran. Date', { size: 7, bold: true })
    .at(COL.description, 'Transaction Details', { size: 7, bold: true })
    .rightAt(COL.amountRight, 'Amount Rs.', { size: 7, bold: true })
    .down(22);
}

function writeRow(p: PageBuilder, row: Row): void {
  p.at(COL.post, row.post, { size: 7 }).at(COL.tran, row.tran, { size: 7 });
  if (row.reference) p.at(COL.reference, row.reference, { size: 7 });
  p.at(COL.description, row.description, { size: 7 });
  p.at(COL.currency, 'LKR', { size: 7 });
  p.rightAt(COL.amountRight, row.amount, { size: 7 });
  if (row.credit) p.at(COL.amountRight + 3, 'CR', { size: 7 });
  p.down(14);

  if (row.foreign) {
    p.at(COL.description + 10, row.foreign.code, { size: 7 })
      .rightAt(COL.amountRight, row.foreign.amount, { size: 7 })
      .down(14);
  }
}
