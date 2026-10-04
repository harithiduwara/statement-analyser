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

/**
 * A filename-safe timestamp in local time, `YYYY-MM-DD-HHMMSS`, so downloaded
 * files sort chronologically and two exports in the same day never collide.
 * Local, not UTC, because the time shown should be the reader's own.
 */
export function fileStamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
