import type { AtlasState } from '../types';

const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? 15000);
// Use relative URL so it works in both dev and production (Docker)
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export const resolvedPollInterval = Number.isFinite(POLL_INTERVAL_MS) && POLL_INTERVAL_MS > 0 ? POLL_INTERVAL_MS : 15000;

export async function fetchAtlasState(signal?: AbortSignal): Promise<AtlasState> {
  const response = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/state', { signal });
  if (!response.ok) {
    throw new Error('Atlas API responded with status ' + response.status);
  }
  return (await response.json()) as AtlasState;
}

export const apiConfig = {
  baseUrl: API_BASE_URL,
};
