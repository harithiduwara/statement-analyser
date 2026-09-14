import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Guards for the compatibility shims.
 *
 * pdf.js calls `Promise.withResolvers` (Safari 17.4+) and `Object.hasOwn`
 * (Safari 15.4+). Without shims an older iPhone fails before reading a single
 * page, and Safari reports it only as "undefined is not a function" -- which
 * sends the reader looking for a problem in their statement.
 *
 * Node 22 does not implement `Promise.withResolvers` either, so importing the
 * shim here exercises the real install path rather than a simulated one.
 */
describe('compatibility shims', () => {
  it('installs Promise.withResolvers where the runtime lacks it', async () => {
    await import('@/parsing/compat.js');
    const withResolvers = (Promise as unknown as { withResolvers?: () => unknown }).withResolvers;
    expect(typeof withResolvers).toBe('function');

    const { promise, resolve } = (
      Promise as unknown as {
        withResolvers: <T>() => { promise: Promise<T>; resolve: (v: T) => void };
      }
    ).withResolvers<number>();
    resolve(42);
    await expect(promise).resolves.toBe(42);
  });

  it('installs the rest of the set', async () => {
    await import('@/parsing/compat.js');
    expect(typeof Object.hasOwn).toBe('function');
    expect(Object.hasOwn({ a: 1 }, 'a')).toBe(true);
    expect(Object.hasOwn({ a: 1 }, 'b')).toBe(false);
    expect([1, 2, 3].at(-1)).toBe(3);

    // Typed loosely on purpose. The lib target is deliberately older than
    // these APIs -- that is the whole reason the shims exist, and raising it
    // would let app code use them unshimmed.
    type LateArray = {
      findLast(p: (n: number) => boolean): number | undefined;
      findLastIndex(p: (n: number) => boolean): number;
    };
    const sample = [1, 2, 3, 4] as unknown as LateArray;
    expect(sample.findLast((n) => n % 2 === 1)).toBe(3);
    expect(sample.findLastIndex((n) => n % 2 === 1)).toBe(2);
  });

  it('is plain script source, so it can be prepended to the worker bundle', () => {
    // The Vite build prepends this file verbatim to the pdf.js worker, which
    // has its own global scope. Any import or export would break that.
    const source = readFileSync('src/parsing/compat.js', 'utf8');
    expect(source).not.toMatch(/^\s*(import|export)\s/m);
    expect(source).toMatch(/withResolvers/);
    expect(source).toMatch(/hasOwn/);
  });
});
