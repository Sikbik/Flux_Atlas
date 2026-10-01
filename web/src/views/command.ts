// Command surfaces and delight (F2b): search results, terminal, ambient, settings, about. Every view is a
// lazy chunk (window bodies and page outlets already sit inside Suspense), so none of them weighs on the
// shell's first load.

import { lazy } from 'react';

export const SearchResultsView = lazy(() => import('../features/command/results/SearchResultsView'));
export const TerminalView = lazy(() => import('../features/command/terminal/TerminalView'));
export const SettingsView = lazy(() => import('../features/settings/SettingsView'));

export { AboutView, AmbientView } from '../app/placeholders/views';
