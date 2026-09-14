import type { Money, Statement } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { roundMoney } from '@/lib/money';
import type { ReversalAnalysis } from './reversals';
import type { ChainAnalysis } from './gaps';
import type { Reconciliation } from '@/domain/types';

/**
 * Anomaly detection.
 *
 * Every finding states what was observed and why it is worth a look. None of
 * them asserts wrongdoing or recommends an action -- the app reports what the
 * statements say and flags what looks wrong.
 */

export type AnomalySeverity = 'critical' | 'serious' | 'warning' | 'info';

export interface Anomaly {
  id: string;
  severity: AnomalySeverity;
  kind: string;
  title: string;
  detail: string;
  /** Where to look: statement id, transaction id, or a cycle window. */
  reference?: string;
  amount?: Money;
}

export interface AnomalyInput {
  statements: readonly Statement[];
  reconciliations: readonly Reconciliation[];
  reversals: ReversalAnalysis;
  chain: ChainAnalysis;
}

/** Merchants that mask the real counterparty behind an aggregator. */
const AGGREGATOR_RE = /\b(WEPAY|MINTPAY|PAYHERE|KOKO|DIRECTPAY|IPAY|FRIMI|GENIE)\b/i;

/** A charge to an aggregator above this is worth surfacing. */
const AGGREGATOR_THRESHOLD = 25_000;

export function detectAnomalies(input: AnomalyInput): Anomaly[] {
  const { statements, reconciliations, reversals, chain } = input;
  const found: Anomaly[] = [];

  const byId = new Map(statements.map((s) => [s.id, s]));

  for (const rec of reconciliations) {
    const statement = byId.get(rec.statementId);

    if (rec.passes) {
      /*
       * An OCR reading that satisfies the invariant has passed a test it
       * could not have passed by luck: a misread digit breaks
       * opening + charges - payments = closing, and separately breaks the
       * per-card subtotals. Two independent checksums agreeing is what makes
       * the figures believable -- so say that, rather than leaving the reader
       * to wonder how much to trust a scan.
       */
      if (statement?.source === 'ocr') {
        const subtotalsAgree = (statement.cardSubtotals ?? []).every((c) => c.matches);
        found.push({
          id: `ocr-ok:${rec.statementId}`,
          severity: 'info',
          kind: 'ocr-verified',
          title: `Read by OCR from an image, and the arithmetic checks out`,
          detail:
            `····${statement.accountMask} was a scan, so its figures were read off the page ` +
            `by character recognition at ${Math.round(statement.ocrConfidence ?? 0)}% mean confidence. ` +
            `They satisfy opening + charges - payments = closing exactly` +
            (subtotalsAgree && (statement.cardSubtotals?.length ?? 0) > 0
              ? `, and the per-card subtotals agree too`
              : '') +
            `. A misread digit would have broken that, so the figures can be relied on. ` +
            `Descriptions are not checked by any sum and may still contain OCR errors.`,
          reference: rec.statementId,
        });
      }
      continue;
    }

    if (statement?.source === 'ocr') {
      found.push({
        id: `ocr-fail:${rec.statementId}`,
        severity: 'critical',
        kind: 'ocr-unverified',
        title: 'A scanned statement was read, but its figures do not add up',
        detail:
          `····${statement.accountMask} was read by character recognition at ` +
          `${Math.round(statement.ocrConfidence ?? 0)}% mean confidence, and the result fails ` +
          `opening + charges - payments = closing by ${rec.delta.toFixed(2)}. That almost always ` +
          `means a digit was misread rather than that the bank is wrong. These figures are not ` +
          `trustworthy and are excluded from every total. A clearer scan, or the bank's own PDF, ` +
          `would settle it.`,
        reference: rec.statementId,
        amount: rec.delta,
      });
      continue;
    }

    found.push({
      id: `recon:${rec.statementId}`,
      severity: 'critical',
      kind: 'reconciliation',
      title: 'A cycle does not reconcile',
      detail:
        rec.hint ??
        `Opening plus charges less payments comes to ${rec.computedClosing.toFixed(2)}, ` +
          `but the statement prints ${rec.printedClosing.toFixed(2)}.`,
      reference: rec.statementId,
      amount: rec.delta,
    });
  }

  for (const gap of chain.gaps) {
    found.push({
      id: `gap:${gap.previous.id}`,
      severity: 'serious',
      kind: 'missing-statement',
      title: `A statement is missing for ····${gap.accountMask}`,
      detail:
        `${formatDate(gap.windowFrom)} closes at ${gap.previous.closingBalance.toFixed(2)} but ` +
        `${formatDate(gap.windowTo)} opens at ${gap.next.openingBalance.toFixed(2)}. ` +
        `About ${gap.estimatedMissingCycles} cycle(s) are unaccounted for, carrying ` +
        `${gap.impliedMovement.toFixed(2)} of net movement. Nothing has been interpolated.`,
      reference: `${gap.windowFrom}..${gap.windowTo}`,
      amount: gap.impliedMovement,
    });
  }

  for (const credit of reversals.unmatchedCredits) {
    found.push({
      id: `orphan:${credit.id}`,
      severity: 'serious',
      kind: 'credit-without-debit',
      title: 'A credit with no matching debit',
      detail:
        `${credit.description} was credited ${Math.abs(credit.amount).toFixed(2)} on ` +
        `${formatDate(credit.postDate)}, but no debit of that amount appears anywhere in the ` +
        `loaded statements. Either the originating cycle is not loaded, or the bank credited ` +
        `something it never charged.`,
      reference: credit.id,
      amount: credit.amount,
    });
  }

  // Aggregator charges: the counterparty is hidden, so these cannot be
  // categorised or disputed from the statement alone.
  for (const statement of statements) {
    for (const txn of statement.transactions) {
      if (txn.amount < AGGREGATOR_THRESHOLD) continue;
      if (!AGGREGATOR_RE.test(txn.description)) continue;
      found.push({
        id: `aggregator:${txn.id}`,
        severity: 'warning',
        kind: 'masked-counterparty',
        title: 'Large charge to a payment aggregator',
        detail:
          `${txn.description} for ${txn.amount.toFixed(2)} on ${formatDate(txn.postDate)}. ` +
          `The aggregator is the merchant of record, so the statement does not say who was ` +
          `actually paid.`,
        reference: txn.id,
        amount: txn.amount,
      });
    }
  }

  found.push(...rateAndLimitChanges(statements));
  found.push(...interestOnQuietCard(statements));
  found.push(...unreversedSurcharges(statements));
  found.push(...brokenRewards(statements));

  const order: Record<AnomalySeverity, number> = { critical: 0, serious: 1, warning: 2, info: 3 };
  return found.sort((a, b) => order[a.severity] - order[b.severity]);
}

function rateAndLimitChanges(statements: readonly Statement[]): Anomaly[] {
  const out: Anomaly[] = [];
  const byCard = groupByCard(statements);

  for (const group of byCard.values()) {
    for (let i = 0; i < group.length - 1; i += 1) {
      const a = group[i]!;
      const b = group[i + 1]!;
      if (Math.abs(a.interestRateAnnual - b.interestRateAnnual) > 1e-9) {
        out.push({
          id: `rate:${b.id}`,
          severity: 'warning',
          kind: 'rate-change',
          title: `Interest rate changed on ····${b.accountMask}`,
          detail:
            `${(a.interestRateAnnual * 100).toFixed(2)}% p.a. on ${formatDate(a.statementDate)} ` +
            `became ${(b.interestRateAnnual * 100).toFixed(2)}% on ${formatDate(b.statementDate)}.`,
          reference: b.id,
        });
      }
      if (Math.abs(a.creditLimit - b.creditLimit) > 0.005) {
        out.push({
          id: `limit:${b.id}`,
          severity: 'info',
          kind: 'limit-change',
          title: `Credit limit changed on ····${b.accountMask}`,
          detail:
            `${a.creditLimit.toFixed(2)} on ${formatDate(a.statementDate)} became ` +
            `${b.creditLimit.toFixed(2)} on ${formatDate(b.statementDate)}.`,
          reference: b.id,
          amount: roundMoney(b.creditLimit - a.creditLimit),
        });
      }
    }
  }
  return out;
}

/** Interest on a card that has otherwise never carried any. */
function interestOnQuietCard(statements: readonly Statement[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const group of groupByCard(statements).values()) {
    if (group.length < 2) continue;
    const charged = group.filter((s) => s.financeCharge > 0.005);
    if (charged.length === 0 || charged.length === group.length) continue;
    for (const statement of charged) {
      out.push({
        id: `interest:${statement.id}`,
        severity: 'warning',
        kind: 'unexpected-interest',
        title: `Interest charged on ····${statement.accountMask}, which normally carries none`,
        detail:
          `${statement.financeCharge.toFixed(2)} of finance charge on ` +
          `${formatDate(statement.statementDate)}. The other ${group.length - charged.length} ` +
          `loaded cycle(s) on this card carry none.`,
        reference: statement.id,
        amount: statement.financeCharge,
      });
    }
  }
  return out;
}

/** A fuel surcharge levied with no reversal in the same cycle. */
function unreversedSurcharges(statements: readonly Statement[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const statement of statements) {
    const levied = statement.transactions.filter((t) => t.classification === 'fuel_surcharge');
    const reversed = statement.transactions.filter(
      (t) => t.classification === 'fuel_surcharge_reversal',
    );
    const leviedTotal = roundMoney(levied.reduce((a, t) => a + t.amount, 0));
    const reversedTotal = roundMoney(Math.abs(reversed.reduce((a, t) => a + t.amount, 0)));
    if (leviedTotal > 0.005 && reversedTotal + 0.005 < leviedTotal) {
      out.push({
        id: `surcharge:${statement.id}`,
        severity: 'warning',
        kind: 'unreversed-surcharge',
        title: `Fuel surcharge not fully reversed on ····${statement.accountMask}`,
        detail:
          `${leviedTotal.toFixed(2)} levied, ${reversedTotal.toFixed(2)} reversed, on the cycle ` +
          `ending ${formatDate(statement.statementDate)}. These are normally reversed in full.`,
        reference: statement.id,
        amount: roundMoney(leviedTotal - reversedTotal),
      });
    }
  }
  return out;
}

function brokenRewards(statements: readonly Statement[]): Anomaly[] {
  return statements
    .filter((s) => s.rewards && !s.rewards.reconciled)
    .map((s) => ({
      id: `rewards:${s.id}`,
      severity: 'warning' as const,
      kind: 'rewards-unreconciled',
      title: `Reward points do not balance on ····${s.accountMask}`,
      detail:
        `No assignment of the printed values (${s.rewards!.observed.join(', ')}) satisfies ` +
        `opening + accumulated - redeemed - adjusted = balance, so none has been assumed.`,
      reference: s.id,
    }));
}

function groupByCard(statements: readonly Statement[]): Map<string, Statement[]> {
  const map = new Map<string, Statement[]>();
  for (const s of statements) {
    const key = `${s.issuer}:${s.accountMask}`;
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  for (const [key, group] of map) {
    map.set(key, [...group].sort((a, b) => a.statementDate.localeCompare(b.statementDate)));
  }
  return map;
}
