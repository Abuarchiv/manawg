## 1. Baseline and reviewable component prototype

Dependencies: none. Follow `design.md` for the proposed visual baseline, coverage matrix and navigation. Keep each implementation slice to a small set of handwritten files; split larger changes before editing. Generated registry files remain reviewable upstream components.

- [ ] 1.1 Reconcile current local/remote revisions and overlapping work, activate Node 22/pnpm 9, and prepare an isolated worktree; verify recorded HEAD/tool versions, preservation of uncommitted changes and baseline lint/typecheck results before changing application files.
- [ ] 1.2 Inventory every route, visible action, mutation, relevant permission and draft/return behavior into the design coverage matrix; verify each route has an assigned migration task and a content contract identifying the user's question, essential facts/action, optional detail and next result, including secondary finance, imports, notification settings and offline work.
- [ ] 1.3 Prepare grouped and direct-task navigation candidates with equivalent content and original shadcn styling; verify that task names, primary/local destinations and calendar/chat/settings paths are complete, and record predicted ambiguity instead of treating four tabs as the selected answer.
- [ ] 1.4 Resolve Nova/Neutral/Inter/Lucide with the official shadcn CLI in the isolated prototype, check the Tailwind/browser compatibility floor, and install the necessary original components; verify the recorded preset/CLI version, `shadcn info --json`, dependency resolution and a rendered reference screen in both themes. No live service actions.
- [ ] 1.5 Compose the six-state phone prototype with actual shadcn and selected Animate UI components using fictional sparse and busy WG data; verify Start -> Einkauf -> add-item drawer -> expense/inline split review -> save/return and one failure/offline branch, at 390x844 and 320px width, without hiding decision-critical facts.
- [ ] 1.6 Prepare the research protocol's neutral first-use, return-use and failure tasks for young, smartphone-experienced users, covering relevant WG roles/phone platforms and comparison-order controls; verify the ready-to-run script and blank evidence table. Preparation, expert walkthroughs and simulated users are not completed resident testing.
- [ ] 1.7 Review the prototype and available usability observations with the user; verify that visual feedback, the selected coherent navigation, content contracts, keyboard behavior and any pending real-user validation are recorded before broad conversion. If resident evidence is unavailable, label the navigation provisional rather than proven intuitive.

## 2. Shared visual foundation and phone shell

Dependencies: section 1. Primary ownership: dependency/configuration files, root/WG layouts, shared theme, navigation and `components/ui`.

- [ ] 2.1 Migrate the app UI build to the validated Tailwind 4 setup and configure the accepted shadcn preset using existing aliases; verify install/typecheck/build and a reference component with no legacy color/typography overrides. Split configuration and source adaptation when needed.
- [ ] 2.2 Introduce the accepted shared theme, typography, component states and Animate UI reduced-motion configuration; verify equivalent controls across two routes in light/dark/reduced-motion modes and inspect the client bundle for unexpected global motion imports.
- [ ] 2.3 Build the selected phone shell, primary links, visible local navigation, profile/search access and editor chrome behavior; verify existing deep links, active parent groups, back navigation, safe areas, long labels, stable relative order across empty/populated/return states and no horizontal document overflow with an updated `e2e/mobile-shell.spec.ts`.
- [ ] 2.4 Complete the foundation checkpoint: run lint/typecheck/build plus the focused shell test; verify the accepted style is consistent at 320, 360, 390 and 430px and that old structural test assertions were updated without dropping data or access checks.

## 3. First complete financial flow

Dependencies: section 2. Primary ownership: `features/expenses/components/ausgaben`, expense page, debt/payment presentation and the existing expense tests. Keep calculation and API contracts intact.

- [ ] 3.1 Recompose expense list, filters and detail presentation using original Item/Badge/Field components; verify long names/amounts, loaded/empty/error states, recurring links and receipt access with `expenses-retry.spec.ts` and the relevant core-flow checks.
- [ ] 3.2 Replace expense create/edit presentation with a phone editor and visible inline split review while reusing existing form/domain logic; verify equal/manual split, payer choice, prefill precedence, optional receipt/recurrence disclosure with active effects summarized, cancel/draft preservation, plain-language validation and duplicate-safe retry through focused Playwright scenarios.
- [ ] 3.3 Redesign balance/settlement and PayPal entry presentation; verify in isolated mocked flows that displayed records/amounts match the requested settlement and that recording an existing payment remains distinct from initiating provider payment. Do not execute real payments.
- [ ] 3.4 Complete the financial checkpoint: verify the full expense flow, a rejected save, partial/unsupported settlement feedback and return behavior; run the affected tests, typecheck and bundle check, and retain a mobile trace/screenshots.

## 4. Entry, onboarding and Start

Dependencies: sections 2 and 3. Primary ownership: `components/entry`, `components/auth`, `app/neu`, `app/auth/reset` and the WG home view.

- [ ] 4.1 Rebuild public entry/discovery and sign-in/recovery presentation with the accepted components, retaining configured providers, auth intent and access to unchanged privacy information; verify guest/error states, public discovery links and the existing social-auth/public-entry test contracts without changing provider configuration. Split entry/discovery and auth surfaces into separate small patches.
- [ ] 4.2 Rebuild create/join/WG selection presentation; verify invitation precedence, account switching, create/join distinction, form cancellation and permission failures using isolated test data and existing auth guards.
- [ ] 4.3 Build Start for both a new empty WG and an established WG with pending work; verify real-data next actions, concise balance, activity/search/profile destinations and empty/loading/error/offline variants with `dashboard-retry.spec.ts` and core-flow checks.

## 5. Household workflows

Dependencies: section 2; the shopping-to-expense connection also depends on section 3. Primary ownership: shopping, inventory, chores and events feature presentation. These slices can have separate owners after the shared shell is stable.

- [ ] 5.1 Redesign shopping list/add/edit/completion with an actual Animate UI Checkbox and keyboard-safe entry; verify quantities, actor labels, check/uncheck, deletion permissions, failure rollback and stable consecutive touch targets during updates with `shopping-actions.spec.ts` and `shopping-retry.spec.ts`.
- [ ] 5.2 Integrate the explicit shopping-to-expense handoff with the new editor; verify prefilled description/context, visible amount/payer/split review and no financial write when the resident cancels.
- [ ] 5.3 Redesign inventory list, add/edit, consume and restock presentation; verify `vorraete.spec.ts`, shopping handoff, allowed actions and truthful pending/failure states.
- [ ] 5.4 Redesign the core chore list, create/edit and completion presentation; verify assignee, due state, confirmation and the server-confirmed next result with `chores-retry.spec.ts` and relevant core-flow cases.
- [ ] 5.5 Redesign absence and fairness views using the same controls and progressive disclosure; verify that rotation, recurrence, absence rules and access behavior match the existing domain results.
- [ ] 5.6 Rebuild the calendar agenda, date selection and event editor, preserving subscription access; verify `kalender.spec.ts`, time display, create/edit/cancel, the return path matching the selected hierarchy and unchanged deep links.
- [ ] 5.7 Complete the household checkpoint: verify shopping, chores, inventory and calendar are discoverable within the selected navigation on small phones, cross-feature handoffs preserve WG context, and all affected tests pass.

## 6. Communication

Dependencies: section 2. Primary ownership: pinnwand/chat feature presentation, with one owner per file.

- [ ] 6.1 Rebuild Pinnwand reading, filters, composer and attachment presentation; verify loaded/empty/error states, draft preservation, readable long content and `pinnwand-retry.spec.ts`.
- [ ] 6.2 Rebuild Pinnwand pin/resolve, comment, reaction and responsibility interactions as supported; verify existing permissions and visible pending/success/failure behavior with focused Playwright scenarios.
- [ ] 6.3 Recompose chat using the official messaging components while preserving existing transport and message semantics; verify `chat.spec.ts`, mentions/reactions, history anchoring, unread/typing behavior where implemented, and composer visibility with the phone keyboard.
- [ ] 6.4 Complete the communication checkpoint: verify switching between Pinnwand and Chat preserves the proper context/drafts and that live or failed updates never create misleading completion feedback.

## 7. Secondary financial workflows

Dependencies: sections 2 and 3. Primary ownership: subscription/reminder pages, Abo components and import presentation.

- [ ] 7.1 Redesign subscriptions and recurring-cost controls, including pause/edit/remove; verify `abos.spec.ts`, `abos-races-audit.spec.ts`, recurring template behavior and accessible confirmation states.
- [ ] 7.2 Redesign reminders and their supported actions; verify `mahnungen.spec.ts`, exact financial context, relevant permissions and honest dispatch/failure state in isolated tests.
- [ ] 7.3 Rebuild import source selection, member mapping, preview, commit/progress and failure presentation for phones; verify `import.spec.ts`, review-before-write, narrow-screen readability and duplicate/error recovery.
- [ ] 7.4 Recompose receipt upload/OCR review where not completed in section 3; verify upload progress/failure, editable recognized data and that recognition never silently saves an expense.

## 8. Account, settings, search and offline surfaces

Dependencies: section 2. Primary ownership: `components/wg/einstellungen`, settings/search/activity/offline routes and shared feedback components.

- [ ] 8.1 Rebuild account/profile and WG/member/invitation settings with explicitly separate scopes; verify `settings-access.spec.ts`, existing role restrictions and clear effects for leave/deactivate actions.
- [ ] 8.2 Rebuild notification/theme preferences, export/data controls and offline-queue presentation; verify `notifications-settings.spec.ts`, `export-download.spec.ts`, preference preservation and the visibility of pending scoped operations.
- [ ] 8.3 Rebuild search/results and activity presentation; verify `search-retry.spec.ts`, `activity-retry.spec.ts`, empty/error recovery and deep links into the newly grouped interface.
- [ ] 8.4 Apply consistent offline, access-denied, not-found and route error states; verify `offline-page.spec.ts`, draft preservation, recovery links and absence of cross-account/WG data leakage.

## 9. Complete migration and verify

Dependencies: all previous sections.

- [ ] 9.1 Review every route/action and content contract from section 1 against its completed redesigned flow; verify coverage, visible decision-critical information, understandable labels and obvious access to optional detail, and record both overload and missing-context issues explicitly.
- [ ] 9.2 Remove obsolete presentation components, legacy token bridges, fonts and unused UI dependencies only after checking their consumers; verify a source search, `git diff --check`, lint/typecheck and representative light/dark screens. Keep shared safety/behavior rules still in use.
- [ ] 9.3 Run the complete applicable technical gates under Node 22: root and web lint, typecheck, build, bundle/privacy checks and Playwright fixture suite; verify exits and report pre-existing failures separately from new regressions. No completion claim from file existence or screenshots alone.
- [ ] 9.4 Verify critical flows at 320/360/390/430px, landscape, enlarged text and reduced motion; check current iPhone Safari and Android Chrome where available, including keyboard/safe-area behavior. Record untested devices honestly and update the knowledge graph with `graphify update .` after code changes.
- [ ] 9.5 Conduct prototype and working-app usability rounds with the defined young, smartphone-experienced audience using the research protocol; verify raw per-task outcomes, unnecessary friction/steps, interpretation of money/account scope and corrections for every critical misunderstanding or repeated task blockage. Report the selected version's results against the explicit project targets. Keep this validation unchecked if real participants are unavailable.
- [ ] 9.6 Conduct the delayed return tasks and targeted retests after fixes; verify stable orientation and independent completion with new data and no refresher, recording missing sessions and comparison learning effects honestly. User-validation remains pending until the corresponding evidence exists.

## Verification commands

These are implementation-stage commands, not checks claimed to have run during planning. Run them in the implementation worktree after selecting Node 22 and pnpm 9. Resolve existing baseline failures without lowering the gates.

```sh
pnpm lint
pnpm --filter @manawg/web lint
pnpm typecheck
pnpm build
pnpm --filter @manawg/web bundle:check
pnpm --filter @manawg/web analytics:check
UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= pnpm --filter @manawg/web run test:e2e:fixtures e2e/mobile-shell.spec.ts
UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= pnpm --filter @manawg/web run test:e2e:fixtures
git diff --check
```

Reuse the existing Playwright layer. Extend tests for changed behavior; no new unit-test framework or mirrored implementation tests. Genuine hosted authentication, provider delivery and payment execution are separate from fixture evidence and require the appropriate live workflow and authority.

Human usability evidence follows [the research protocol](../../../docs/research/2026-09-05-mobile-usability-validation.md). Its participant counts and acceptance thresholds are proposed project targets, not scientific guarantees. Automated checks, an owner walkthrough and AI-simulated user behavior cannot substitute for the first-use and return-use observations.
