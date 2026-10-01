// Error surfaces: a React error boundary around the whole app (a crash never takes the live globe
// down with a white page), the router's per-route error view, and the 404 view. Copy says what
// happened and what to do.

import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isApiError } from '../api/http';
import { isChunkLoadError, isReloadingForUpdate } from './staleBuild';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Flux Atlas crashed', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <h1>Flux Atlas stopped</h1>
        <p>Something in the interface failed: {this.state.error.message}</p>
        <button type="button" className="button" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  // A view whose code belongs to an earlier release (staleBuild.ts): a reload is on its way, or is the fix.
  if (isReloadingForUpdate() || isChunkLoadError(error))
    return <StaleBuild reloading={isReloadingForUpdate()} />;
  const api = isApiError(error) ? error : null;
  const title =
    api?.code === 'not_found'
      ? 'Not found'
      : api?.code === 'network'
        ? 'The server could not be reached'
        : api
          ? 'The server returned an error'
          : 'This view failed';
  return (
    <section className="panel" role="alert" data-window="error">
      <header className="panel-head">
        <h1 className="panel-title">{title}</h1>
        {api ? <span className="panel-kind mono">{api.code}</span> : null}
      </header>
      <div className="panel-body">
        <p>{error instanceof Error ? error.message : String(error)}</p>
        <button
          type="button"
          className="button"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          Retry
        </button>
      </div>
    </section>
  );
}

function StaleBuild({ reloading }: { reloading: boolean }) {
  return (
    <section className="panel" role="status" data-window="error">
      <header className="panel-head">
        <h1 className="panel-title">{reloading ? 'Loading the new version' : 'Flux Atlas was updated'}</h1>
      </header>
      <div className="panel-body">
        <p>
          {reloading
            ? 'A new release of Flux Atlas is out. Fetching it now.'
            : 'This view belongs to an earlier release. Reload to get the current one.'}
        </p>
        {reloading ? null : (
          <button type="button" className="button" onClick={() => location.reload()}>
            Reload
          </button>
        )}
      </div>
    </section>
  );
}

export function NotFound() {
  return (
    <section className="panel" data-window="not-found">
      <header className="panel-head">
        <h1 className="panel-title">No such page</h1>
      </header>
      <div className="panel-body">
        <p>This address does not match any view.</p>
        <Link to="/" className="link">
          Back to the globe
        </Link>
      </div>
    </section>
  );
}
