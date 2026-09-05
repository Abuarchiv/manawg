# Public entry visual polish implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review the bounded public-entry slice below.

**Goal:** Make the public ManaWG app welcoming, compact, and understandable through representative example content, without changing private WG behavior.

**Architecture:** Keep the existing public routes, membership lookup and invitation/auth contracts. Compose existing shadcn primitives into a public-only visual scope, share static illustrative previews where useful, and simplify authentication presentation without changing authentication logic.

**Tech Stack:** Existing Next.js 15, React 19, Tailwind 4, shadcn Nova, Inter and Lucide. No new dependencies.

**Spec:** User-approved design in this conversation, captured as the acceptance criteria below; extends `openspec/changes/redesign-mobile-app-with-shadcn` for the public entry only.

## Global constraints and acceptance criteria

- Work only in `/Users/abu/Company/manawg-app-mobile-redesign`, baseline `a8016bc`. Preserve unrelated work. No merge, push, deployment, production mutation, credential changes, or new dependencies.
- Preserve the existing 480px centered app frame, four bottom destinations, route URLs, invitation code validation/propagation, membership redirect, multi-WG selection, create intent, auth choices, error handling and privacy link.
- Warm, quiet, app-native appearance: one restrained petrol accent scoped to public/auth surfaces; clean light and dark surfaces, consistent radii, clear type hierarchy. Existing components/fonts/icons remain the basis. This user-approved scope supersedes the earlier neutral-only appearance requirement for public/auth surfaces only.
- Start: recognizable logo and quiet sign-in access; one headline `Euer WG-Alltag. Gemeinsam geregelt.`; one concise description; dominant create or invitation action; four compact content-led previews for Einkauf, Ausgaben, Putzen, Pinnwand; no public catalog of settings/reminders/activity. No duplicate welcome headline or repeated authentication cards.
- Module routes: show clearly labeled fictional `Beispiel-WG` content for the active module rather than `Noch keine WG verbunden`. Each existing discover route must remain useful, including secondary deep links. Do not show private data or pretend fictional data is real; no backend demo system or fake write actions. No fabricated testimonials, metrics or privacy claims.
- Retain existing navigation category grouping. Remove repeated `Weitere Bereiche` lists from public pages. Only real navigation/actions are interactive. Example records are read-only with accessible semantics.
- Authentication: reduce repetitive headings and framing, keep Google/email/SMS and recovery/create functions, visible labels and all errors; treat create-account as visually secondary where compatible with component reuse.
- Real lookup failures remain visible with retry; make their public placement proportionate, never treat failure as signed out or weaken auth.
- Light and dark layouts work at 320, 390 and 430 CSS pixels and in the centered desktop frame; no horizontal overflow, clipped actions or bottom-nav overlap. Touch targets at least 44px for primary controls, inputs 16px, readable contrast and keyboard focus. Respect reduced motion; no decorative animation required.
- Use only connected Chrome Extension through CUA for browser verification. Do not launch Playwright browsers, DevTools MCP or alternate browser profiles. Existing non-browser checks and API-only Playwright tests are allowed. Add/update focused runnable regression coverage where existing tests assert changed public copy or contracts; report what was and was not executed.

## Task 1: Public entry and auth visual slice

**Files:** `apps/web/src/components/entry/PublicApp.tsx`, `WgWelcome.tsx`, `EntryFrame.tsx`; relevant presentation in `apps/web/src/app/neu/NeuClient.tsx` and `apps/web/src/components/auth`; a small public preview component and scoped stylesheet if needed; narrowly related E2E expectations; existing OpenSpec artifacts.

**Interfaces:** Retain `PublicApp({ activeModule?: string })`, invitation URLs and existing auth component contracts. Keep existing `WgWelcome` variants usable by other callers. Read all callers before changing shared props/styles.

- [x] Inspect source and caller graph before edits; identify styles that can remain scoped to public/auth wrappers. Read the existing tests and relevant skills; keep one implementer owning source files.
- [x] Compose start and module previews from static, explicitly labeled data; preserve state branches. Use short German examples (shopping item/quantity, attributed expense with a coherent split, assigned chore, authored notice). Secondary route previews should explain their own feature.
- [x] Apply scoped petrol tokens and surface treatment, improve visible logo treatment without replacing brand assets, and simplify auth presentation. Keep private WG screens unaffected.
- [x] Update focused regression assertions for public preview visibility, removed catalog, invitation retention, error/retry and layout. Reuse existing Playwright test structure; no new framework.
- [x] Run Node-22 lint, typecheck, production build and suitable non-browser checks; record exact commands/results and pre-existing failures. Do not print environment secrets.
- [x] Update OpenSpec proposal/design/tasks with this authorized public-only follow-up and truthful validation state. Do not claim browser checks the controller has not completed.
- [x] Self-review, commit only this slice locally, and write a concise implementation report with commit, changed files, checks, and any unresolved concerns.

## Task 2: Controller acceptance and independent review

- [x] Inspect start, all representative public previews, invitation and auth screens in connected Chrome; check mobile widths, light/dark and keyboard behavior through supported browser APIs.
- [x] Obtain independent spec/code review of the bounded diff; send concrete findings back to the same implementer for fixes.
- [x] Confirm applicable checks, refresh the Company Graphify graph after source changes, record final validation and present the verified preview. Keep deployment separate.


## Final acceptance — 2026-09-05

Implementation commit: `a364104` (`feat: polish public entry previews`). Bruna used gpt-5.6-luna xhigh; independent read-only review used gpt-5.6-terra xhigh and passed with no actionable findings. The controller performed the following checks in the connected Chrome Extension on `localhost:3101`.

- All eleven discover routes render explicitly fictional content and no longer show the disconnected-WG empty state.
- 24 root/discover layout checks at 320 and 430 CSS pixels found no horizontal overflow; representative 390px and desktop 480px-frame checks passed. At 320px the example cards use one column. Light and dark views were inspected.
- Invitation `ABCD2345` survived public entry, Haushalt navigation, the preview return link, and the join action into `/neu?code=ABCD2345`. No invitation was submitted.
- The create action reaches `/neu?action=create`. Email/password controls have 16px text and 44px height; the SMS tab exposes its phone field. No authentication or SMS request was submitted.
- Keyboard navigation reaches the visible skip link. Main CTA contrast measured 9.89:1 in light mode and 8.16:1 in dark mode.
- The original viewport and system-theme behavior were restored; the final public preview remains open in Chrome.
- Node 22.23.2 root/web lint, feature boundaries, typecheck, isolated production build, analytics privacy check, OpenSpec validation, and diff whitespace checks passed.
- The unchanged bundle-budget checker passed against the isolated final production build via a temporary `.next` symlink: shared first-load gzip 101.5 kB / 120 kB; all route budgets passed. The initial check against the active development `.next` directory was not production evidence.
- Focused Playwright browser assertions were updated and independently reviewed, but the Playwright browser runner was not executed because browser verification is restricted to the connected Chrome Extension. Older full-suite results in the parent OpenSpec task file belong to the preceding redesign baseline.
- `graphify update .` completed for the worktree and Company graph. The Company scan reports optional SQL parser absence and an unrelated existing syntax error in the social-auth checkout; no unrelated files were repaired.

Remaining external limitation: an anonymous final GET `/api/wg/mine` still returned HTTP 500, matching the pre-change baseline. Its visible retry/error state is preserved; successful hosted authentication and real WG data were not claimed. No push, merge or deployment was performed.
