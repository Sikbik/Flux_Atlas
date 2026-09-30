// Neutral, token-driven placeholder surfaces. The shell and feature teams replace these with the
// designed windows; they exist so every route renders real data end to end today.

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { isApiError } from '../../api/http';

export function Panel({ title, kind, children }: { title: string; kind: string; children?: ReactNode }) {
  return (
    <section className="panel" aria-label={title} data-window={kind}>
      <header className="panel-head">
        <h1 className="panel-title">{title}</h1>
        <span className="panel-kind">{kind}</span>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

type Scalar = string | number | boolean | null;

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `${v.length} items`;
  if (typeof v === 'object') return `${Object.keys(v as object).length} fields`;
  return String(v as Scalar);
}

/** Up to `max` top-level fields of a DTO as a definition list. */
export function DataPreview({ data, max = 16 }: { data: unknown; max?: number }) {
  if (data === undefined) return null;
  if (typeof data !== 'object' || data === null) return <p className="mono">{describe(data)}</p>;
  const entries = Object.entries(data as Record<string, unknown>).slice(0, max);
  return (
    <dl className="kv">
      {entries.map(([k, v]) => (
        <div key={k} className="kv-row">
          <dt>{k}</dt>
          <dd className="mono tabular">{describe(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Loading, error and data states of one query. */
export function QueryState<T>({ q, children }: { q: UseQueryResult<T>; children?: (data: T) => ReactNode }) {
  if (q.isPending) return <p className="muted">Loading</p>;
  if (q.isError) {
    const e = q.error;
    const code = isApiError(e) ? e.code : 'error';
    return (
      <p className="error" role="alert">
        <span className="mono">{code}</span> {e instanceof Error ? e.message : String(e)}
      </p>
    );
  }
  return <>{children ? children(q.data) : <DataPreview data={q.data} />}</>;
}
