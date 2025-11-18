# Flux Atlas Backend

Node.js + TypeScript service responsible for crawling the Flux network, computing graph metrics/layouts, and serving the `/api/state` payload consumed by the React front end.

## Scripts

```bash
npm install
npm run dev       # start watcher on port 4000 (default)
npm run build     # compile to dist/
npm run start     # run compiled output
npm run typecheck # strict TS check without emit
```

Copy `.env.example` to `.env` and adjust any Flux-specific tuning.
