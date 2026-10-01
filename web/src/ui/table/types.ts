import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { EntityRef } from '../identity/entityRoute';
import type { SortDir, SortState, SortValue } from './sorting';

/** What a custom `cell` renderer is told about its row. */
export interface DataTableCellContext {
  /** Position of the row in the displayed (sorted) order, from 0. */
  index: number;
  /** Whether the row is the table's `selectedKey`. */
  selected: boolean;
}

/** One column of a `DataTable`. Define the column array once (module scope or `useMemo`) so rows stay memoised. */
export interface DataTableColumn<Row> {
  /** Stable id: the sort key in `SortState`, and the field read from the row when neither `cell` nor `value` is given. */
  id: string;
  /** Header content (sentence case). Rendered in a sort button when the column is sortable. */
  header: ReactNode;
  /** Custom cell content; return `null` or `undefined` for "no value" and the muted word Unknown is shown. */
  cell?: (row: Row, ctx: DataTableCellContext) => ReactNode;
  /** Plain value: the default cell content (numbers, bigints, dates and booleans are formatted) and the sort key when `sortValue` is absent. */
  value?: (row: Row) => unknown;
  /** Sort key when it differs from the displayed value; nullish and NaN always sort last in both directions. */
  sortValue?: (row: Row) => SortValue;
  /** The header becomes a sort button (click cycles default direction, opposite, none). */
  sortable?: boolean;
  /** Right-aligned IBM Plex Mono with tabular figures; sorts descending first. */
  numeric?: boolean;
  /** IBM Plex Mono (ids, hashes, endpoints, anything that is data). */
  mono?: boolean;
  /** Horizontal alignment of header and cells (default `start`, or `end` when `numeric`). */
  align?: 'start' | 'center' | 'end';
  /** Fixed width as px or as a share of the free space (`'2fr'`); flexible by default. */
  width?: number | string;
  /** Narrowest the column gets before the table scrolls horizontally, px (default 96). */
  minWidth?: number;
  /** The first column sticks to the left edge on horizontal scroll (default true; set false to opt out). Ignored on other columns. */
  sticky?: boolean;
  /** Direction of the first click (default `desc` for numeric columns, else `asc`). */
  defaultSortDir?: SortDir;
  /** Tooltip on the header. */
  title?: string;
  /** Extra class on the header and the cells of this column. */
  className?: string;
}

/** What a row click or Enter reports. */
export type RowActivateEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;

export interface DataTableProps<Row> {
  /** The rows. Keep the identity of unchanged row objects between renders: only a changed object re-renders its row. */
  rows: readonly Row[];
  /** Column definitions; define once (module scope or `useMemo`). */
  columns: readonly DataTableColumn<Row>[];
  /** Stable unique key of a row (an id, never an index) so inserts never remount existing rows. */
  rowKey: (row: Row) => string | number;
  /** Accessible name of the grid (required). */
  'aria-label': string;
  /** Controlled sort; `null` is unsorted. Omit to let the table keep the sort itself. */
  sort?: SortState | null;
  /** Initial sort when the table keeps the sort itself. */
  defaultSort?: SortState | null;
  /** Called with the next sort on every header click (controlled and uncontrolled). */
  onSortChange?: (sort: SortState | null) => void;
  /** Skip client-side sorting (rows arrive sorted, for example from the server); headers still report clicks. */
  manualSort?: boolean;
  /** Called when a row is clicked or activated with Enter (not for clicks on links and buttons inside it). */
  onRowClick?: (row: Row, event: RowActivateEvent) => void;
  /** Where a row leads: Enter or a click navigates there (Ctrl or Cmd click opens a new tab). Return nullish for a row that goes nowhere. */
  rowLink?: (row: Row) => EntityRef | null | undefined;
  /** Key of the selected row (accent wash and left bar). */
  selectedKey?: string | number | null;
  /** Keys of rows that just arrived: they slide in with a white wash decaying over `--dur-fresh`. Pass `useFreshKeys(rows, rowKey)`. */
  highlightKeys?: ReadonlySet<string | number>;
  /** Row height in px (default 34) or `'compact'` (28). Raised to 40 on coarse pointers when rows are interactive. */
  rowHeight?: number | 'compact';
  /** Fixed height of the whole table (the rows scroll inside), px or any CSS length. */
  height?: number | string;
  /** Maximum height of the whole table (the rows scroll inside past it), px or any CSS length. */
  maxHeight?: number | string;
  /** Fill the remaining height of a bounded flex column parent. */
  fill?: boolean;
  /** Initial load: skeleton rows with the geometry of the loaded rows. Once rows exist they stay on screen. */
  loading?: boolean;
  /** Number of skeleton rows while loading (default 8). */
  skeletonRows?: number;
  /** Shown instead of rows when there are none (default a compact EmptyState). */
  empty?: ReactNode;
  /** Keep the header visible while the rows scroll (default true). */
  stickyHeader?: boolean;
  /** Alternate row shading (default true). */
  zebra?: boolean;
  /** Render only the visible rows: `'auto'` (default) turns it on above 200 rows. Needs a bounded height; unbounded tables get a viewport-relative maximum. */
  virtualize?: 'auto' | boolean;
  /** Rows rendered above and below the viewport when virtualised (default 8). */
  overscan?: number;
  /** Content below the rows, outside the scroller (counts, a load-more button). */
  footer?: ReactNode;
  className?: string;
}
