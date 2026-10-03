/**
 * Client-side file download. Everything here is produced in the page and handed
 * to the browser's own download — there is no endpoint, nothing leaves the tab.
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Today as `YYYY-MM-DD`, for export filenames. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
