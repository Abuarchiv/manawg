# Brandbook implementation verification — 2026-09-12

## Current state — 2026-09-13

The mobile refinement supersedes the screenshots and UI-suite results below,
which document the earlier brand integration. The owner requested removal of
the old UI specifications during the redesign; API and model checks remain.
No replacement UI suite has been added. Latest validation: Node 22 production
build with type checking, focused lint, diff checks, and direct browser checks
at 414 × 896 CSS pixels. All 14 WG routes rendered without horizontal overflow;
expense, recurring-expense, inventory, chore and event forms were inspected.
An empty expense submission correctly marked invalid fields and focused the
description. Database-backed writes remain unverified in the local fixture preview.

Mobile controls and page composition were compacted across household, finance,
exchange and support pages. Header create actions use icons, the WG identity
header remains Start-only, and the Pinnwand/Chat switcher has been replaced by
one Chat header action. Empty states and redundant nested surfaces were reduced.

## Result

The supplied Brandbook v1.0 is integrated into the existing ManaWG web app. Tokens, local fonts, organism mark/loader, web/PWA assets, opaque navigation, shared controls, neutral avatars and financial presentation use the new design language. The source and conflict resolutions are linked from AGENTS.md.

## Verified gates

- Node 22.23.2 / pnpm 9.0.0.
- `pnpm --filter @manawg/web lint`: 448 files checked; all seven feature boundaries pass.
- `pnpm --filter @manawg/web typecheck`: pass.
- `openspec validate apply-brandbook --strict`: pass.
- `git diff --check`: pass.
- Production Next build and the final focused Playwright run: **8 passed, 10.1 seconds**, retries disabled. The run covers the Brandbook shell matrix, the full mobile-shell route sweep and 200% text across all 14 WG routes.
- Focused browser run against the running production preview at `127.0.0.1:3197`; fixture mode, database URLs empty, no production writes. Command: `pnpm --filter @manawg/web exec playwright test e2e/brandbook.spec.ts e2e/mobile-shell.spec.ts --config=/tmp/manawg-audit-playwright-3197.config.ts --retries=0`.
- Existing bundle-budget checker pointed at the isolated final build through a temporary copy (only build directory changed): shared first-load JS **102.0 kB gzip / 120 kB budget**, largest route **28.0 kB / 55 kB budget**; all budgets pass.
- Static PNG generator checked each output's dimensions and lack of alpha. Organism geometry and 512px icon visually compared with the supplied book.

## Browser evidence

Connected Chrome Extension on the local fixture app: navigation, light theme, expense draft open/close and actual amount font checked. Chrome `CSS.getPlatformFontsForNode` reported **JetBrains Mono / JetBrainsMono-Regular / isCustomFont=true** for the amount input. The completed screenshots below come from the final production-build tests.

| View | Evidence |
| --- | --- |
| Light, 320px | [Screenshot](evidence/start-light-320.png) |
| Light, 390px | [Screenshot](evidence/start-light-390.png) |
| Dark, 390px | [Screenshot](evidence/start-dark-390.png) |
| Wide viewport | [Screenshot](evidence/start-light-1440.png) |
| 200% text, dark | [Screenshot](evidence/start-dark-text-200.png) |
| Amount form, reduced motion | [Screenshot](evidence/expense-form.png) |

At 200% text the existing mobile interface grows and navigation labels wrap; the checks verify visible navigation within the viewport and that the last activity is fully reachable above the measured navigation at the page end, not a complete WCAG audit. Tests preserve navigation to household, finance, exchange and settings, repeat-save protection, error/retry feedback, financial calculation consistency and offline safeguards.

## Independent review and repairs

The independent reviewer checked the source contract and integrated diff. Repairs covered satellite convergence in the loader, fallback favicon metadata, form-font cascade, unchecked dark-switch contrast and bottom-navigation clearance, including dynamically measured height for wrapped labels at 200% text. Local runtime checks found and corrected the pre-existing overlapping two-row settings tabs. The initial additional font-loading assertion accidentally included the unloaded fallback family; it was narrowed to the actual custom family and passes.

## Boundaries

No deployment or commit was performed. This is a local web-app result, not native iOS/Android packaging or live-account verification. Fixture-only requests outside the mocked surface can report missing database configuration; S3 uploads and rate limiting also require environment configuration. No claims are made about production data, push delivery, payment flows, or image-upload service health. The standalone marketing project was unchanged. The app now uses the Brandbook's responsive desktop canvas while retaining the compact mobile hierarchy on phones.

## UI audit follow-up

The responsive audit found and corrected three product-level issues: the desktop shell was still capped at a phone width, local navigation repeated the active page, and Chat combined the global shell with a second full-width chat shell. Page containers now use consistent 3xl/4xl reading widths, the desktop canvas caps at 1240px, bottom navigation stays compact, and Chat keeps one header with no duplicate local switcher plus a max-width message/input column. Chat height and mention suggestions also follow the measured navigation/input width when text wraps or the viewport changes. The shared shell regression matrix covers 320/390/430/1280px.

The final production preview passed all five brandbook shell tests, the 200% text route matrix and both mobile-shell tests. Lint, typecheck, production build, bundle budget, OpenSpec validation and `git diff --check` were also green after the audit changes.

The app shell now intentionally renders the WG identity header only on Start. Subpages keep their own title and local/back navigation, so the WG name strip is not repeated above Einkauf, Finanzen, Austausch, Chat or Einstellungen.

Both Company and app code graphs were refreshed with `graphify update .` (AST-only). SQL extraction reports its existing missing tree-sitter SQL dependency; no SQL was changed.
