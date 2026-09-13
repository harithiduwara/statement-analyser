import { PageBuilder, type PageSpec } from '../helpers/makePdf';

/**
 * Synthetic Seylan statement.
 *
 * Built to the layout described for the real e-statement, with figures chosen
 * so every internal identity closes exactly:
 *
 *   opening 152,430.75 + charges 95,595.05 - payments 85,080.00
 *     = closing 162,945.80
 *   per-card subtotals (34,513.95)CR + 45,029.00 = movement 10,515.05
 *   rewards 12,450 + 3,820 - 5,000 - 120 = 11,150
 *
 * No real statement data is used or reproduced anywhere in this file.
 */

export const SEYLAN_EXPECTED = {
  accountMask: '2470',
  supplementaryMask: '8891',
  statementDate: '2026-04-06',
  paymentDueDate: '2026-05-02',
  creditLimit: 500_000,
  interestRateAnnual: 0.28,
  openingBalance: 152_430.75,
  charges: 95_595.05,
  payments: 85_080,
  financeCharge: 6_420.3,
  closingBalance: 162_945.8,
  minimumPayment: 8_147.29,
  pastDueAmount: 0,
  transactionCount: 14,
  mainCardSubtotal: -34_513.95,
  supplementaryCardSubtotal: 45_029,
  rewardsBalance: 11_150,
  rewardsAdditivePair: [3_820, 12_450] as [number, number],
  rewardsSubtractivePair: [120, 5_000] as [number, number],
} as const;

interface Row {
  post: string;
  tran: string;
  reference?: string;
  description: string;
  amount: string;
  /** Printed with a trailing `CR`, i.e. a credit. */
  credit?: boolean;
  /** Original-currency leg printed on the following line. */
  foreign?: { code: string; amount: string };
}

const MAIN_CARD_ROWS: Row[] = [
  { post: '06/03/26', tran: '05/03/26', reference: '074512', description: 'KEELLS SUPER - NUGEGODA', amount: '12,450.00' },
  { post: '08/03/26', tran: '07/03/26', reference: '074890', description: 'CEYPETCO FUEL STATION - BORELLA', amount: '8,000.00' },
  { post: '08/03/26', tran: '07/03/26', description: 'FUEL SURCHARGE', amount: '80.00' },
  { post: '09/03/26', tran: '08/03/26', description: 'FUEL SURCHARGE REVERSAL', amount: '80.00', credit: true },
  {
    post: '09/03/26',
    tran: '08/03/26',
    reference: '075233',
    description: 'NETFLIX.COM SINGAPORE',
    amount: '4,390.50',
    foreign: { code: 'USD', amount: '14.99' },
  },
  { post: '12/03/26', tran: '11/03/26', reference: '075901', description: 'SEYLAN EASY PAY - SP 010 of 036', amount: '15,750.00' },
  { post: '12/03/26', tran: '11/03/26', reference: '075902', description: 'EASY PAY PROCESSING FEE - SP 010 of 036', amount: '1,250.00' },
  { post: '15/03/26', tran: '14/03/26', reference: '076410', description: 'UBER RIDES COLOMBO', amount: '2,150.25' },
  { post: '20/03/26', tran: '19/03/26', description: 'PAYMENT - THANK YOU', amount: '85,000.00', credit: true },
  { post: '28/03/26', tran: '28/03/26', description: 'FINANCE CHARGE', amount: '6,420.30' },
  { post: '30/03/26', tran: '30/03/26', description: 'STAMP DUTY', amount: '75.00' },
];

const SUPPLEMENTARY_ROWS: Row[] = [
  { post: '10/03/26', tran: '09/03/26', reference: '077001', description: 'SINGER MEGA - KOHUWALA', amount: '34,999.00' },
  { post: '18/03/26', tran: '17/03/26', reference: '077455', description: 'DIALOG AXIATA PLC', amount: '3,250.00' },
  { post: '25/03/26', tran: '24/03/26', reference: '077980', description: 'ODEL - ALEXANDRA PLACE', amount: '6,780.00' },
];

/** Column geometry, in points, mirroring the printed statement. */
const COL = {
  postDate: 40,
  tranDate: 92,
  description: 148,
  currency: 470,
  amountRight: 548,
} as const;

export interface SeylanFixtureOptions {
  /** Override the printed closing balance, to exercise a failing cycle. */
  closingBalanceOverride?: string;
  /** Replace the rewards value row, to exercise an unreadable block. */
  rewardsValuesOverride?: string[];
  /** Drop the per-card subtotal lines. */
  omitSubtotals?: boolean;
}

export function seylanStatementPages(options: SeylanFixtureOptions = {}): PageSpec[] {
  return [buildPageOne(options), buildPageTwo(options)];
}

function buildPageOne(options: SeylanFixtureOptions): PageSpec {
  const p = new PageBuilder();

  p.at(40, 'SEYLAN BANK PLC', { size: 13, bold: true }).down(15);
  p.at(40, 'Credit Card e-Statement', { size: 9, bold: true }).down(11);
  p.at(40, 'Seylan Towers, No. 90, Galle Road, Colombo 03', { size: 7 }).down(24);

  // --- header grid, three label/value bands --------------------------------
  p.at(40, 'Card Number', { bold: true })
    .at(180, 'Interest Rate', { bold: true })
    .at(300, 'Rewards Points Balance', { bold: true })
    .at(470, 'Statement Date', { bold: true })
    .down(13);
  p.at(40, '40463300****2470')
    .at(180, '28.00% p.a.')
    .rightAt(360, '11,150')
    .at(470, '06/04/2026')
    .down(22);

  p.at(40, 'Credit Limit', { bold: true })
    .at(180, 'Min. Payment Due', { bold: true })
    .at(300, 'Payment Due Date', { bold: true })
    .at(470, 'Past Due Amount', { bold: true })
    .down(13);
  p.rightAt(140, '500,000.00')
    .rightAt(280, '8,147.29')
    .at(300, '02/05/2026')
    .rightAt(548, '0.00')
    .down(22);

  p.at(40, 'Opening Balance', { bold: true })
    .at(150, 'New Charges & Debits', { bold: true })
    .at(290, 'Finance Charge (int)', { bold: true })
    .at(410, 'Payment & Credits', { bold: true })
    .at(500, 'Closing Balance', { bold: true })
    .down(13);
  p.rightAt(125, '152,430.75')
    .rightAt(275, '95,595.05')
    .rightAt(395, '6,420.30')
    .rightAt(495, '85,080.00')
    .rightAt(588, options.closingBalanceOverride ?? '162,945.80')
    .down(26);

  // --- transaction table ---------------------------------------------------
  p.at(COL.postDate, 'Post Date', { bold: true })
    .at(COL.tranDate, 'Tran Date', { bold: true })
    .at(COL.description, 'Reference / Description', { bold: true })
    .at(COL.currency, 'Curr', { bold: true })
    .rightAt(COL.amountRight, 'Amount', { bold: true })
    .down(14);

  for (const row of MAIN_CARD_ROWS) writeRow(p, row);
  if (!options.omitSubtotals) {
    p.down(2)
      .at(COL.description, '** CARD - 40463300****2470 SUBTOTAL- LKR', { bold: true })
      .rightAt(COL.amountRight, '34,513.95')
      .at(COL.amountRight + 3, 'CR')
      .down(18);
  }

  for (const row of SUPPLEMENTARY_ROWS) writeRow(p, row);
  if (!options.omitSubtotals) {
    p.down(2)
      .at(COL.description, '** CARD - 40463300****8891 SUBTOTAL- LKR', { bold: true })
      .rightAt(COL.amountRight, '45,029.00')
      .down(18);
  }

  p.at(40, 'Please settle the minimum payment on or before the payment due date.', { size: 7 });
  return p.build();
}

function writeRow(p: PageBuilder, row: Row): void {
  p.at(COL.postDate, row.post).at(COL.tranDate, row.tran);
  const description = row.reference ? `${row.reference} ${row.description}` : row.description;
  p.at(COL.description, description);
  p.at(COL.currency, 'LKR');
  p.rightAt(COL.amountRight, row.amount);
  if (row.credit) p.at(COL.amountRight + 3, 'CR');
  p.down(12);

  if (row.foreign) {
    p.at(COL.description + 12, row.foreign.code)
      .rightAt(COL.amountRight, row.foreign.amount)
      .down(12);
  }
}

function buildPageTwo(options: SeylanFixtureOptions): PageSpec {
  const p = new PageBuilder();

  p.at(40, 'SEYLAN BANK PLC', { size: 11, bold: true }).down(13);
  p.at(40, 'Credit Card e-Statement - continued', { size: 8 }).down(28);

  p.at(40, 'REWARD POINTS SUMMARY', { size: 9, bold: true }).down(20);

  p.at(60, 'Opening Points', { bold: true })
    .at(170, 'Points Accumulated', { bold: true })
    .at(290, 'Points Redeemed', { bold: true })
    .at(400, 'Adjustments', { bold: true })
    .at(490, 'Points Balance', { bold: true })
    .down(14);

  /*
   * The value row is deliberately mis-aligned against its labels, which is
   * what the real statement's text layer does: reading the columns in order
   * gives 5,000 + 12,450 - 3,820 - 120 = 13,510, not the 11,150 printed as
   * the balance. Only the identity recovers the grouping.
   */
  const values = options.rewardsValuesOverride ?? ['5,000', '12,450', '3,820', '120', '11,150'];
  p.rightAt(120, values[0]!)
    .rightAt(235, values[1]!)
    .rightAt(350, values[2]!)
    .rightAt(450, values[3]!)
    .rightAt(560, values[4]!)
    .down(30);

  p.at(40, 'Points are valid for 24 months from the month of accumulation.', { size: 7 }).down(20);
  p.at(40, 'This is a computer generated statement and requires no signature.', { size: 7 });

  return p.build();
}
