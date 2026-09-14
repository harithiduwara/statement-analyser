import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Privacy guards.
 *
 * The claim this app makes to its users is that a statement never leaves the
 * browser. That claim is only as good as the next change to the codebase, so
 * it is asserted here rather than left to review: if anyone adds a network
 * call, a third-party script, or persistence of statement content, one of
 * these fails.
 *
 * These are source-level checks. They cannot prove a dependency makes no
 * request -- only that this codebase asks for none.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx|css|html)$/.test(entry) ? [path] : [];
  });
}

/** Strip comments and string-ish noise so a mention is not read as a call. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no statement ever leaves the browser', () => {
  const files = sourceFiles('src');

  it('makes no outbound request of any kind', () => {
    // Every way a page can reach the network, short of a dependency doing it.
    const forbidden =
      /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.connection|RTCPeerConnection|importScripts)\b/;
    const offenders = files
      .filter((f) => forbidden.test(code(f)))
      .map((f) => `${f}: ${forbidden.exec(code(f))?.[0]}`);
    expect(offenders).toEqual([]);
  });

  it('loads no third-party script, style, frame or image', () => {
    const html = readFileSync('index.html', 'utf8');
    // Anything with a scheme or protocol-relative URL in a loading attribute.
    const external = /<(script|link|iframe|img)[^>]+(src|href)\s*=\s*["'](?!data:)(https?:)?\/\//gi;
    expect(html.match(external)).toBeNull();
  });

  it('declares no remote font or CMap source for the PDF reader', () => {
    // With neither configured, pdf.js has nothing it could fetch.
    const pdf = code('src/parsing/pdf.ts');
    expect(pdf).not.toMatch(/cMapUrl|standardFontDataUrl/);
    expect(pdf).toMatch(/useWorkerFetch:\s*false/);
  });

  it('persists only preferences, never statement content', () => {
    // Every localStorage key the app writes, and what may go in it.
    const writers = files.filter((f) => /localStorage\.setItem/.test(code(f)));
    expect(writers.sort()).toEqual(
      ['src/state/useCategoryRules.ts', 'src/ui/theme.ts'].sort(),
    );
    // Neither writer may reach a Statement or a Txn.
    for (const file of writers) {
      expect(code(file), file).not.toMatch(/\bStatement\b|\bTxn\b|transactions/);
    }
  });

  it('masks the card number at extraction, not at display', () => {
    const seylan = code('src/parsing/seylan/index.ts');
    expect(seylan).toMatch(/maskCardNumber/);
    // The raw header value must not be carried on the statement itself.
    expect(seylan).not.toMatch(/cardNumber:\s*raw|fullCardNumber|pan:/i);
  });
});
