import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAtlasState } from '../api/atlas';
import type { AtlasState } from '../types';

interface AtlasStateHook {
  atlasState: AtlasState | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

export function useAtlasState(): AtlasStateHook {
  const [atlasState, setAtlasState] = useState<AtlasState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    try {
      const state = await fetchAtlasState(controller.signal);
      setAtlasState(state);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    // Auto-refresh disabled
    // const interval = setInterval(() => {
    //   load();
    // }, resolvedPollInterval);

    return () => {
      // clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [load]);

  return {
    atlasState,
    isLoading,
    error,
    lastUpdated,
    refresh: load,
  };
}
