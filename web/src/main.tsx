import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/global.css';
import { App } from './app/App';
import { createRuntime } from './app/runtime';
import { installStaleBuildRecovery } from './app/staleBuild';

// A chunk from an earlier release that is gone from the server reloads the page once (staleBuild.ts).
installStaleBuildRecovery();

// The live runtime starts before React renders: the snapshot fetch and the WebSocket connect run in
// parallel with the first paint.
const runtime = createRuntime();
runtime.start();

// Exposed for debugging and end-to-end tests (read-only use).
(globalThis as { __atlas?: typeof runtime }).__atlas = runtime;

const el = document.getElementById('root');
if (!el) throw new Error('missing #root');
createRoot(el).render(
  <StrictMode>
    <App runtime={runtime} />
  </StrictMode>,
);
