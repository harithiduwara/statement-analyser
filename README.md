# Credit Card Statement Analyser

Local-first analysis of Sri Lankan credit card e-statements. Statements are
parsed and analysed **entirely in the browser** — no upload endpoint, no
third-party API, no telemetry, no analytics. There is no backend to send a
statement to even if something tried.

## Status

Build order from the brief, with step 1 complete:

| Step | Scope | State |
|---|---|---|
| 1 | Types, Seylan parser, fixtures, reconciliation tests | **done** |
| 2 | Sampath parser (embedded dates, multi-page) | not started |
| 3 | `ReversalMatcher`, payments/reversals split | not started |
| 4 | Instalment registry, cost of credit | not started |
| 5 | Analytics: gaps, decomposition, forward schedule | not started |
| 6 | UI, categories, anomalies | shell only |
| 7 | Excel export | not started |

```
npm install
npm test         # 34 tests
npm run dump     # prints the parser's reading of the fixture statement
npm run build    # static build, deployable to any static host
```

## How it is put together

```
src/domain/types.ts      the domain model and the money sign convention
src/lib/money.ts         amount parsing, including the CR-suffix rule
src/lib/mask.ts          card masking, applied at the point of extraction
src/lib/dates.ts         day-first date parsing, no assumed cycle day
src/parsing/pdf.ts       the only pdf.js dependency in the codebase
src/parsing/textLayer.ts positioned text items -> rows -> gap-aware strings
src/parsing/headerGrid.ts label/value grids read by column
src/parsing/classify.ts  transaction classification rules
src/parsing/rewards.ts   the rewards identity solver
src/parsing/parser.ts    StatementParser interface + issuer registry
src/parsing/seylan/      the Seylan adapter
src/analysis/reconcile.ts  opening + charges - payments = closing
```

Parsers never touch pdf.js. They work on a `DocumentLayer` of positioned text
items, which is what makes them testable and what keeps column alignment —
the thing statement layouts actually encode — from being flattened away.

Adding a third issuer is a new file implementing `StatementParser` plus one
`registerParser` call. Nothing else changes.

### Fixtures

Fixture PDFs are **generated from a declarative layout** (`tests/helpers/makePdf.ts`)
rather than checked in as binaries. No real statement data is in this
repository, and every fixture's content is reviewable as source. The generated
PDF has a genuine text layer, so tests run the same pdf.js path the browser
does rather than a mock.

To run the parser against your own statements locally, drop them in
`tests/fixtures/private/` — that directory and all `*.pdf` files are
gitignored.

## Privacy properties, and how they are enforced

- **Masking happens at extraction.** `maskCardNumber` is called on the header
  match and the full value is discarded in the same expression. A test asserts
  that no run of 8+ digits survives into the serialised statement.
- **No network from the PDF layer.** `getDocument` is given local bytes with
  `useWorkerFetch: false` and no CMap or standard-font URL configured, so
  pdf.js has nothing to fetch.
- **No third-party script** in `index.html`.

## Assumptions in the Seylan adapter

These are inferences from the described layout, not things I have verified
against a real statement. Each one is a place the parser could be wrong on
your PDFs, and each fails loudly rather than silently:

1. **The finance charge is inside `New Charges & Debits`.** The `Finance
   Charge (int)` header field is read as a disclosure of the interest portion,
   not as an amount to add on top. If your issuer prints it outside the charges
   total, the invariant will fail by exactly the finance charge and
   `reconcile()` says so in as many words rather than quietly adding it.
2. **Per-card subtotals are net movement** (debits less credits for that card),
   not gross debits. Both per-card sums and their total are cross-checked
   against the header.
3. **A reference is a leading token** of 6+ digits or 8+ alphanumerics at the
   head of the description column. If Seylan prints references in their own
   positional column, this should become a column read instead.
4. **`fuel_surcharge` was added to `TxnClass`.** The specified set had only
   `fuel_surcharge_reversal`, which left the levy itself with nowhere to go
   except `purchase` — that would overstate spending and make the "surcharge
   levied without a matching reversal" anomaly undetectable.
5. **Rewards pairs are left open rather than guessed.** See below.

## Two decisions worth knowing about

### The rewards block

The brief asks for the assignment satisfying
`opening + accumulated − redeemed − adjusted = balance`. That identity is
symmetric within two pairs: swapping `opening` with `accumulated` leaves it
true, as does swapping `redeemed` with `adjusted`. So it proves which value is
the balance and which two are added versus subtracted — but not the order
inside either pair.

The obvious tie-breaker is unusable. If the labels had lined up with the
values, the positional reading would already have satisfied the identity; the
only reason to be solving is that it did not, which means the labels are known
mis-aligned and cannot order a pair either.

So the parser reports what it actually knows: the balance, the additive pair,
the subtractive pair, and an explicit note that the order within each is
undetermined. It is then closed without guessing — the previous cycle's
closing points balance *is* this cycle's opening balance, so
`resolveWithPriorBalance` finishes the job as soon as a second statement is
loaded.

### Reconciliation failures name their cause

`reconcile()` does not just report a delta. When the delta's shape identifies a
specific cause — it equals the finance charge, it is twice the payments total
(a credit-column sign error), or the header and the line items disagree — it
says so.

## Non-goals

Bank API integration. Multi-user accounts. Anything that transmits statement
data. Tax filing. Investment or financial advice — this reports what the
statements say and flags what looks wrong; it does not recommend.
