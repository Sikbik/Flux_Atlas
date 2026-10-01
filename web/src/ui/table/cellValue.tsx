// The default content of a cell: a plain value rendered the way the rest of the app writes numbers,
// dates and flags. Missing values come back as `null` so the table can draw the muted word Unknown.

import { isValidElement, type ReactNode } from 'react';
import { formatInt, formatUtcDateTime } from '../../lib/format';

const decimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** The default rendering of a value, or `null` when there is nothing to show (nullish, NaN, empty text, invalid date). */
export function renderCellValue(v: unknown): ReactNode {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case 'number':
      if (!Number.isFinite(v)) return null;
      return Number.isInteger(v) ? formatInt(v) : decimals.format(v);
    case 'bigint':
      return v.toLocaleString('en-US');
    case 'string':
      return v === '' ? null : v;
    case 'boolean':
      return v ? 'Yes' : 'No';
    default:
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : formatUtcDateTime(v.getTime());
      if (isValidElement(v)) return v;
      return String(v);
  }
}
