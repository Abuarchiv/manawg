# Terra Medium Final Gate Review — Mobile Redesign

## Superseding direct fixture E2E run — 2026-09-05

This section supersedes the earlier fixture-E2E conclusion below. No source,
test, Git, dependency, or deployment changes were made for this run.

Ports 3101–3103 were free before each invocation. The direct runs used
`PATH=/opt/homebrew/opt/node@22/bin:$PATH` (Node `v22.23.2`), the existing
Playwright `workers: 1` configuration, cleared Upstash variables, and:

```sh
PLAYWRIGHT_USE_BUILD=true E2E_PORT=3101 CI=true E2E_FIXTURE_MODE=true NEXT_PUBLIC_E2E_FIXTURE_MODE=true NEXT_PUBLIC_DB_DOWN=true POSTGRES_URL= DATABASE_URL= pnpm exec playwright test e2e/mobile-shell.spec.ts --retries=0 --reporter=line
```

Focused result: exit `0`; `2 passed (36.8s)`. Exact output and exit are in
`/tmp/manawg-mobile-redesign-terra-focused.log` and
`/tmp/manawg-mobile-redesign-terra-focused.exit`.

The direct complete fixture command was then started with the same environment
and `pnpm exec playwright test --retries=0 --reporter=line` (outer limit 1,800
seconds). It was explicitly stopped after test 36's failure; Playwright had
already announced tests 37 and 38, but produced no final suite count: exit
`130`, with 15 reported failures. Exact partial output and exit are in
`/tmp/manawg-mobile-redesign-terra-full.log` and
`/tmp/manawg-mobile-redesign-terra-full.exit`.

The shared root cause for the stop is test 36,
`e2e/chores-retry.spec.ts:1499`: its absence flow waited the full 300,000 ms
for `getByPlaceholder('Grund optional')` at line 1543. `AbsencePanel` no
longer renders that placeholder. This is a stale test/UI contract, not a
mobile-shell failure. The associated 3101 web-server process was stopped and
ports 3101–3103 were verified free afterward.

**Current decision: focused mobile-shell gate passes; complete fixture suite is
inconclusive because it was manually interrupted after the confirmed
`Grund optional` contract failure. No further suite was run.**

Completion: no fixture-suite processes remain. This report is final for the
interrupted run; no further analysis was performed.

## Current stopped complete-fixture run — 2026-09-05

This supersedes the preceding complete-suite status. The focused direct command
was rerun from `apps/web` with Node `v22.23.2`, cleared
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, existing `workers: 1`,
and isolated `NEXT_DIST_DIR`; it exited `0`: **2 passed (36.2s)**. Exact output
and exit are `/tmp/manawg-mobile-redesign-terra-focused-20260905-rerun.log`
and `/tmp/manawg-mobile-redesign-terra-focused-20260905-rerun.exit`.

The complete direct suite began with the same environment, `--retries=0`,
`--reporter=line`, and an outer `gtimeout 1800s`. It was intentionally stopped
on request, not timed out: exit **`143`** (SIGTERM). It reached test **17/224**
and emitted five failure reports; Playwright produced no final pass/fail count.
The web-server child was also stopped, and port 3101 was verified free. Exact
partial output and exit are `/tmp/manawg-mobile-redesign-terra-full-20260905-rerun.log`
and `/tmp/manawg-mobile-redesign-terra-full-20260905-rerun.exit`.

Observed failures before the stop:

1. `abos-races-audit.spec.ts:85` waited 30s for button `Internet pausieren`.
   **Stale selector/contract:** redesigned `AboRow` renders a semantic switch.
2. `abos-races-audit.spec.ts:101` waited 30s for the exact `Löschen` button in
   a dialog. **Stale selector/contract indicated; behavior was not exercised.**
3. `activity-retry.spec.ts:179` could not find link `Ausgabe eintragen`.
   **Stale selector/contract indicated; behavior was not exercised.**
4. `chores-retry.spec.ts:201` could not find menu `Aufgabenaktionen: Bad putzen`.
   **Stale selector/contract indicated; behavior was not exercised.**
5. `chores-retry.spec.ts:276` could not find menu `Aufgabenaktionen: Küche wischen`.
   **Stale selector/contract indicated; behavior was not exercised.**

Test 17 (`chores-retry.spec.ts:334`) was in progress at interruption and did
not produce a result. No real product-behavior regression was demonstrated by
this partial run. **Decision: the focused mobile-shell gate passes; the
complete fixture suite remains incomplete and is not an approval gate until
the stale contracts are reconciled. No further suite was run.**

Date: 2026-09-05
Worktree: `/Users/abu/Company/manawg-app-mobile-redesign`
Branch: `codex/mobile-shadcn-redesign-20260905`

Scope: final serialized verification and static review only. No source, test, Git, deployment, payment, or dependency changes were made. This report is the only requested edit.

Toolchain: `PATH=/opt/homebrew/opt/node@22/bin:$PATH`; Node `v22.23.2`; pnpm `9.0.0`. Each pnpm command emitted the existing warning that pnpm 9 ignores the package-level `pnpm.overrides` field.

## Fresh gate evidence

| Command | Exact observed exit | Relevant result |
| --- | ---: | --- |
| `pnpm lint` | 0 | Biome checked 447 files; no fixes or diagnostics. |
| `pnpm --filter @manawg/web lint` | 0 | Biome checked 438 files; feature-boundary check passed for 7 features with no cross-feature imports. |
| `pnpm typecheck` | 0 | Recursive `tsc --noEmit` completed. |
| `pnpm build` | 0 | Next `15.5.24` compiled, type-checked, generated all 16 static pages, collected build traces, and finalized optimization. Exit was captured from the persistent interactive shell. Shared first-load JS: 104 kB raw in Next output. |
| `pnpm --filter @manawg/web bundle:check` | 0 | 21/98 renderable entries; shared first-load gzip JS 101.5 kB / 120 kB. All budgets passed. Top route-specific gzip JS: chat 26.6 kB, calendar 22.4 kB, expenses 21.2 kB, chores 17.9 kB, subscriptions 17.3 kB. |
| `pnpm --filter @manawg/web analytics:check` | 0 | `analytics privacy check passed`. |
| `git diff --check` | 0 | No whitespace errors. |

## Fixture E2E evidence

The focused command was eligible because the fresh build shell exit was observed as `0`:

```sh
UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= pnpm --filter @manawg/web run test:e2e:fixtures e2e/mobile-shell.spec.ts
```

Playwright used the existing isolated configuration: `NEXT_DIST_DIR=.next-e2e-3101`, port 3101, and `workers: 1`. It ran 2 tests, each with the CI retry policy (3 attempts total), and ended with shell exit `1`: 2 failed, 0 passed.

1. `dashboard and subpage fit mobile width with bottom navigation` failed at `apps/web/e2e/mobile-shell.spec.ts:81` on all 3 attempts. It waited 30,000 ms for `getByRole('link', { name: 'Kalender', exact: true })`; no such link was rendered. The inspected failure screenshot shows the calendar destination as the icon link labelled `Termine im Kalender öffnen`.
2. `all primary WG pages avoid horizontal overflow on mobile` failed at `apps/web/e2e/mobile-shell.spec.ts:151` on all 3 attempts. It waited 30,000 ms for `getByRole('link', { name: 'Zurück zum Dashboard' })`; no such link was rendered. `BackLink` renders `Zurück zu Dashboard` for this route.

The server also logged expected fixture-mode degradation for unset Upstash rate limiting, VAPID, and S3 credentials. Those notices are not live-provider claims and did not cause these selector failures.

The complete fixture suite was **not run**, as required: the focused fixture command did not pass.

## Static review

Reviewed the current 141-file mobile-redesign diff (14,162 insertions, 9,264 deletions), the navigation/component changes implicated by the E2E result, the generated report files, and the gate scripts.

- P0: none found.
- P1: the mobile-shell fixture's accessible navigation contract is stale against the current rendered UI. Both selectors fail deterministically after the redesign renamed the calendar and dashboard-back accessible labels. This blocks the requested test gate and needs an explicit source/test contract decision before release approval.
- P2: none found beyond the P1 selector-contract mismatch.

All mobile-redesign handoff reports were inspected. They consistently describe source-handoff scope and deferred integration verification; none replaces this fresh gate evidence.

## Gate decision

**BLOCK — no final approval.** Lint, web lint, typecheck, build, bundle budget, analytics, and whitespace gates passed freshly. Focused mobile fixture E2E failed 2/2 tests (6 attempted executions including retries), so the complete fixture suite was correctly skipped. No production, deployment, payment, or Git action is authorized by this review.

## Process completion reconciliation

The focused fixture process has ended. Its actual shell exit was `1`, emitted after Playwright completed all configured retries and printed the two failure reports above. It was not terminated by a timeout or interruption. A post-run process check found no running `test:e2e:fixtures`, Playwright-test, Next build, or Next start process for this worktree; only unrelated Playwright MCP browser services remain. No additional suite was started.

## Current complete-fixture run — stopped on request (2026-09-05)

This section supersedes the earlier statement that no additional suite was
started. No source, test, configuration, dependency, or Git changes were made;
this report is the only edit.

The direct complete suite was launched from `apps/web` with Node `v22.23.2`,
`PATH=/opt/homebrew/opt/node@22/bin:$PATH`, cleared
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, existing isolated
`NEXT_DIST_DIR=.next-e2e-3101`, `workers: 1`, `--retries=0`,
`--reporter=line`, and outer `gtimeout 1800s`:

```sh
pnpm exec playwright test --retries=0 --reporter=line
```

It was intentionally stopped before the outer timeout: exit **`143`**
(SIGTERM), after reaching **29/224**. Playwright therefore printed **no final
passed, failed, or skipped totals**. It had emitted **11 failure reports** at
the stop point. Exact output and the captured exit are
`/tmp/manawg-mobile-redesign-terra-complete-20260905.log` and
`/tmp/manawg-mobile-redesign-terra-complete-20260905.exit`.

First failure locations:

1. `e2e/abos-races-audit.spec.ts:107` — missing exact dialog `Löschen` button.
2. `e2e/activity-retry.spec.ts:201` — missing `Ausgabe eintragen` link.
3. `e2e/chores-retry.spec.ts:26` — the shared `openChoreActions` helper waits
   for `getByRole('menu', { name: 'Aufgabenaktionen: …' })`; this caused the
   repeated Chores failures beginning at specs lines 201 and 276.

The shared Chores finding is a fixture contract mismatch: the redesigned UI
uses a Drawer dialog and buttons, while `chores-retry.spec.ts` still expects a
`menu`/`menuitem` interaction. No remediation was attempted. The Playwright
process and its orphaned Next server were both terminated; ports 3101–3103
were verified free afterward. No further suite will run.

## Final stopped fixture-suite run — 2026-09-05

This supersedes the preceding partial-suite entries. The direct serialized
fixture suite was stopped on request after the shared Chores helper cause was
confirmed; it did not reach a Playwright final summary. The outer timeout did
not fire. The wrapper recorded exit **`143`** (SIGTERM) in
`/tmp/manawg-mobile-redesign-terra-suite-final.log`.

Playwright had started **23/224** tests. It had emitted **7 failure reports**;
there is no valid passed/failed/skipped total for the incomplete run. The
seventh failure confirms the requested common cause:
`e2e/chores-retry.spec.ts:21:63`, `openChoreActions`, waits to click a Drawer
`Schließen` button that is programmatically closed and becomes detached.

Failure locations emitted before the stop:

1. `e2e/abos-races-audit.spec.ts:107:22`
2. `e2e/activity-retry.spec.ts:201:71`
3. `e2e/chores-retry.spec.ts:259:5`
4. `e2e/chores-retry.spec.ts:388:53`
5. `e2e/chores-retry.spec.ts:547:64`
6. `e2e/chores-retry.spec.ts:618:53`
7. `e2e/chores-retry.spec.ts:21:63` (called from `:753:21`)

The suite process group and its port-3101 Next server were terminated with
SIGTERM. A post-stop check found no listener on ports 3101–3103. No source,
test, config, Git, or deployment edit was made; this report entry is the only
change. No further suite will run.

## Complete fixture suite — outer-timeout result (2026-09-05)

This is the final result for the requested direct fixture suite. No source,
test, configuration, Git, dependency, or deployment edit was made; this report
is the only workspace edit.

The suite was started from `apps/web` using Node `v22.23.2`,
`PATH=/opt/homebrew/opt/node@22/bin:$PATH`, cleared Upstash variables,
`PLAYWRIGHT_USE_BUILD=true`, fixture/DB-down environment, port 3101, the
existing isolated `NEXT_DIST_DIR=.next-e2e-3101`, existing `workers: 1`, and:

```sh
gtimeout --foreground -k 30s 1800s pnpm exec playwright test --retries=0 --reporter=line
```

The outer limit ended the process with exact shell exit **`143`**. Playwright
had started **107/224** tests and emitted no final summary. Therefore there is
no complete Playwright passed/failed/skipped total. From the 106 tests that
did finish, **68 passed, 38 failed, 0 skipped**; test 107 was interrupted and
tests 108–224 were not started. Exact output and the appended shell exit are
in `/tmp/manawg-mobile-redesign-terra-suite-final3.log`.

Failure locations (all 38 emitted reports):

1. `e2e/abos-races-audit.spec.ts:101:5`
2. `e2e/activity-retry.spec.ts:179:6`
3. `e2e/chores-retry.spec.ts:201:6`, `:334:6`, `:475:6`, `:550:6`, `:824:6`, `:1209:6`, `:1831:6`, `:1940:6`, `:2003:6`
4. `e2e/dashboard-retry.spec.ts:99:6`
5. `e2e/expenses-retry.spec.ts:184:6`, `:250:6`, `:320:6`, `:394:6`, `:461:6`, `:526:6`, `:599:6`, `:673:6`, `:750:6`, `:824:6`, `:1043:6`, `:1082:6`, `:1742:6`, `:1890:6`, `:2027:6`, `:2101:6`, `:2168:6`
6. `e2e/export-download.spec.ts:20:6`, `:59:6`
7. `e2e/import.spec.ts:14:6`
8. `e2e/kalender.spec.ts:28:6`
9. `e2e/launch-fixture.spec.ts:22:6`
10. `e2e/mahnungen.spec.ts:38:6`
11. `e2e/notifications-settings.spec.ts:20:6`, `:144:6`, `:206:6`

After the exit, ports 3101–3103 had no listener and no matching Playwright or
Next process remained.
