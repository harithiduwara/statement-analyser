/**
 * Application shell.
 *
 * The parsing and analysis layers are built and tested ahead of the UI, so
 * this is a placeholder until the views land. It deliberately does nothing
 * with files yet -- there is no upload path here to accidentally send one
 * anywhere.
 */
export function App() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Credit Card Statement Analyser
      </h1>
      <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
        Statements are parsed and analysed entirely in your browser. No file is
        uploaded, and nothing is sent anywhere.
      </p>
      <p className="mt-6 rounded-md border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        The Seylan parser and the reconciliation engine are in place and under
        test. The upload and analysis views are next.
      </p>
    </main>
  );
}
