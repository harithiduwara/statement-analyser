import type { Statement } from '@/domain/types';
import { formatMoney } from '@/lib/money';
import { reconcile } from '@/analysis/reconcile';

/** Human-readable dump of a parsed statement, used to eyeball parser output. */
export function renderStatementReport(statement: Statement): string {
  const out: string[] = [];
  const rec = reconcile(statement);

  const pad = (s: string, n: number): string => s.padEnd(n);
  const num = (v: number, n = 14): string => formatMoney(v).padStart(n);

  out.push(`SOURCE   ${statement.sourceFileName}  (${statement.pageCount} pages)`);
  out.push(`ISSUER   ${statement.issuer}    CARD ****${statement.accountMask}`);
  out.push(`CYCLE    statement ${statement.statementDate}   due ${statement.paymentDueDate}`);
  out.push(
    `TERMS    limit ${formatMoney(statement.creditLimit)}   rate ${(statement.interestRateAnnual * 100).toFixed(2)}% p.a.   min due ${formatMoney(statement.minimumPayment)}`,
  );
  out.push('');

  out.push('RECONCILIATION');
  out.push(`  opening            ${num(rec.opening)}`);
  out.push(`  + charges          ${num(rec.charges)}`);
  out.push(`  - payments         ${num(rec.payments)}`);
  out.push(`  = computed closing ${num(rec.computedClosing)}`);
  out.push(`    printed closing  ${num(rec.printedClosing)}`);
  out.push(`    delta            ${num(rec.delta)}   ${rec.passes ? 'PASS' : 'FAIL'}`);
  out.push(
    `  line items sum     ${num(rec.transactionSum)}   ${rec.transactionsMatchHeader ? 'agrees with header' : 'DISAGREES with header'}`,
  );
  if (rec.hint) out.push(`  note: ${rec.hint}`);
  out.push(`  finance charge     ${num(statement.financeCharge)} (disclosed interest portion)`);
  out.push('');

  if (statement.cardSubtotals?.length) {
    out.push('PER-CARD SUBTOTALS');
    for (const s of statement.cardSubtotals) {
      out.push(
        `  ****${s.cardMask}   printed ${num(s.amount)}   from lines ${num(s.assignedSum)}   ${s.matches ? 'OK' : 'MISMATCH'}`,
      );
    }
    out.push('');
  }

  out.push(`TRANSACTIONS (${statement.transactions.length})`);
  out.push(
    `  ${pad('post', 11)}${pad('txn', 11)}${pad('card', 7)}${pad('ref', 8)}${pad('description', 42)}${'amount'.padStart(13)}  class`,
  );
  for (const t of statement.transactions) {
    out.push(
      `  ${pad(t.postDate, 11)}${pad(t.txnDate, 11)}${pad(t.cardMask ?? '-', 7)}${pad(t.reference ?? '-', 8)}${pad(truncate(t.description, 40), 42)}${num(t.amount, 13)}  ${t.classification}` +
        (t.installmentSeq ? `  [${t.installmentSeq}/${t.installmentTerm}]` : '') +
        (t.installmentPlanId ? `  plan=${t.installmentPlanId}` : ''),
    );
    if (t.currency) {
      out.push(
        `  ${' '.repeat(29)}${pad(`  ^ ${t.currency.code} ${t.currency.amount.toFixed(2)}`, 42)}${' '.repeat(13)}  implied rate ${t.currency.impliedRate?.toFixed(4)} LKR/${t.currency.code}`,
      );
    }
  }
  out.push('');

  const rewards = statement.rewards;
  if (rewards) {
    out.push('REWARD POINTS');
    if (!rewards.reconciled) {
      out.push(`  UNRECONCILED - values observed: ${rewards.observed.join(', ')}`);
    } else if (rewards.additivePair) {
      out.push(`  balance ${rewards.balance}   (resolved by identity, labels mis-aligned)`);
      out.push(`  added:      ${rewards.additivePair.join(' and ')}   (opening vs accumulated not yet determined)`);
      out.push(`  subtracted: ${rewards.subtractivePair?.join(' and ')}   (redeemed vs adjusted not yet determined)`);
    } else {
      out.push(
        `  opening ${rewards.opening}  + accumulated ${rewards.accumulated}  - redeemed ${rewards.redeemed}  - adjusted ${rewards.adjusted}  = balance ${rewards.balance}   (via ${rewards.method})`,
      );
    }
    out.push('');
  }

  if (statement.warnings.length > 0) {
    out.push(`WARNINGS (${statement.warnings.length})`);
    for (const w of statement.warnings) {
      out.push(`  [${w.level}] ${w.code}: ${w.message}`);
    }
  } else {
    out.push('WARNINGS  none');
  }

  return out.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
