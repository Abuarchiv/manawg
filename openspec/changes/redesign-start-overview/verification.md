# Start overview verification — 2026-09-05

## Result

Start now puts ranked pending work first, with one focus, two secondary items and an accessible Animate UI expansion for the remainder. Personal responsibility uses member IDs. The balance is compact; WG news suppresses repeated entity links. The module directory, separate duplicate chore/shopping sections, health score and five unused dashboard components were removed.

No dependencies, schema, financial mutations, permissions or neighboring feature workflows were changed. The shared loading-error component received a layout-only correction: its original Alert grid keeps the message above the retry button on narrow screens.

## Automated checks executed

- Node 22 production fixture build: passed, including compilation and type validation. Isolated output: `apps/web/.next-e2e-3112`.
- Explicit TypeScript `--noEmit --incremental false`: passed.
- Root Biome: passed; web Biome and feature-boundary check: passed (7 features).
- `start-overview-model.spec.ts`: 3 passed. Covers urgency before truncation, member responsibility, real shopping counts, encoded links/action labels and Berlin day boundaries.
- Existing dashboard membership API check: 1 passed; a fixture dashboard request without member identity returns 401.
- Analytics privacy check: passed.
- Bundle-budget check: passed against the isolated production output.
- OpenSpec strict validation and `git diff --check`: passed.
- Graphify AST update: completed.

The four affected browser suites were updated and their 13 tests successfully enumerated. They were not launched in a separate Playwright browser, respecting the user's connected-Chrome-only preference. Browser behavior was instead checked through that Chrome Extension as described below. This is not a claim that the full application E2E suite or live-provider checks passed.

## Connected Chrome checks executed

The actual production build was served on loopback port 3126. A temporary loopback-only QA proxy supplied controlled dashboard responses on port 3127; product code contains no QA switches.

| Case | Observed result |
| --- | --- |
| Normal fixture | Due recurring cost precedes tomorrow's chore; chore says `Du bist dran`; actual shopping count displayed |
| Busy WG | A personal overdue chore placed last in the response becomes the focus; its heading ends at y=252 at 320px width |
| More items | Six shared chores and 9 shopping items remain reachable; expansion and Enter-key collapse work |
| Narrow / dark / light | 320x844 light and 390x844 dark checked; no horizontal document overflow |
| Reduced motion | Expanded Animate UI panel has `transform: none` under reduced-motion emulation |
| Quiet WG | Calm message and zero-balance direction shown; no artificial tasks |
| Empty WG | Invite/list starter replaces `Heute wichtig` |
| New WG with due costs | First browser check exposed hidden due work; corrected condition now shows the due item instead of onboarding |
| Same text, distinct post IDs | Both distinct posts remain, while their duplicate activity copies are suppressed |
| Negative balance | Absolute amount and debt direction correctly displayed, without a duplicate debt task |
| Delayed response | Matching skeletons are visible until the real response arrives |
| Initial 500 | No fabricated task/balance; readable error and retry control |
| Refresh 500 | Last good data remains with an explicit stale-data message |
| Recovery | Automatic refresh recovers; a controlled first-failure/second-success scenario also passes by clicking the actual retry button |
| Recurring deep link | Opens the existing prefilled expense-review dialog; description and split context checked, then the test draft discarded without saving |

Temporary media/viewport emulation is reset after review. The normal local preview remains available for inspection.

## Limits

Fixtures do not establish real persistence, hosted Supabase login, payment or push delivery. No production records, deployment or merge were performed. Existing broad dashboard history queries and separate finance/queue issues from the app audit remain outside this Start-only change.

## Screenshot follow-up: compact header and optional hints

- One shared Start header now shows the WG name and greeting with equal 44x44 ghost chat/account controls. Other page headers keep their existing composition.
- Welcome dismisses per stable WG/member ID in localStorage; initial rendering waits for that preference, avoiding a reload flash. Shopping and invitations remain accessible through their ordinary destinations.
- Push offer uses original inline Card/Button composition, no fixed overlay, custom pill buttons or font-size overrides. Permission and resubscribe logic is unchanged.
- Connected Chrome: 320px dark and 390px light inspected, 0px overflow; both optional hints were closed and stayed absent after reload; another WG still showed its welcome; returning to the original WG with pending work still showed its task. Header has one h1 and equal 44px controls.
- Notification appearance used an isolated development build with a nonfunctional test public key solely to render the offer. Activation was never pressed; no notification permission or subscription was requested. The normal production preview is built without this test value.
- Current production build: `.next-e2e-3148`, passed including type validation. Root/web lint and feature boundaries passed. Existing model checks: 3 passed. Updated dismissal/browser regressions were enumerated; standalone automated browser execution remains outside this Chrome-only review.
- Independent source review: no findings.
