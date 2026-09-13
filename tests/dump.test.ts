import { describe, it } from 'vitest';
import { seylanStatementPages } from './fixtures/seylan';
import { parsePagesOrThrow } from './helpers/parse';
import { renderStatementReport } from './helpers/report';

/**
 * Not an assertion -- a readable dump of what the parser made of the fixture,
 * so parser output can be reviewed rather than inferred from passing tests.
 * Run with:  npx vitest run tests/dump.test.ts --reporter=verbose
 */
describe.runIf(process.env.DUMP === '1')('parser output', () => {
  it('seylan', async () => {
    const statement = await parsePagesOrThrow(seylanStatementPages(), 'seylan-2026-04-06.pdf');
    console.log(`\n${renderStatementReport(statement)}\n`);
  });
});
