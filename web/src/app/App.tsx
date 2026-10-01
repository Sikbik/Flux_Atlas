// Providers: the error boundary, TanStack Query, the live runtime, the motion language and the router.

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { MotionRoot } from '../motion/react/MotionRoot';
import { RuntimeProvider } from './context';
import { AppErrorBoundary } from './errors';
import { createAtlasRouter } from './router';
import type { AtlasRuntime } from './runtime';

export function App({ runtime }: { runtime: AtlasRuntime }) {
  const [router] = useState(() => createAtlasRouter({ queryClient: runtime.queryClient, runtime }));
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={runtime.queryClient}>
        <RuntimeProvider runtime={runtime}>
          <MotionRoot>
            <RouterProvider router={router} />
          </MotionRoot>
        </RuntimeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
