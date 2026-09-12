# ManaWG Product Experience and Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ManaWG understandable and useful throughout a resident's everyday workflow: recognize what needs attention, take the right action, understand its effect on the household, and recover from mistakes. Validate the product experience before using technical readiness as a release decision.

**Scope correction (2026-09-04):** The user has clarified that the core use case is settled. The main unfinished work is product coherence, UI hierarchy, intuitive interactions, small everyday details, and transitions between modules. The technical release audit below remains relevant later; it is not the main product plan and must not crowd out this work.

**Implementation update (2026-09-05):** The isolated branch `codex/product-experience-20260904` now contains the implemented local UX/backend/workflow changes. Final built fixture result: 247 passed, 20 intentional hosted skips, 0 failed; production build and unchanged bundle budgets passed. See the [implementation and evidence record](../../releases/product-experience-implementation.md) for exact scope, decisions and open gates. The resident study and external production checks below remain open; local source approval does not close them.

**Primary product specification:** [App user experience](../specs/2026-09-04-app-user-experience.md). Its recommendations are a concrete design proposal, not evidence that users have already understood or accepted the design.

## Product experience comes first

For every important screen, make five answers visible: Where am I? What matters now? What can I do? What will that change, and for whom? How can I return or correct a mistake? A page that renders and saves successfully can still fail this standard.

### UX0: Agree on the interaction rules

**Owner:** Product/design owner. **Deliverable:** the linked UX specification, resolved terminology, and one coherent journey per scenario. **Dependency:** current app inspection, already started in this audit.

- [ ] Walk through guest exploration, invited resident, new-WG creator, returning resident, and account/WG switching. Specify the first useful result and the next action for each; retain the established household use case.
- [ ] Settle the meaning of bought, paid, expense recorded, balance, completed chore, shared notice, invitation sent, logout, and WG leave. Specify who sees each action and when; do not promise a delivered notification when only a share sheet or database write succeeded.
- [ ] Treat the shopping-to-expense transition, chore completion/rotation, and manual settlement versus actual payment as complete user journeys. Resolve misleading promises before changing visual details.
- [ ] Acceptance: each scenario has a beginning, an explicit action, an understandable result, and a recovery path. No money/account action relies on a status word or unexplained icon alone.

### UX1: Specify and review the screens in context

**Owner:** Product/design owner. **Deliverable:** linked screen contracts plus low-fidelity screen/state sketches, reviewed as sequences rather than isolated polished screenshots. **Dependency:** UX0.

- [ ] Review guest entry → sign-in/invite → first WG screen; dashboard → everyday action → result; shopping → expense draft → split summary; chore → completion → next responsibility; balance → explicit settlement confirmation → result.
- [ ] Specify initial, empty, populated, loading, pending, success, failed, offline-pending, permission-denied, and long-content states. Define back/cancel, preserved input, focus/keyboard behavior, and exact German action/result wording.
- [ ] Keep the existing five tabs as the starting structure. Make child-page parentage and account/WG context clear; change navigation only for an observed findability problem, not for visual novelty.
- [ ] Acceptance: another reviewer can follow each sequence and explain the consequences without implementation details or a verbal tour. The everyday action stays prominent on a narrow screen with the keyboard open.

### UX2: Improve one complete everyday flow at a time

**Owner:** Owning module engineer plus design reviewer. **Deliverable:** a working vertical flow with focused Playwright regression and visual verification. **Dependency:** UX1 for that flow; technical prerequisites only where needed.

| Order | Slice | Observable outcome |
| --- | --- | --- |
| 1 | Entry, invitation, and first-use dashboard | A new resident reaches their intended WG; a creator sees how to invite others and start using the app; a returning resident sees what matters today. |
| 2 | Expense entry, balance, and settlement | Payer, beneficiaries, each share, and result are understandable before saving. Recording an external payment is visibly distinct from transferring money. |
| 3 | Shopping and handoff to expenses | Adding/checking an item is fast; who added/bought it is clear; recording its cost is explicit and preserves useful context without inventing a price. |
| 4 | Chores and responsibility | Who acts, by when, and what completion changes are apparent. Rotation/absence behavior is explainable and correcting a mistake has a defined route. |
| 5 | Shared information, calendar, and account context | People can distinguish a persistent notice, a chat message, and an event; personal preferences, WG administration, logout, and leaving have clear scope. |

- [ ] Carry the state/feedback rules across each slice using existing components. Reuse good existing empty states and templates; avoid adding tutorials to compensate for unclear controls.
- [ ] Acceptance: completing a slice improves the whole path, including its next screen and failure recovery. Do not label source/fixture success as usability validation.

### UX3: Observe people using the proposed experience

**Owner:** Product/design owner with a facilitator. **Deliverable:** a short observation record using the scenario protocol in the UX specification. **Dependency:** UX1 for prototype testing; UX2 for final behavior testing.

- [ ] Run an initial round with five varied WG residents, including someone invited into a WG and someone who normally organizes it. Give a real task, not click-by-click directions; use disposable data and no real payments.
- [ ] Record success without help, misunderstood labels/outcomes, hesitation, wrong turns, recovery, and whether the person can explain who owes whom and what was actually saved/shared.
- [ ] Use the specification's proposed thresholds as a working acceptance bar. Fix repeated confusion and every serious money/privacy misunderstanding, then retest the affected journey. Five participants provide directional findings, not a population satisfaction estimate.
- [ ] Acceptance: tested users independently complete the agreed key tasks and can explain their outcomes; unresolved severe confusion prevents a product sign-off even when all technical tests pass.

### UX4: Hand the coherent product into the release track

- [ ] Product owner records the tested journeys, design decisions, remaining minor usability issues, and accepted tradeoffs. The app's key scenarios and error recovery must work without the creator explaining them.
- [ ] Only then use the technical tasks below for deployment readiness. Authentication, authorization, data integrity, and recovery remain mandatory; optional feature deferrals require a separate explicit product decision.

**Architecture:** Keep the existing Next.js app, Supabase Auth/PostgreSQL/RLS, Vercel deployment, Playwright E2E runner, existing notification/payment/calendar/storage integrations, and manual production migration workflow. Close evidence gaps at the existing seams; do not add a framework, replace the data model, or rewrite the product.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase SSR/PostgreSQL, Vercel, Playwright, Node 22 (`v22.23.2`), pnpm 9-compatible lockfile, existing web push/PayPal/calendar/storage providers.

**Spec:** `openspec/config.yaml`, `openspec/changes/add-supabase-credential-auth/`, `openspec/changes/establish-playwright-verification/`, `openspec/changes/public-dashboard-entry/`, `docs/database-recovery.md`, and this verified release baseline.

## Global Constraints

- Work only in `/Users/abu/Company/manawg-app`; this plan does not authorize deployment, production data changes, provider mutations, messages, payments, or secret disclosure.
- All repository artifacts remain in English; preserve existing German product copy unless the task explicitly changes a user-facing string.
- Start implementation from the verified `origin/main` candidate in an isolated worktree, then carry these planning changes forward deliberately. The inspected local checkout is nine commits behind; preserve it and its documentation changes. Never mix its local test result with the newer candidate's result.
- Use Node 22 explicitly: `PATH=/opt/homebrew/opt/node@22/bin:$PATH /opt/homebrew/bin/pnpm ...`; do not use Node 26/default pnpm or Corepack.
- Reuse and extend existing Playwright helpers/specs and isolated test-data patterns. Do not add Vitest, Cypress, a second browser runner, or a new orchestration service.
- Treat fixture, source, CI, Preview, production, and installed-device evidence as separate claims; a passing source or Vercel check never substitutes for a hosted flow.
- Every advertised SMS, payment, calendar, push, storage, import, and export feature needs a real applicable gate or an explicit product-owner deferral/hide decision; no silent deferral.
- Do not expose private WG HTML, API responses, service-worker caches, offline drafts, or attachments to signed-out/non-member users.
- Keep the existing security strengths: route guards, active member binding, signed legacy proof plus Supabase session, origin checks, fail-closed production rate limiting, protected cron/uploads, RLS migration and verifier.
- Follow the [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist), [Playwright test CLI selection rules](https://playwright.dev/docs/test-cli), and [Supabase production guidance](https://supabase.com/docs/guides/deployment/going-into-prod) as verification references.

## Baseline: current proof and missing proof

The local checkout was clean `main` at `2c7fc58` on 2026-09-04. `origin/main` was fetched and is `8f845cd4efa1d7241d33a3997991a9c9c651ac22`; no branch switch or pull is part of this plan. The release owner must pin the final candidate SHA after the work below and repeat every exact-SHA gate.

Current proof:

- [Remote CI run `33873459830`](https://github.com/Abuarchiv/manawg-app/actions/runs/33873459830) validate passed: lint, analytics check, feature-boundary check, typecheck, build, and bundle check.
- The same remote run fixture lane passed. Its command is the repository's `test:e2e:fixtures` lane.
- The same remote run's `db-supabase-preview` failed before migration/check because protected `SUPABASE_PREVIEW_DATABASE_MIGRATION_URL` was empty/withheld.
- `e2e-preview` did not produce proof. It requires a successful trusted Vercel Preview deployment-status event for `main`, exact SHA, protected Preview credentials, and bypass secret.
- Local Node 22 lint/typecheck passed. The local fixture run on old HEAD passed `203`, skipped `20`, failed `0` in `2.9m`; the isolated fixture build also passed. Evidence log: `/tmp/manawg-release-audit-fixtures-20260904-direct.log`.
- Vercel status for the same SHA was successful, but it is deployment status only, not application release evidence. [Deployment-status run `33873583236`](https://github.com/Abuarchiv/manawg-app/actions/runs/33873583236) was skipped.
- Terra's read-only security review found the route guards, member binding, legacy proof, origin/rate-limit/cron/upload controls, RLS migration for 26 tables, verifier, historical ledger rejection test, and analytics allowlist scanner in place. Do not redo these fixed items; rerun their existing checks on the final SHA.
- Live Chrome extension inspection was read-only in an existing signed-in session. The app redirected to that user's real WG; no fresh login, leave action, mutation, health endpoint proof, or provider round-trip was performed.
- Live Putzplan at `390x844` fit cleanly and had a clear primary action. Preserve the five-tab navigation and visible user data; do not make a broad redesign.
- Dashboard empty stats/chart and duplicated WG-name welcome are usable gaps: add a useful next action/invite/first-task path without inventing or deleting data.
- Ausgaben and Putzen empty states, templates, and forms opened without saving; this is UI evidence only.

Missing or blocking proof:

- Protected Preview direct database secret and a successful `db:migrate` plus `db:check` for the exact candidate SHA.
- A complete trusted Preview event path and the configured authenticated Preview Playwright pack; current CI intentionally excludes `supabase-auth-live.spec.ts` pending `SUPABASE_AUTH_TEST_EMAIL`, `SUPABASE_AUTH_TEST_PASSWORD`, `SUPABASE_AUTH_TEST_MEMBER_WG_CODE`, and `SUPABASE_AUTH_TEST_MEMBER_NAME`.
- Credential auth: sign-up, confirmation, sign-in, wrong credentials, reset, new device, session persistence, and account switching. SMS remains blocked until provider/SMS delivery/CAPTCHA/limits are configured and tested.
- Two-user create/invite/join/privacy proof, membership deactivation and leave semantics. `AccessTab.tsx` `handleLeave` only clears browser hints and routes home; `/api/wg/mine` recovers active `authUserId` memberships, so the likely round-trip back to the WG needs a server-backed deactivation/guard decision. Do not run leave against the live user.
- Real hosted browser journeys for expenses, shopping, chores, calendar, chat, Pinnwand, attachments, offline reconciliation, and all advertised ancillary integrations.
- Real iOS and Android installation/open/offline/update proof; a `390px` Chrome viewport is responsive evidence, not installation evidence.
- Existing `/impressum` and `/agb` links in `apps/web/src/components/wg/einstellungen/DataTab.tsx` currently return not found. Privacy copy only discusses PostHog analysis and requires responsible content review; make no legal conclusion or invented operator detail.
- PayPal Merchant-ID display needs a truthful explanation and authorized sandbox eligibility/readiness proof before any financial claim.
- Current backup/PITR, RPO/RTO, restore drill, provider secrets, monitoring, support ownership, and production rollback evidence remain unverified; use `docs/database-recovery.md` rather than rewriting it.

## Release decision and dependency order

The release owner coordinates the sequence and keeps one evidence record per gate. Database/auth configuration owners provide protected secrets through GitHub environments; they never put secret values in the repository or logs. Product owner decides any advertised-feature deferral/hide choice explicitly. QA owner records test names, URL/SHA, mode, result, skips, and artifacts.

Overall priority is UX0 → UX1 → UX2 with UX3 testing/iteration → UX4. The remaining paragraphs describe the later technical release track. Its internal order is Task 1 → Task 2 and Task 8 in parallel → Tasks 3–4 → Task 5 → Tasks 6–7 → Tasks 9–10. Discover external prerequisites early, without letting infrastructure work replace product design. Within the release lane, database migration/check must finish before the same-SHA protected browser matrix. A failed prerequisite blocks downstream claims; it does not become a skip hidden inside a green summary.

## Command and evidence inventory

Run commands from `/Users/abu/Company/manawg-app` with Node 22. Preserve the CI job URL, commit SHA, environment, Playwright report, and sanitized logs for each result.

- Source: `PATH=/opt/homebrew/opt/node@22/bin:$PATH /opt/homebrew/bin/pnpm lint`
- Analytics/boundaries: `pnpm --dir apps/web analytics:check` and `pnpm --filter @manawg/web exec node scripts/check-feature-boundaries.mjs`
- Types/build/bundle: `pnpm typecheck`, `pnpm build`, and `pnpm --filter @manawg/web bundle:check`
- Fixture: `pnpm --filter @manawg/web test:e2e:fixtures`
- Named Preview pack: `pnpm --filter @manawg/web exec playwright test preview-protection.spec.ts smoke-launch.spec.ts public-entry-live.spec.ts social-login-live.spec.ts supabase-auth-live.spec.ts --retries=0`
- Focused selection: use `--grep` or explicit filenames; Playwright selection must never be inferred from a broad command that silently excludes a required spec.
- Database: `pnpm --filter @manawg/web db:migrate` followed by `pnpm --filter @manawg/web db:check`, only through the protected Preview/Production workflow with direct port `5432`.
- Static hygiene: `git diff --check`, `openspec validate`, and a final `git status --short --branch` on the pinned candidate.

## Minimum feature matrix

| Area | Required hosted proof or explicit decision |
| --- | --- |
| Auth/recovery | Sign-up, confirmation, sign-in, reset, new device, logout, account switch; SMS only when configured |
| WG lifecycle | Create, invite, join, reload, invalid/expired invite, two-user visibility |
| Membership/privacy | Leave/deactivate, owner/admin management, outsider denial, stale local state and cache denial |
| Dashboard/navigation | Useful empty state, first action/invite, five-tab navigation, mobile overflow |
| Expenses | CRUD, split/settlement, duplicate rejection, import preview/commit, export, offline reconciliation |
| Shopping/chores | CRUD, templates, completion, reload and multi-user visibility |
| Calendar/chat/Pinnwand | Event/subscription, chat, notice-board create/read, authorization and reload |
| Payments | PayPal sandbox eligibility, amount/currency/status, failure and no-real-money claim |
| Push/cron | Permission denial, subscription/unsubscribe, delivery path, protected cron and failure state |
| Storage | Upload/read, missing object, outsider denial, cache isolation |
| PWA | iOS and Android install, relaunch, offline/reconnect, update, sign-out cache isolation |
| Public data | `/impressum`, `/agb`, `/datenschutz`, account/local-data wording and responsible review |

For every row, the evidence record states `PASS`, `BLOCKED`, or `DEFERRED/HIDDEN`, with owner, reason, user-facing behavior, and next action. `DEFERRED/HIDDEN` is valid only after Product owner approval; engineering may not convert a missing provider or failing test into a silent skip.

## Task packets

### Task 1: Freeze candidate and evidence ledger

**Owner:** Release owner. **Dependencies:** none. **Files:** create `docs/releases/release-candidate.md` for sanitized evidence; no runtime file unless a discovered defect is assigned to its owning packet.

- [ ] Record candidate SHA, working-tree state, matching Vercel deployment, environment/project, migration list, previous compatible deployment, and the exact commands below.
- [ ] Reconcile active OpenSpec changes with merged source. Mark historical/public-dashboard/social-auth work based on current code and proof, not old worktree paths. Keep credential-auth requirements in the release gate.
- [ ] Create a pass/blocked/decision row for every feature in the matrix above. A test discovery result, mock, or Vercel READY status cannot fill a hosted-proof row. Name actual accountable people before external release work; role labels alone are not approval.
- [ ] Acceptance: reviewers can trace every later result to one SHA, one environment, one runner mode, and one owner without seeing secrets or customer data.

### Task 2: Restore the Preview database gate

**Owner:** Database/migration owner. **Dependencies:** Task 1 candidate SHA; protected Preview direct URL. **Files:** `.github/workflows/ci.yml` only if sequencing/guard strengthening is required; use existing `apps/web/scripts/db-migrate.mjs`, `db:check`, and `docs/database-recovery.md`.

- [ ] Provision/verify the protected GitHub Preview secret `SUPABASE_PREVIEW_DATABASE_MIGRATION_URL` for the direct ManaWG Preview Supabase host on port `5432`; never print it, substitute a pooler, or use a local database.
- [ ] Run remote CI for the exact candidate SHA. Require the existing hostname/protocol/port guard, `pnpm --filter @manawg/web db:migrate`, and `pnpm --filter @manawg/web db:check` to pass.
- [ ] Confirm the migration ledger is an ordered canonical applied prefix with no unexplained gaps/duplicates; record schema, constraints, indexes, RLS, roles, policies, views, functions, and data invariant result.
- [ ] If CI event ordering can let Preview E2E run before migration, strengthen the existing workflow dependency with the smallest change and rerun it. Do not add a new orchestrator.
- [ ] Acceptance: Preview migration and check pass for the same candidate SHA that will be browser-tested; failed/unknown migration outcome stops release.

### Task 3: Complete account and credential recovery proof

**Owner:** Auth owner. **Dependencies:** Task 2; authorized Preview Auth credentials and callback configuration. **Files:** existing `apps/web/src/core/auth/*`, `apps/web/src/app/auth/*`, entry/auth components, and `apps/web/e2e/supabase-auth-live.spec.ts`; modify only where a failing test identifies a defect.

- [ ] Provision the dedicated QA member secrets named in the CI comment and the existing spec. Verify Supabase Site URL, callback allowlist, email/SMTP, password recovery, Google, and any enabled phone/SMS/CAPTCHA/limits through authorized provider evidence.
- [ ] Re-enable the existing live auth spec with a `Require` step for all required secrets. Use the existing safe-next contract; never place passwords, OTPs, tokens, or WG intent secrets in URLs or analytics.
- [ ] Prove signed-out public entry, Google if enabled, email sign-up/confirmation/sign-in, neutral wrong-credential response, password-reset request and callback, session persistence on reload, logout, new-device recovery, and account switch.
- [ ] Prove SMS request/valid OTP/invalid OTP only if its provider and delivery are configured. If not, product owner records an explicit hide/deferral decision and the UI remains honest and non-promotional.
- [ ] Acceptance: the exact enabled auth methods complete a real Supabase browser round-trip in protected Preview; disabled methods are absent or clearly unavailable; no account enumeration or automatic WG write occurs.

### Task 4: Correct membership deactivation and privacy semantics

**Owner:** Account/data owner. **Dependencies:** Task 3 QA users; existing membership APIs and RLS. **Files:** `apps/web/src/components/wg/einstellungen/AccessTab.tsx`, `apps/web/src/app/api/wg/[code]/members/[id]/route.ts`, `apps/web/src/app/api/wg/mine/route.ts`, related guards/tests.

- [ ] Trace every caller of `handleLeave`, `/api/wg/mine`, the member PATCH route, root membership recovery, server WG layout, service worker, and offline stores before editing.
- [ ] Choose and implement the smallest existing server-backed semantics: self leave/deactivation must persist, stop active membership access, clear client hints, and avoid automatic recovery into the same WG; owner/admin actions must retain their current authorization contract.
- [ ] Add focused Playwright coverage for two accounts: invite/join, outsider denial, deactivation, account switch, reload, stale local identity/history, cached private document, and cross-WG access. Do not execute the destructive leave against a real customer session.
- [ ] Acceptance: a deactivated member cannot appear in `/api/wg/mine`, access private WG HTML/API/cache, or regain membership by local storage; an authorized owner/admin can still manage membership.

### Task 5: Prove the core household product

**Owner:** Product QA owner with module owners. **Dependencies:** Tasks 2–4; disposable two-user Preview data and cleanup authority. **Files:** existing `apps/web/e2e/` specs/helpers only for missing coverage; runtime changes belong to the owning module.

- [ ] Run the existing protected Preview pack using explicit filenames/grep, for example `pnpm --filter @manawg/web exec playwright test preview-protection.spec.ts smoke-launch.spec.ts public-entry-live.spec.ts social-login-live.spec.ts supabase-auth-live.spec.ts --retries=0`.
- [ ] Exercise create WG, invite, join, reload, two-user visibility, dashboard welcome/next action, five-tab navigation, empty states/templates, first task, and back/cancel/invalid invite behavior.
- [ ] Exercise expenses: create/edit/delete, split/settlement, duplicate prevention, import preview/commit, attachment read/write where enabled, and offline queue/reconciliation without duplicate writes or data loss.
- [ ] Exercise shopping, chores/Putzplan, calendar/events, chat, Pinnwand, settings, and account/member boundaries with at least two disposable accounts. Verify every mutation persists after reload.
- [ ] Acceptance: representative happy path and negative privacy path pass against real Preview services. Required test cleanup must succeed; cleanup failure fails the run and records the disposable namespace for recovery, as required by the existing Preview specification.

Execute Task 5 as separately reviewable packets, not one repository-wide change:

| Packet | Existing starting points | Acceptance |
| --- | --- | --- |
| 5A First useful dashboard action | `apps/web/src/app/wg/[code]/page.tsx`, `components/entry/WgWelcome.tsx`, `components/wg/ShareWgCard.tsx`, `e2e/dashboard-retry.spec.ts` (paths under `apps/web/src` unless `e2e`) | An empty WG offers an invite or first-task action before empty statistics; keep all existing data reachable and preserve loading/error distinctions. Confirm at 390×844 and desktop. |
| 5B Expenses and reconciliation | `apps/web/e2e/expenses-retry.spec.ts`, `export-api.spec.ts`, `import.spec.ts`, existing expense/offline modules | Two users observe the same persisted totals; repeat submission/reconnect creates one write; a failed import does not partially commit. |
| 5C Shopping and chores | `apps/web/e2e/shopping-actions.spec.ts`, `chores-retry.spec.ts`, existing feature modules | Create, complete, reload and second-user visibility work; a failed request retains retryable user input. |
| 5D Calendar and communication | `apps/web/e2e/kalender.spec.ts`, `chat.spec.ts`, `pinnwand-retry.spec.ts`, existing feature modules | Authorized create/read persists; outsiders are denied; failure/retry does not duplicate an event or message. |

Keep each corrective change scoped to one flow and its focused Playwright regression. Existing fixture-only tests need hosted counterparts or a documented manual hosted check; simply pointing mocked tests at Preview is not real-service proof. Treat Task 6's payment, calendar, push, and storage rows as independent packets too.

### Task 6: Verify advertised ancillary integrations

**Owner:** Integration owner. **Dependencies:** Task 5; provider-specific sandbox/test credentials and recipient isolation. **Files:** existing payment/calendar/push/storage/import/export routes and specs; no new provider abstraction.

- [ ] Build a feature inventory from visible navigation, settings, route handlers, and docs: PayPal settlement, Apple/Google calendar subscription, web push, uploads/storage, expense import/export, and notifications/cron.
- [ ] For each enabled feature, record configuration evidence, one safe sandbox/disposable mutation where applicable, one read/reload assertion, failure/unavailable state, rate-limit/auth boundary, and cleanup.
- [ ] Payment proof must validate amount/currency/order/status against PayPal sandbox and never capture/refund real money. Calendar proof must validate generated feed/subscription access and revocation/rotation. Push proof must cover permission denial, subscription, delivery path, and unsubscribe where supported. Storage proof must cover upload, authorized read, outsider denial, and missing-object error.
- [ ] If a feature lacks safe provider credentials or cannot meet the gate, Product owner explicitly chooses defer/hide with copy and release-note wording; no implementation silently changes the advertised surface.
- [ ] Acceptance: every visible ancillary feature is either hosted-tested and green or has a recorded product decision, owner, user-facing state, and follow-up scope.

### Task 7: Finish PWA and responsive device evidence

**Owner:** Frontend/PWA owner. **Dependencies:** Task 5; release candidate deployment. **Files:** existing manifest/service worker/install prompt/PWA helpers and Playwright specs only if defects appear.

- [ ] At `390x844`, verify launch, five-tab navigation, forms, keyboard/focus, dialogs, empty states, long WG names, offline indicator, and no horizontal clipping. Preserve the already clean Putzplan result.
- [ ] On one current iOS device and one current Android device, prove HTTPS install/add-to-home-screen, first open, relaunch, offline public shell, reconnect, update to a new build, and sign-out/account-switch cache isolation. Record OS/browser/device and screenshots/log identifiers without private data.
- [ ] Verify service worker caches only approved public/static content and does not serve private HTML, API responses, attachments, or account-specific state after logout.
- [ ] Acceptance: installation and offline behavior are evidenced on both platforms; a desktop/Chrome responsive screenshot alone cannot close this gate.

### Task 8: Repair public data/legal/payment readiness copy

**Owner:** Product owner with privacy/legal reviewer and payments owner. **Dependencies:** Task 1 feature inventory; no legal conclusion delegated to engineering. **Files:** `apps/web/src/components/wg/einstellungen/DataTab.tsx`, `apps/web/src/components/wg/einstellungen/ProfileTab.tsx`, `apps/web/src/app/wg/[code]/einstellungen/page.tsx`, `apps/web/src/app/datenschutz/page.tsx`; create `apps/web/src/app/impressum/page.tsx` and `apps/web/src/app/agb/page.tsx` only for approved content if no approved existing destination is reused. Split link/content repair and account/payment wording into separate changes.

- [ ] Make `/impressum` and `/agb` resolve from the existing settings links, or remove those links only through an explicit product/legal decision. Do not invent operator identity, address, or legal text.
- [ ] Review privacy text against account authentication, WG membership, database, storage, analytics, notifications, payment, and retention processing. Record legal review ownership and unresolved content separately from technical correctness.
- [ ] Replace the device-only identity wording with accurate account/member wording that explains local browser hints versus server-backed Supabase membership, while preserving necessary offline/local-data disclosure.
- [ ] Explain the PayPal Merchant-ID field truthfully, including whether it is user-entered, who can use it, and what sandbox/production eligibility has actually been proved.
- [ ] Acceptance: all linked legal routes load, copy is responsible-review approved, privacy/account wording matches observed architecture, and no financial capability is implied without provider proof.

### Task 9: Recovery, monitoring, support, and release operations

**Owner:** Operations/recovery owner. **Dependencies:** Tasks 2–8; provider access and approved RPO/RTO. **Files:** use `docs/database-recovery.md`; modify it only for a verified missing operational fact, not to replace the procedure.

- [ ] Record backup/PITR availability and retention, approved numeric RPO/RTO, restore eligibility, compatible previous deployment, provider environment mappings, secret presence, and on-call/release approver roles.
- [ ] Run an authorized isolated hosted restore drill with outbound effects disabled. Reconcile database/Auth links, ledger, RLS/grants, storage objects, payment state, rate limits, and application smoke; record measured recovery time and unexplained mismatches.
- [ ] Verify production logs/alerts for HTTP errors, auth failures, DB connections, migration failures, upload failures, payment callbacks, notification delivery, cron claims, duplicate writes, and web vitals. Define who receives and acknowledges each alert.
- [ ] Prepare support runbook entries for sign-in/reset, invite/join, account switch, deactivation, payment/calendar/push failures, offline conflict, export, and data/privacy requests. Never put credentials or customer data in tickets.
- [ ] Acceptance: recovery evidence supports approved RPO/RTO, monitoring has an owner and test signal, and support can diagnose the critical user journeys before production approval.

### Task 10: Production migration, staged release, canary, and rollback

**Owner:** Release approver and migration operator. **Dependencies:** all prior tasks green; explicit production authority; Task 9 recovery evidence.

- [ ] Approve exact `main` SHA, migration window, production project, compatible previous deployment, RPO/RTO, write containment, and rollback decision. Confirm the GitHub Production environment is protected.
- [ ] Use the existing `.github/workflows/migrate-production.yml` only. Verify the resolved run SHA equals the approved SHA, direct Supabase port `5432` is used, migration and `db:check` pass, and any stalled/cancelled run is treated as unknown until ledger/schema inspection proves state.
- [ ] Deploy the matching app candidate, verify actual Vercel deployment, canonical domain, revision, environment, auth callback, and protected production smoke. Reopen writes progressively after migration/data/payment/offline reconciliation checks.
- [ ] Canary with low-risk authenticated and signed-out flows first; observe auth, route/API errors, database connections, uploads, payments, notifications, cron, cache, and performance for the agreed window. Keep a timestamped decision log.
- [ ] Roll back app traffic only by promoting the approved compatible previous deployment. A Vercel rollback does not undo database changes, payments, delivered notifications, or object mutations; use reviewed forward repair or provider restore when required.
- [ ] Acceptance: release approver signs the exact SHA, migration, deployment, smoke, monitoring, observation window, and rollback readiness. Any critical failure blocks promotion and records whether state is rolled back, committed, or unknown.

## Final done criteria

- [ ] The UX specification's key journeys, screen/state rules, and terminology are implemented and reviewed; observed usability tasks pass the agreed acceptance bar, and serious money/privacy misunderstandings are resolved. No automated technical result substitutes for this product acceptance.
- [ ] Candidate source checks pass on Node 22: `pnpm lint`, `pnpm --dir apps/web analytics:check`, feature-boundary check, `pnpm typecheck`, `pnpm build`, `pnpm --filter @manawg/web bundle:check`, `git diff --check`.
- [ ] Playwright remains the sole application runner. `pnpm --filter @manawg/web test:e2e:fixtures` passes with its fixture-mode evidence; named protected Preview specs pass with real services and exact SHA.
- [ ] Preview direct migration/check and production migration/check pass; no withheld secret, skipped event, or Vercel status is reported as proof.
- [ ] Auth/recovery/new-device/account-switch, two-user membership/privacy, core modules, and iOS/Android PWA gates are green. Optional ancillary integrations may be explicitly deferred/hidden by Product owner with recorded copy and owner; this exception never waives security, data integrity, required cleanup, or recovery.
- [ ] Public legal routes and reviewed privacy/account/payment wording load correctly and make no unsupported legal or financial claim.
- [ ] Backup/restore, RPO/RTO, monitoring, support, canary, and rollback evidence is current for the exact release.
- [ ] Final release record contains only sanitized command/results, URLs, SHAs, run IDs, device metadata, screenshots, owners, decisions, and restricted evidence references; it contains no secrets, tokens, OTPs, cookies, signed URLs, or customer data.
