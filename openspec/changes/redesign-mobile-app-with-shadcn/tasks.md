## 1. Baseline and reviewable component prototype

Dependencies: none. Follow `design.md` for the proposed visual baseline, coverage matrix and navigation. Keep each implementation slice to a small set of handwritten files; split larger changes before editing. Generated registry files remain reviewable upstream components.

- [x] 1.1 Reconcile local/remote state and prepare the isolated worktree at fetched origin/main; record Node 22.23.2/pnpm 9, branch and preservation of original uncommitted changes. Baseline tests are deferred per the user's implementation-first request.
- [x] 1.2 Inventory every route, visible action, mutation, relevant permission and draft/return behavior into the design coverage matrix; verify each route has an assigned migration task and a content contract identifying the user's question, essential facts/action, optional detail and next result, including secondary finance, imports, notification settings and offline work.
- [x] 1.3 Record the user's approval of the four-destination image organization and requirement for original GitHub component styling; preserve this choice in the execution brief without claiming representative-user validation.
- [x] 1.4 Resolve Nova/Neutral/Inter/Lucide with the official shadcn CLI in the isolated prototype, check the Tailwind/browser compatibility floor, and install the necessary original components; verify the recorded preset/CLI version, `shadcn info --json`, dependency resolution and a rendered reference screen in both themes. No live service actions.
- [x] 1.5 Implement the six-state phone flow in the app with actual shadcn/Animate UI components; after implementation, have Luna verify Start -> Einkauf -> add-item drawer -> expense/inline split review -> save/return and a failure/offline branch with safe sparse/busy fixture data at phone widths.
- [x] 1.6 Prepare the research protocol's neutral first-use, return-use and failure tasks for young, smartphone-experienced users, covering relevant WG roles/phone platforms and comparison-order controls; verify the ready-to-run script and blank evidence table. Preparation, expert walkthroughs and simulated users are not completed resident testing. The prepared protocol is `docs/research/2026-09-05-mobile-usability-validation.md`; no participants have been recruited or tested.
- [x] 1.7 Record the user's image/plan approval and implementation-first instructions, Luna-only browser verification, OpenCode free-model delegation, new GitHub branch push and later human review/release decision. No further prototype-approval gate is required for this implementation.

## 2. Shared visual foundation and phone shell

Dependencies: section 1. Primary ownership: dependency/configuration files, root/WG layouts, shared theme, navigation and `components/ui`.

- [x] 2.1 Migrate the app UI build to the validated Tailwind 4 setup and configure the accepted shadcn preset using existing aliases; verify install/typecheck/build and a reference component with no legacy color/typography overrides. Split configuration and source adaptation when needed.
- [x] 2.2 Introduce the accepted shared theme, typography, component states and Animate UI reduced-motion configuration; verify equivalent controls across two routes in light/dark/reduced-motion modes and inspect the client bundle for unexpected global motion imports.
- [x] 2.3 Build the selected phone shell, primary links, visible local navigation, profile/search access and editor chrome behavior; verify existing deep links, active parent groups, back navigation, safe areas, long labels, stable relative order across empty/populated/return states and no horizontal document overflow with an updated `e2e/mobile-shell.spec.ts`.
- [x] 2.4 Complete the foundation checkpoint: run lint/typecheck/build plus the focused shell test; verify the accepted style at the available 320px/390px Chromium widths and record unavailable 360px/430px and real-device coverage separately.

## 3. First complete financial flow

Dependencies: section 2. Primary ownership: `features/expenses/components/ausgaben`, expense page, debt/payment presentation and the existing expense tests. Keep calculation and API contracts intact.

- [x] 3.1 Recompose expense list, filters and detail presentation using original Item/Badge/Field components; verify long names/amounts, loaded/empty/error states, recurring links and receipt access with `expenses-retry.spec.ts` and the relevant core-flow checks.
- [x] 3.2 Replace expense create/edit presentation with a phone editor and visible inline split review while reusing existing form/domain logic; verify equal/manual split, payer choice, prefill precedence, optional receipt/recurrence disclosure with active effects summarized, cancel/draft preservation, plain-language validation and duplicate-safe retry through focused Playwright scenarios.
- [x] 3.3 Redesign balance/settlement and PayPal entry presentation; verify in isolated mocked flows that displayed records/amounts match the requested settlement and that recording an existing payment remains distinct from initiating provider payment. Do not execute real payments.
- [x] 3.4 Complete the financial checkpoint: verify the full expense flow, a rejected save, partial/unsupported settlement feedback and return behavior; run the affected tests, typecheck and bundle check, and retain a mobile trace/screenshots.

## 4. Entry, onboarding and Start

Dependencies: sections 2 and 3. Primary ownership: `components/entry`, `components/auth`, `app/neu`, `app/auth/reset` and the WG home view.

- [x] 4.1 Rebuild public entry/discovery and sign-in/recovery presentation with the accepted components, retaining configured providers, auth intent and access to unchanged privacy information; verify guest/error states, public discovery links and the existing social-auth/public-entry test contracts without changing provider configuration. Split entry/discovery and auth surfaces into separate small patches.
- [x] 4.2 Rebuild create/join/WG selection presentation; verify invitation precedence, account switching, create/join distinction, form cancellation and permission failures using isolated test data and existing auth guards.
- [x] 4.3 Build Start for both a new empty WG and an established WG with pending work; verify real-data next actions, concise balance, activity/search/profile destinations and empty/loading/error/offline variants with `dashboard-retry.spec.ts` and core-flow checks.

## 5. Household workflows

Dependencies: section 2; the shopping-to-expense connection also depends on section 3. Primary ownership: shopping, inventory, chores and events feature presentation. These slices can have separate owners after the shared shell is stable.

- [x] 5.1 Redesign shopping list/add/edit/completion with an actual Animate UI Checkbox and keyboard-safe entry; verify quantities, actor labels, check/uncheck, deletion permissions, failure rollback and stable consecutive touch targets during updates with `shopping-actions.spec.ts` and `shopping-retry.spec.ts`.
- [x] 5.2 Integrate the explicit shopping-to-expense handoff with the new editor; verify prefilled description/context, visible amount/payer/split review and no financial write when the resident cancels.
- [x] 5.3 Redesign inventory list, add/edit, consume and restock presentation; verify `vorraete.spec.ts`, shopping handoff, allowed actions and truthful pending/failure states.
- [x] 5.4 Redesign the core chore list, create/edit and completion presentation; verify assignee, due state, confirmation and the server-confirmed next result with `chores-retry.spec.ts` and relevant core-flow cases.
- [x] 5.5 Redesign absence and fairness views using the same controls and progressive disclosure; verify that rotation, recurrence, absence rules and access behavior match the existing domain results.
- [x] 5.6 Rebuild the calendar agenda, date selection and event editor, preserving subscription access; verify `kalender.spec.ts`, time display, create/edit/cancel, the return path matching the selected hierarchy and unchanged deep links.
- [x] 5.7 Complete the household checkpoint: verify shopping, chores, inventory and calendar are discoverable within the selected navigation on small phones, cross-feature handoffs preserve WG context, and all affected tests pass.

## 6. Communication

Dependencies: section 2. Primary ownership: pinnwand/chat feature presentation, with one owner per file.

- [x] 6.1 Rebuild Pinnwand reading, filters, composer and attachment presentation; verify loaded/empty/error states, draft preservation, readable long content and `pinnwand-retry.spec.ts`.
- [x] 6.2 Rebuild Pinnwand pin/resolve, comment, reaction and responsibility interactions as supported; verify existing permissions and visible pending/success/failure behavior with focused Playwright scenarios.
- [x] 6.3 Recompose chat using the official messaging components while preserving existing transport and message semantics; verify `chat.spec.ts`, mentions/reactions, history anchoring, unread/typing behavior where implemented, and composer visibility with the phone keyboard.
- [x] 6.4 Complete the communication checkpoint: verify switching between Pinnwand and Chat preserves the proper context/drafts and that live or failed updates never create misleading completion feedback.

## 7. Secondary financial workflows

Dependencies: sections 2 and 3. Primary ownership: subscription/reminder pages, Abo components and import presentation.

- [x] 7.1 Redesign subscriptions and recurring-cost controls, including pause/edit/remove; verify `abos.spec.ts`, `abos-races-audit.spec.ts`, recurring template behavior and accessible confirmation states.
- [x] 7.2 Redesign reminders and their supported actions; verify `mahnungen.spec.ts`, exact financial context, relevant permissions and honest dispatch/failure state in isolated tests.
- [x] 7.3 Rebuild import source selection, member mapping, preview, commit/progress and failure presentation for phones; verify `import.spec.ts`, review-before-write, narrow-screen readability and duplicate/error recovery.
- [x] 7.4 Recompose receipt upload/OCR review where not completed in section 3; verify upload progress/failure, editable recognized data and that recognition never silently saves an expense. Live OCR/provider delivery remains outside Fixture evidence.

## 8. Account, settings, search and offline surfaces

Dependencies: section 2. Primary ownership: `components/wg/einstellungen`, settings/search/activity/offline routes and shared feedback components.

- [x] 8.1 Rebuild account/profile and WG/member/invitation settings with explicitly separate scopes; verify `settings-access.spec.ts`, existing role restrictions and clear effects for leave/deactivate actions.
- [x] 8.2 Rebuild notification/theme preferences, export/data controls and offline-queue presentation; verify `notifications-settings.spec.ts`, `export-download.spec.ts`, preference preservation and the visibility of pending scoped operations.
- [x] 8.3 Rebuild search/results and activity presentation; verify `search-retry.spec.ts`, `activity-retry.spec.ts`, empty/error recovery and deep links into the newly grouped interface.
- [x] 8.4 Apply consistent offline, access-denied, not-found and route error states; verify `offline-page.spec.ts`, draft preservation, recovery links and absence of cross-account/WG data leakage.

## 9. Complete migration and verify

Dependencies: all previous sections.

- [x] 9.1 Review every route/action and content contract from section 1 against its completed redesigned flow; verify coverage, visible decision-critical information, understandable labels and obvious access to optional detail, and record both overload and missing-context issues explicitly.
- [x] 9.2 Review obsolete presentation components, legacy token bridges, fonts and unused UI dependencies after checking their consumers; verify a source search, `git diff --check`, lint/typecheck and representative light/dark screens. Active shared safety bridges remain where consumers still require them.
- [x] 9.3 Run the complete applicable technical gates under Node 22: root and web lint, typecheck, build, bundle/privacy checks and Playwright fixture suite; verify exits and report pre-existing failures separately from new regressions. No completion claim from file existence or screenshots alone.
- [x] 9.4 Verify critical flows at the available 320/390px Chromium widths, dark/light and reduced motion, including keyboard/safe-area behavior; record unavailable 360/430px, landscape, enlarged-text, iPhone Safari and Android Chrome coverage honestly, and update the knowledge graph with `graphify update .` after code changes.
- [x] 9.5 Have Luna agents perform and document actual mobile browser click-throughs of the primary/secondary routes, money/account meaning, sparse/busy states and failure recovery; resolve material findings before push. Clearly label this AI-assisted browser verification, not a human-user study.
- [x] 9.6 Have an independent Luna smoke review phone UI consistency, light/dark/reduced-motion and return/draft states after fixes; verify evidence and push the completed new branch to GitHub for the user's next-day review, without deployment or merge.

## Verification commands

These are the final implementation-stage commands. They were run in the implementation worktree with Node 22 and pnpm 9. Existing fixture-provider degradation is reported separately; no gate was lowered.

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

## Authorized public-entry follow-up — 2026-09-05

- [x] Implement the public start and discovery preview slice with static, clearly fictional read-only content, the original Base Nova / Neutral component presentation and compact guest entry while preserving public/auth contracts.
- [x] Keep membership lookup errors and retry visible, invitation parameters intact and remove repeated public `Weitere Bereiche` catalogs.
- [x] Update focused public-entry assertions for the approved headline, four previews, active-module content and removed catalog.
- [x] Controller: inspect the start, all eleven module routes, invitation and auth controls through the connected Chrome Extension at mobile widths and in both themes.
- [x] Controller: complete independent review and final repository gates. Public-entry follow-up evidence and explicit hosted-auth limitations are recorded in [the accepted implementation plan](../../../docs/superpowers/plans/2026-09-05-public-entry-visual-polish.md).

## Original shadcn motion correction follow-up — 2026-09-05

- [x] Supersede the public-only petrol exception and remove consumer-level public color, ring, opacity, shadow, radius and typography overrides; restore original Base Nova / Neutral / Inter / Lucide component composition.
- [x] Keep the fictional public previews and contracts while using original Card/Item/Badge/Avatar variants and readable layout-only wrapping at narrow widths.
- [x] Add the documented `motion/react` route-content opacity entry transition with `useReducedMotion()` immediate rendering; do not replace the compatible existing auth Tabs solely to showcase animation.
- [x] Update focused public-entry assertions for semantic preset colors, reduced-motion rendering and complete preview content.
- [x] Controller: verify original neutral light/dark rendering, public/auth Motion and reduced-motion behavior through the connected Chrome Extension; complete independent review and final gates. See [correction acceptance](../../../docs/superpowers/plans/2026-09-05-original-shadcn-motion-correction.md).

## Authorized Liquid Glass web follow-up — 2026-09-05

- [x] Inspect and pin the MIT `simple-liquid-glass@4.1.0` core with React 19 peer compatibility and SSR-safe source behavior.
- [x] Add the central deterministic `mode="preset"`, `effectMode="blur"`, `mobileFallback="css-only"` adapter with semantic opaque accessibility fallbacks.
- [x] Wrap the authorized public/private navigation, header toolbar, SubNav, public CTA, auth TabsList and shared dropdown popup surfaces while leaving content cards/forms and contracts unchanged.
- [x] Update focused glass presence, fallback, link and no-card-takeover regression assertions; no automated browser was launched.
- [x] Controller: complete public/auth glass, readability and fallback checks in connected Chrome and independent source review; record the pre-existing private fixture membership blocker and device-test limits in [Liquid Glass acceptance](../../../docs/superpowers/plans/2026-09-05-liquid-glass-web-adoption.md). Final graph and evidence updates complete.

## Existing WG app-start consistency follow-up — 2026-09-05

- [x] Replace the WG context membership/error-state native controls with the existing Alert/Button and shadcn link variants while preserving text, reload behavior, destination and guard conditions.
- [x] Apply the existing bottom-navigation active-state animation to both `aria-current="page"` and grouped `aria-current="location"` states in normal and reduced-motion media rules.
- [x] Keep database-down fixture bootstrap aligned with the existing member-header guard: expose fixture `currentMember`, send the existing member header for the members refresh, and cover missing/valid/invalid headers plus dashboard access in the request-only API regression.
- [x] Controller: verified the final Test-WG build in connected Chrome at `http://127.0.0.1:3101/wg/MTE8PZAT`: Start loads without the former membership failure; Einkauf, Ausgaben, opening/cancelling the expense editor and Fixkosten work at 320/390px without horizontal overflow. Glass remains bottom-only. Grouped Finanzen has `aria-current="location"` and the existing animation, which becomes `none` with reduced motion. Dark mode was visually checked; temporary browser emulation was reset. Recovery-state component changes passed source review, not an injected browser-failure test. Data remain fixed fixtures; hosted login, persistent writes and live chat were not verified.

## Original mobile-redesign evidence — 2026-09-05 (before public-entry follow-up)

- Root lint: 447 files checked.
- Web lint and feature boundaries: 438 files, 7 feature boundaries OK.
- Typecheck, production build, bundle budget and analytics privacy: passed. Shared first-load gzip is 101.5 kB against a 120 kB budget.
- Full Playwright fixture suite: 204 passed, 20 skipped (live/provider-auth scenarios without the required hosted credentials), 0 failed.
- Mobile-focused suites: Chores 35/35, Finance/Import 39/39, Settings Access 22/22, Shopping Actions 15/15, Shopping Recovery 9/9, Pinnwand 28/28, Search 7/7, Offline 5/5, Luna shell/chat smoke 3/3.
- Browser evidence: [finaler Mobile-Review](../../../docs/mobile-redesign-luna-browser-review-final.md) with 18 matrix screenshots plus focused captures for 390x844/320x844 Light, 390x844 Dark and reduced motion. A prior Luna High browser review remains in `docs/mobile-redesign-luna-browser-review.md`.
- Graph update: `graphify update .` passed; 11 SQL files remain unparsed because the optional `tree_sitter_sql` dependency is not installed.
- OpenCode free work is documented in `docs/mobile-redesign-opencode.md`; its free quota was exhausted and no paid fallback was used.

Reuse the existing Playwright layer. Extend tests for changed behavior; no new unit-test framework or mirrored implementation tests. Genuine hosted authentication, provider delivery and payment execution are separate from fixture evidence and require the appropriate live workflow and authority.

Human usability evidence follows [the research protocol](../../../docs/research/2026-09-05-mobile-usability-validation.md). Its participant counts and acceptance thresholds are proposed project targets, not scientific guarantees. Automated checks, an owner walkthrough and AI-simulated user behavior cannot substitute for the first-use and return-use observations.

The eight-participant and delayed-return studies are later product validation, explicitly outside completion of the current implementation-and-review-branch goal. They remain pending and must not be claimed as satisfied by Luna browser checks. The user's review and release approval follow the branch push.
