import { Agent, Dispatcher } from 'undici';
import { config } from '../config/env.js';

const tlsAgent = new Agent({
  connect: {
    rejectUnauthorized: !config.allowInsecureSSL
  }
});

type HttpMethod = 'GET' | 'POST';

interface FetchOptions {
  method?: HttpMethod;
  timeoutMs?: number;
  dispatcher?: Dispatcher;
  headers?: Record<string, string>;
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', timeoutMs = config.rpcTimeout, headers = {}, dispatcher } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
      dispatcher: dispatcher ?? tlsAgent
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Request failed with status ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { method = 'GET', timeoutMs = config.rpcTimeout, headers = {}, dispatcher } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
      dispatcher: dispatcher ?? tlsAgent
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Request failed with status ${response.status}: ${text}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export const httpDispatcher: Dispatcher = tlsAgent;
