// HTTP transport for `/api/v1`. Every failure is normalized into `ApiError` (server errors carry
// the `ApiErrorDto` code and message); aborts reject with the platform's AbortError untouched so
// TanStack Query and callers can tell cancellation from failure.

import type { ApiErrorCode } from './generated/ApiErrorCode';
import type { ApiErrorDto } from './generated/ApiErrorDto';

/** Error codes: the server's `ApiErrorCode`s plus client-side failure classes. */
export type ApiErrorKind = ApiErrorCode | 'network' | 'http' | 'parse';

export class ApiError extends Error {
  override name = 'ApiError';
  readonly code: ApiErrorKind;
  /** HTTP status, or 0 when no response arrived. */
  readonly status: number;
  readonly url: string;
  /** From `Retry-After`, in seconds, when the server sent one. */
  readonly retryAfterS: number | undefined;

  constructor(code: ApiErrorKind, message: string, status: number, url: string, retryAfterS?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.url = url;
    this.retryAfterS = retryAfterS;
  }

  /** Whether retrying the same request could succeed. */
  get retryable(): boolean {
    return (
      this.code === 'network' ||
      this.code === 'upstream' ||
      this.code === 'unavailable' ||
      this.code === 'rate_limited' ||
      this.status >= 500
    );
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException
    ? e.name === 'AbortError'
    : (e as { name?: string } | null)?.name === 'AbortError';
}

export interface RequestOptions {
  signal?: AbortSignal | undefined;
}

type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];
export type QueryParams = Record<string, QueryValue>;

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/** Base path of the API. `VITE_ATLAS_API` overrides it (for example an absolute origin). */
export const API_BASE: string = (env.VITE_ATLAS_API ?? '/api/v1').replace(/\/$/, '');

/** Serializes query params, skipping null/undefined/empty values; arrays become comma lists. */
export function buildQuery(params: QueryParams | undefined): string {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length > 0) q.set(k, v.join(','));
    } else {
      q.set(k, String(v));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Encodes one path segment (keys may contain `:` for outpoints and `[`/`]` for IPv6). */
export function seg(s: string | number): string {
  return encodeURIComponent(String(s));
}

export function apiUrl(path: string, params?: QueryParams): string {
  return `${API_BASE}${path}${buildQuery(params)}`;
}

function retryAfter(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const n = Number(h);
  return Number.isFinite(n) ? n : undefined;
}

async function toApiError(res: Response, url: string): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const err = (body as ApiErrorDto | undefined)?.error;
  if (err && typeof err.code === 'string') {
    return new ApiError(err.code, err.message || res.statusText, res.status, url, retryAfter(res));
  }
  return new ApiError('http', `${res.status} ${res.statusText}`.trim(), res.status, url, retryAfter(res));
}

async function send(url: string, accept: string, opts: RequestOptions): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept }, signal: opts.signal ?? null, credentials: 'same-origin' });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new ApiError('network', e instanceof Error ? e.message : 'network error', 0, url);
  }
  if (!res.ok) throw await toApiError(res, url);
  return res;
}

/** GET a JSON body from `/api/v1{path}`. */
export async function getJson<T>(path: string, params?: QueryParams, opts: RequestOptions = {}): Promise<T> {
  const url = apiUrl(path, params);
  const res = await send(url, 'application/json', opts);
  try {
    return (await res.json()) as T;
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new ApiError('parse', 'response was not valid JSON', res.status, url);
  }
}

/** GET a binary body from `/api/v1{path}`. */
export async function getBinary(
  path: string,
  params?: QueryParams,
  opts: RequestOptions = {},
): Promise<ArrayBuffer> {
  const url = apiUrl(path, params);
  const res = await send(url, 'application/octet-stream', opts);
  return res.arrayBuffer();
}

/** GET a JSON body from an absolute path outside `/api/v1` (ops endpoints). */
export async function getRootJson<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await send(path, 'application/json', opts);
  return (await res.json()) as T;
}
