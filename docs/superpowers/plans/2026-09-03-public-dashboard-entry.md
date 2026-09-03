# Public Dashboard Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users explore the app before login and use a contextual dashboard block to create or join a WG.

**Architecture:** Public root and allowlisted module routes show honest empty states using existing display/navigation primitives. Creation/joining continue through the existing Supabase-gated flow; member dashboards show the shared welcome block and no public creation prompt.

**Tech Stack:** Next.js 15, React 19, TypeScript, existing Tailwind tokens, Supabase SSR, Playwright; Node 22 and pnpm 9.

**Spec:** /Users/abu/Company/manawg-app/openspec/changes/public-dashboard-entry/specs/public-dashboard-entry/spec.md

## Global Constraints

- Work only in `/private/tmp/manawg-login-fix-2wRZO2`; preserve the saved main checkout's unrelated changes.
- Reuse existing dependencies, navigation labels, theme tokens, mobile frame, and small UI components. No new dependencies, fake WG identities, or runtime test fixtures.
- No local PostgreSQL. Browser release proof requires an explicitly authorized hosted deployment backed by Supabase; typecheck/lint/build are source checks, not live proof.
- Do not deploy, commit, push, mutate production data, activate providers, send SMS/email, or spend money. Controller handles authority and integration.
- Public exploration cannot expose private WG data. Authentication alone never creates a WG or membership. Never use local identity/history to decide account access.
- This slice is the approved dashboard entry. Complete legacy identity migration and email/phone activation are not completed by this patch and must not be reported as completed.
- Use `apply_patch` for edits. No subagents from workers.

### Task 1: Public entry, contextual welcome, and action continuity

**Files:**
- Modify `apps/web/src/app/EntryClient.tsx` and `apps/web/src/app/page.tsx` for the public root.
- Create `apps/web/src/components/entry/PublicApp.tsx` for guest shell/module empty states and account membership states.
- Create `apps/web/src/components/entry/WgWelcome.tsx` for the three explicit CTA/member variants.
- Create `apps/web/src/app/entdecken/[module]/page.tsx` with a fixed allowlist of actual app sections.
- Modify `apps/web/src/app/neu/NeuClient.tsx` for explicit login/join actions and a return-to-exploration link, preserving callback errors and safe next paths.
- Modify `apps/web/src/app/wg/[code]/page.tsx` to place member welcome below its header and before statistics, replacing the old conditional welcome block.
- Modify `apps/web/public/sw.js` to prevent private HTML and account-specific cache reuse while keeping the public offline shell.
- Modify `apps/web/src/components/wg/NavItem.tsx` only to make active-path matching ignore invitation query/hash while preserving the complete link destination.
- Modify `apps/web/src/core/auth/server.ts` and `apps/web/src/app/wg/[code]/layout.tsx` only if needed to enforce membership before server roster/metadata reads; reuse the existing guard/query seam.
- Add `apps/web/e2e/public-entry-live.spec.ts`; update only conflicting entry assertions in `apps/web/e2e/social-login-live.spec.ts`.

**Interfaces:**
- Consume `/api/wg/mine`: 401 signed out, 200 `{wgs: [{id, code, name}]}` account memberships, all other/malformed responses explicit error with retry.
- Consume `/neu?action=create` for explicit creation; `/neu` for explicit sign-in; validated invitation `code` plus explicit auth action for join continuation. Never redirect away from a pending invitation into an unrelated existing WG.
- Produce public root and `/entdecken/<module>` routes with native links, working reload/back behavior, no private API calls while signed out, and only explicit create/join actions entering auth.
- `WgWelcome` consumes a discriminated variant: create, invitation, or member. Create label is `WG erstellen`; invitation is `Dieser WG beitreten`; member heading is `Willkommen in deiner WG` plus the real WG name. Primary button full width on mobile.
- Guest navigation mirrors Start, Ausgaben, Einkauf, Pinnwand, Putzen and existing child areas (Fixkosten, Mahnungen, Vorräte, Kalender, Aktivität, Chat, Einstellungen). Unsupported routes return 404. Reuse NavItem/Panel/ModuleCard when their contracts fit; no alternative marketing page.

- [ ] **Step 1: Add the failing browser regression before runtime edits.** The bug it catches is the unconditional root redirect to authentication. Extend with navigation/reload, create intent, invitation intent, forged local-history isolation, and private deep-link protection.

```ts
test('visitors can explore before choosing to create a WG', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(new URL('/', process.env.BASE_URL).href);
  await expect(page.getByRole('link', { name: 'WG erstellen', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Ausgaben', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ausgaben', exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Record RED on the current hosted baseline.** Run from `apps/web`: `PATH=/opt/homebrew/opt/node@22/bin:$PATH BASE_URL=https://app.manawg.com PUBLIC_ENTRY_E2E=true pnpm exec playwright test e2e/public-entry-live.spec.ts --grep 'visitors can explore' --project=chromium --reporter=line --workers=1`. No credentials, account creation, private member IDs, or network mocks. Failure must be the missing public entry, not a setup error.
- [ ] **Step 3: Implement the listed behavior.** Show guest create CTA without a login wall. Distinguish pending/signed-out/authenticated-empty/member-list/error. Preserve invite parameters through exploration and login. One existing membership can open directly, multiple get a chooser. Ensure new invite context wins over pre-existing membership auto-redirect. No use of local identity/history. Reuse the shared member welcome above statistics. In the service worker cache only explicit public offline paths and safe static assets; evict old `manawg-app-` caches without deleting unrelated cache names.

```tsx
<WgWelcome variant="member" wgName={wg.name} />
```

- [ ] **Step 4: Run source checks.** Use Node 22. Run scoped Biome, `pnpm --filter @manawg/web typecheck`, `pnpm --filter @manawg/web build`, and `git diff --check`. Do not start any local PostgreSQL or report source checks as E2E. If preview is not yet supplied, leave GREEN explicitly pending for Task 2.
- [ ] **Step 5: Self-review and write the report, no commit.** Include changed paths, exact RED/source commands/results, known limitations, and unrun browser checks. Controller creates the diff package and dispatches Terra for spec and quality review.

### Task 2: Hosted browser verification and independent review

**Files:** Read Task 1's diff and test files; change only tests/evidence if a specific gap requires it. Runtime fixes go back to the original implementer.

**Interfaces:** Consume the exact authorized preview URL and its hosted Supabase configuration supplied by the controller. No guessing deployments or bypass credentials.

- [ ] **Step 1: Run the same regression suite on the authorized preview.** Set `BASE_URL` to the supplied HTTPS origin and `PUBLIC_ENTRY_E2E=true`; use existing preview protection handling when needed.
- [ ] **Step 2: Inspect real browser UI at phone and desktop widths.** Guest root, every navigation group, explicit create/login, invitation preservation, cancel/back, and overflow. With an authorized existing test session verify authenticated no-WG, member welcome and membership chooser; do not create accounts/data without authority.
- [ ] **Step 3: Terra review.** Read diff plus report; report spec compliance and code quality separately, with file/line evidence. Named risks: invite loss/loops, accidental anonymous/private requests, SSR membership leaks, stale cache/account state, dead navigation.
- [ ] **Step 4: Close exact findings and report scope.** Update OpenSpec tasks only for verified complete behavior; never mark unrun authenticated/hosted scenarios passed. Controller runs Graphify update for changed code and keeps production unmodified unless separately authorized.
