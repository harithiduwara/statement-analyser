import { describe, expect, it } from 'vitest';
import { statement, txn } from './helpers/build';
import { buildPortfolio } from '@/analysis/portfolio';
import { SEED_RULES } from '@/analysis/categories';
import { buildWorkbookBuffer } from '@/export/workbook';
import { importWorkbook } from '@/export/importWorkbook';

type Stmt = ReturnType<typeof statement>;

async function roundTrip(statements: Stmt[]) {
  const buffer = await buildWorkbookBuffer(buildPortfolio(statements), SEED_RULES);
  return importWorkbook(buffer);
}

describe('Excel backup round-trip', () => {
  it('restores statements well enough to reproduce the analysis', async () => {
    const statements = [
      statement({
        date: '2026-01-05',
        mask: '1234',
        opening: 10_000,
        transactions: [
          txn({ post: '2026-01-08', description: 'KEELLS - COLOMBO', amount: 5_000, cardMask: '1234' }),
          txn({ post: '2026-01-20', description: 'PAYMENT - THANK YOU', amount: -8_000 }),
        ],
      }),
      statement({
        issuer: 'sampath',
        mask: '9999',
        date: '2026-02-05',
        opening: 0,
        transactions: [
          txn({ post: '2026-02-10', description: 'SINGER - KANDY', amount: 80_000, cardMask: '9999' }),
        ],
      }),
    ];

    const { statements: restored, issues } = await roundTrip(statements);
    expect(issues).toEqual([]);
    expect(restored).toHaveLength(2);

    const before = buildPortfolio(statements);
    const after = buildPortfolio(restored);
    expect(after.statementBalance).toBe(before.statementBalance);
    expect(after.trueObligation).toBe(before.trueObligation);
    expect(after.reconciliationSummary.passed).toBe(before.reconciliationSummary.passed);
    expect(after.reconciliationSummary.failed).toHaveLength(0);

    const jan = restored.find((s) => s.id === 'seylan:1234:2026-01-05');
    expect(jan).toBeDefined();
    expect(jan!.openingBalance).toBe(10_000);
    expect(jan!.transactions).toHaveLength(2);
    const payment = jan!.transactions.find((t) => t.classification === 'payment');
    expect(payment!.amount).toBe(-8_000);
  });

  it('round-trips an instalment plan so the register rebuilds identically', async () => {
    const statements = [
      statement({
        date: '2026-03-05',
        opening: 0,
        transactions: [
          txn({ post: '2026-03-10', description: 'ACME - GALLE', amount: 200_000 }),
          txn({ post: '2026-03-11', description: 'ACME - GALLE', amount: -200_000 }),
          txn({
            post: '2026-03-11',
            description: 'ACME - GALLE INSTALLMENT REPAYMENT 1/36',
            amount: 6_000,
          }),
        ],
      }),
    ];

    const { statements: restored } = await roundTrip(statements);
    const before = buildPortfolio(statements);
    const after = buildPortfolio(restored);
    expect(after.register.plans.length).toBe(before.register.plans.length);
    expect(after.register.monthlyObligation).toBe(before.register.monthlyObligation);

    const repayment = restored[0]!.transactions.find((t) => t.installmentTerm === 36);
    expect(repayment?.installmentSeq).toBe(1);
  });

  it('refuses a workbook that is not one of ours', async () => {
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.addWorksheet('Sheet1');
    const buffer = await wb.xlsx.writeBuffer();
    await expect(importWorkbook(buffer)).rejects.toThrow(/Statement Analyser workbook/);
  });
});
