# Social login repair implementation plan

> For agentic workers: execute the scoped tasks below and independently review the final diff.

**Goal:** Restore the agreed social-only login on the canonical production app.

**Architecture:** Supabase is the only authentication authority. Middleware protects WG pages, the entry screen resolves account membership from the API, and invitation codes identify a WG only after sign-in. Existing signed local tokens may be used only to link an old membership to an authenticated account.

**Tech stack:** Next.js 15, Supabase SSR, PostgreSQL on hosted Supabase, Playwright, Node 22.

**Spec:** User's agreed social-only authentication, corrected on 2026-09-03; acceptance criteria below.

## Acceptance criteria

- Signed-out entry and deep links show only social sign-in, with no name/code/profile login.
- Browser-local recently visited WGs never authenticate or choose the entry destination.
- The production browser bundle reaches Supabase Auth using its configured public environment.
- A disabled provider leaves a readable error in the app; callback failures retain the intended local destination and show an error.
- Authenticated accounts recover memberships from the database. Legacy membership linking still requires both social authentication and the old signed token.
- Publish the reviewed commit from main to app.manawg.com; repair manawg.com entry links separately.
- Provider credentials and callback allowlist must be configured before claiming a successful login. A real provider-to-app session round-trip is the final acceptance check.

## Tasks

- [x] Run `AUTH_LIVE_E2E=true BASE_URL=https://app.manawg.com pnpm --filter @manawg/web exec playwright test social-login-live.spec.ts --retries=0` against the broken production build and record failures (all six tests failed on the old deployment).
- [x] Fix `core/auth/env.ts` to use direct `process.env.NEXT_PUBLIC_*` reads; preserve shared server/client validation.
- [x] Fix OAuth startup and callback errors in `core/auth/client.ts`, `SocialLoginButtons.tsx`, and `app/auth/callback/route.ts`.
- [x] Protect `/wg/*` in the existing auth middleware, preserving session cookies and return paths.
- [x] Change `EntryClient.tsx`, `NeuClient.tsx`, and `IdentityPicker.tsx` to make social authentication precede onboarding and remove roster-based login.
- [x] Independently review cookie propagation, redirects, account linking, and signed-out data access with Terra High. A PKCE cleanup finding was fixed; second review approved the merge.
- [ ] Run Node 22 lint, typecheck, build, and the relevant Playwright gates. Repeat the live tests on the deployed commit and perform a real-browser provider/session check.

## Initial evidence

- Current app main is `47a60ba`, already contains `codex/social-auth`, and is deployed to app.manawg.com.
- Installed Chrome reproduces all three social buttons failing in place without an Auth request.
- Production Supabase rejects Google, Apple, and Facebook with HTTP 400 `provider is not enabled`; Google client ID and secret are empty.
- Supabase Site URL is localhost and the redirect allowlist is empty.
- manawg.com runs an older landing deployment with anonymous-login copy and a broken entry link.

## Verification before deployment

- Node 22: web typecheck, full web lint (377 files plus feature boundaries), and production build passed. No database instance was started or used for these compilation checks.
- The read-only Playwright regression suite targets the real production HTTPS origin, without API mocks. It checks the signed-out entry, old-browser-storage behavior, protected deep links, hosted Supabase settings response, and safe callback errors. It is not proof of a successful provider login.
- Supabase Site URL and callback allowlist were corrected to `https://app.manawg.com`. Google, Apple, and Facebook remain disabled without their provider credentials.
- Landing Vercel settings were corrected from obsolete `apps/landing` monorepo paths to the standalone repository root, `pnpm build`, and `pnpm install --frozen-lockfile`.
- An additional live regression reproduced missing PKCE cookie cleanup on the old production callback. The callback now forwards `sb_flow_id` to the SDK and retains cookie/header mutations on error redirects. The suite now contains seven checks.
