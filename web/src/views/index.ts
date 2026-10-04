// The view registry. The route tree and windowContent.tsx import every view from here. Each feature
// team owns exactly one barrel below and swaps its placeholders for real views there (React.lazy for
// heavy views; window bodies and page outlets sit inside Suspense), so parallel feature work never
// edits the route tree or the window registry.

export * from './command';
export * from './explorer';
export * from './frame';
export * from './inspect';
export * from './wallet';
