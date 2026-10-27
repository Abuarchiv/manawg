## 1. Reconcile the implementation boundary

- [x] 1.1 After the concurrent release/database agent hands off, compare the final diff with `proposal.md` and keep this change limited to `apps/web/package.json`, the root test script if required, Playwright files under `apps/web/playwright.config.ts` and `apps/web/e2e/`, and the fixture/Preview portions of `.github/workflows/ci.yml`; verify that no migration, schema, or production-release file is claimed by this change.
- [x] 1.2 Read the final `openspec/changes/establish-playwright-verification/proposal.md`, both capability specs, and `design.md`; verify every remaining task below maps to at least one SHALL/MUST requirement before editing code.

## 2. Establish the Playwright-only runner

- [x] 2.1 Update the root and web package test entry points so the supported application test command invokes Playwright, remove obsolete Vitest-only scripts/configuration/dependencies that are no longer needed, and refresh only the affected lockfile entries; verify `pnpm install --frozen-lockfile` and `pnpm --filter @manawg/web test -- --list` both exit zero.
- [x] 2.2 Remove or migrate obsolete runner-specific test files without deleting Playwright coverage, preserving the existing E2E helper conventions; verify `rg -n "vitest|from ['\"]vitest|@vitejs/plugin-react|jsdom" package.json apps/web/package.json apps/web --glob '!e2e/**'` returns no supported-workflow references and `git diff --check` is clean.

## 3. Keep fixture verification deterministic

- [x] 3.1 Make the fixture command and Playwright web-server path set the declared database-down/fixture boundary explicitly, clear real database URLs, and avoid production credentials; verify `pnpm --filter @manawg/web test:e2e:fixtures -- --list` enumerates the fixture suite without requiring a live database.
- [x] 3.2 Preserve or add browser scenarios for launch, dashboard, chores, expenses, calendar, shopping, and notice-board flows using the existing fixture helpers and per-test API interception; verify the fixture command returns non-zero when a selected scenario fails and produces a fixture-mode report.
- [x] 3.3 Make fixture logs or reports expose that the run used fixture mode and its local base origin without exposing environment values; verify a completed CI-style fixture run can be distinguished from Preview evidence by reading its report metadata.

## 4. Protect authenticated Preview verification

- [x] 4.1 Validate the Preview target from the Vercel-created `Preview` deployment-status event before protected credentials enter the test process, requiring the canonical `^https://manawg-[a-z0-9-]+-abditubes-projects\.vercel\.app$` origin and rejecting userinfo, ports, unexpected paths, query strings, fragments, and other actors/environments; verify an invalid target exits non-zero before authenticated tests start.
- [x] 4.2 Check out trusted `main`, compare its resolved commit with the event deployment source revision, and reject event-supplied refs or fork revisions before requiring QA credentials and the automation-bypass secret from the protected CI environment; verify mismatched revisions and missing credentials fail before Playwright starts and secret values are absent from logs.
- [x] 4.3 Moved to docs/release-checklist.md (Offene Hosted-Nachweise); hosted proof is an owner action.
- [x] 4.4 Moved to docs/release-checklist.md (Offene Hosted-Nachweise); hosted proof is an owner action.

## 5. Integrate and verify the gates

- [x] 5.1 Wire only the fixture and protected Preview jobs in `.github/workflows/ci.yml`, preserving the concurrent agent's database/release jobs and existing Node 22/pnpm constraints; verify the workflow parses and each job has the expected dependency, environment, exact-SHA ordering, and failure behavior after the release-agent handoff.
- [x] 5.2 Run the final local gates from `/Users/abu/Company/manawg-app`: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm --filter @manawg/web bundle:check`, and `pnpm --filter @manawg/web test:e2e:fixtures`; verify all pass on the final shared snapshot and retain the exact results for review.
- [x] 5.3 Validate this change with `openspec validate "establish-playwright-verification" --type change --strict --no-interactive`; verify the command reports the change as valid before marking this task complete.
