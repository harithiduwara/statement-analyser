/**
 * Browser capability reporting.
 *
 * `compat.js` shims what can be shimmed. This names what cannot, so a failure
 * on an old browser is reported as "your browser is missing X" rather than as
 * the browser's own message -- Safari renders a missing API as
 * "undefined is not a function (near '...')", which sends the reader looking
 * for a bug in their statement.
 */

interface Capability {
  name: string;
  since: string;
  present: () => boolean;
}

const CAPABILITIES: Capability[] = [
  {
    name: 'Promise.withResolvers',
    since: 'Safari 17.4, Chrome 119, Firefox 121',
    // Typed loosely on purpose: the lib target predates this API, and the
    // whole point of the check is that it may not be there.
    present: () =>
      typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers === 'function',
  },
  {
    name: 'Object.hasOwn',
    since: 'Safari 15.4, Chrome 93, Firefox 92',
    present: () => typeof Object.hasOwn === 'function',
  },
  {
    name: 'structuredClone',
    since: 'Safari 15.4, Chrome 98, Firefox 94',
    present: () => typeof structuredClone === 'function',
  },
  {
    name: 'Web Workers',
    since: 'every current browser',
    present: () => typeof Worker === 'function',
  },
];

/** Capabilities still missing after the shims have been installed. */
export function missingCapabilities(): string[] {
  return CAPABILITIES.filter((c) => {
    try {
      return !c.present();
    } catch {
      return true;
    }
  }).map((c) => `${c.name} (added in ${c.since})`);
}

/**
 * Turn a raw extraction failure into something that names the real cause.
 * A missing API is a browser-version problem, not a problem with the file,
 * and saying so is the difference between a fixable message and a dead end.
 */
export function explainFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const missing = missingCapabilities();

  if (missing.length > 0) {
    return (
      `This browser is missing ${missing.join(' and ')}, which the PDF reader needs. ` +
      `Updating the browser — on iPhone, iOS Settings › General › Software Update — should fix it. ` +
      `The underlying error was: ${raw}`
    );
  }

  if (/is not a function|undefined is not|null is not an object/i.test(raw)) {
    return (
      `The PDF reader failed in a way that usually means an unsupported browser version. ` +
      `The underlying error was: ${raw}`
    );
  }

  if (/password|encrypted/i.test(raw)) {
    return `This PDF is password protected. Save an unlocked copy and try again. (${raw})`;
  }

  if (/Invalid PDF|InvalidPDFException|corrupt/i.test(raw)) {
    return `This file does not look like a readable PDF — it may be a scan, or incomplete. (${raw})`;
  }

  return raw;
}
