# Bundle Budget

Living document for ManaWG client-bundle performance budgets.
Run `pnpm --filter @manawg/web bundle:check` after every build to enforce.

## Current State (post 7-feature integration, 2026-05-24)

| Metric | Value | Budget | Status |
|---|---|---|---|
| Shared first-load JS (gzip) | 100.4 kB | 120 kB | OK |
| Largest route (einstellungen) | 48.4 kB | 50 kB | OK (tight) |
| Largest route (ausgaben) | 47.5 kB | 50 kB | OK (tight) |
| Tesseract OCR chunk | 15.6 kB raw | informational (warn > 2500 kB) | OK |

Numbers are gzip-compressed bytes, matching Next.js' build report.

## Top 5 Chunks (raw / parsed)

| Chunk | Parsed | Gzip | Notes |
|---|---|---|---|
| `04ba8493.*.js` (three.core) | 382 kB | 100 kB | Lazy — loaded only on `/` when `Hero3D` mounts |
| `166d7eef.*.js` (three.module) | 359 kB | 87 kB | Lazy — same dynamic split as above |
| `framework-*.js` (React/Next) | 190 kB | 59 kB | Unavoidable runtime |
| `3fe90418-*.js` (react-dom-client) | 173 kB | 54 kB | Unavoidable runtime |
| `1315-*.js` (next runtime) | 173 kB | 46 kB | Unavoidable runtime |

## Lazy-loaded Heavy Deps (excluded from per-route budget)

- **Tesseract.js OCR**: dynamic `import('tesseract.js')` in `src/lib/wg/ocr.ts`, only triggered when the user uploads a screenshot in the `/wg/[code]/import` wizard. The JS chunk is 16 kB; the ~2 MB WASM/training-data is fetched at runtime from the unpkg CDN by Tesseract itself.
- **Three.js + @react-three/fiber**: dynamic import of `Hero3D` in `src/app/page.tsx`, gated by `useShouldLoadHero3D()` (skips on slow networks / save-data). Total ~880 kB raw split across three async chunks, NEVER loaded on first paint.

## Analyzer Findings

Run `pnpm --filter @manawg/web analyze`. Reports land in `apps/web/.next/analyze/{client,nodejs,edge}.html`.

Verified absences (post-integration):
- No `pg` driver leak into client chunks (server-only)
- No `@neondatabase/serverless` in client chunks
- No `import * as` from lucide-react — per-icon imports tree-shake correctly (e.g. einstellungen pulls 9 icons totalling ~4 kB)
- No duplicate React DOM versions (exact devDependency pins force a single `@types/react`/`@types/react-dom` 19.x)
- Cloudinary not used — uploads go through `@aws-sdk/s3-request-presigner` (server) + native `fetch` (client)

## Budgets

Defined in `scripts/check-bundle-budget.mjs`:

| Constant | Value | Meaning |
|---|---|---|
| `SHARED_JS_BUDGET_KB` | 120 | Gzip cap for chunks loaded on EVERY page |
| `PER_ROUTE_BUDGET_KB` | 50 | Gzip cap per route-specific chunk |
| `TESSERACT_INFO_BUDGET_KB` | 2500 | Soft warn for the lazy OCR chunk |
| `LAZY_CHUNK_HINTS` | `tesseract`, `three`, `react-three` | Excluded from per-route caps |

## Bypass Decisions

Two patterns are deliberately excluded from per-route caps; they would otherwise inflate `/` and `/wg/[code]/import`:

- **Three.js (~880 kB raw)** — loaded only on the marketing/home page (`/`) behind a runtime gate. Excluding from per-route cap is correct: the chunk is never in critical path on PWA-installed sessions, and the gate skips it on slow connections.
- **Tesseract (~2 MB WASM)** — needed for receipt-screenshot OCR on `/wg/[code]/import`. Inlining would 10x the import-page bundle. The current dynamic-import + CDN-WASM strategy is the only sensible option.

If a future change adds a NEW heavy lazy dep, add its hint to `LAZY_CHUNK_HINTS` AND document the rationale here.

## CI Wiring

```
pnpm --filter @manawg/web build         # produces .next/app-build-manifest.json
pnpm --filter @manawg/web bundle:check  # fails build on budget overrun
```

The check is fast (< 1 s) and reads only filesystem artifacts. Wire it into CI immediately after `next build` to catch regressions before deploy.
