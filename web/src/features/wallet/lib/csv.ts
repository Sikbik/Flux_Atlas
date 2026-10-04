// CSV for the wallet's exports: nodes, daily earnings and parallel-asset claims. Plain RFC 4180 (comma, double
// quotes, CRLF), written so a spreadsheet opens it as it was meant: a cell that begins like a formula is
// defanged, and the downloaded file carries a byte order mark so a non-ASCII provider name is read as UTF-8.

export type CsvCell = string | number | boolean | null | undefined;

/** A leading character a spreadsheet would read as the start of a formula. */
const FORMULA = /^[=+\-@\t\r]/;

/**
 * One cell. Numbers and booleans are written as they are (a negative number is a number, not a formula);
 * text that could be a formula gets a leading apostrophe; text with a comma, a quote or a line break is quoted.
 */
export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const text = FORMULA.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A table as CSV text: the header row, then a row per record, joined by CRLF with a closing one. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

/** `2026-10-03`. */
export const dateStamp = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `2026-10-03 14:05:09`, UTC: the form a spreadsheet reads as a date and time. */
export const dateTimeStamp = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** `flux-wallet-t3c4EfxLoX-nodes-2026-10-03.csv`: what a file is, whose it is and when it was made. */
export function csvFilename(kind: string, address: string, ms: number): string {
  const who = address.replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'wallet';
  return `flux-wallet-${who}-${kind}-${dateStamp(ms)}.csv`;
}

/** Hands the browser a CSV file to save. Does nothing without a DOM (a test, a server render). */
export function downloadCsv(filename: string, text: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled: some browsers read the URL asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
