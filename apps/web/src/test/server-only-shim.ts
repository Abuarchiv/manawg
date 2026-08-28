// Stub for the `server-only` marker package so vitest (jsdom) can resolve it.
// Next.js' bundler aliases `server-only` to an empty module at build time; we
// mirror that here. Aliased in vitest.config.ts.
export {};
