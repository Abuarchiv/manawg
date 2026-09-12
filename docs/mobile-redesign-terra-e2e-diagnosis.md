# Mobile redesign E2E diagnosis (read-only)

Date: 2026-09-05

## Scope

One requested fixture target only; no source, test, or Git changes. Node was pinned to
`/opt/homebrew/opt/node@22/bin` and reported `v22.23.2`. The diagnosis was stopped before
any further retry or full suite.

## Commands and captured output

Requested form (first attempt):

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= \
  gtimeout 180s pnpm --filter @manawg/web run test:e2e:fixtures e2e/mobile-shell.spec.ts \
  -- --timeout=15000 --retries=0 --reporter=line
```

Captured script expansion:

```text
playwright test "e2e/mobile-shell.spec.ts" "--" "--timeout=15000" "--retries=0" "--reporter=line"
```

This inserts a literal `--` before the Playwright flags, so they are not parsed as
options. The process was stopped once that was observed, before its 300-s test-level
timeout/retry path could run. Its WebServer output contained only repeated:

```text
[WebServer] Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
```

The first pnpm syntax correction still used `run` and failed before a browser test because
the deliberately stopped attempt had left its WebServer on port 3101:

```text
Error: http://localhost:3101 is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.
Exit status 1
[outer-exit] 1
```

After that listener was terminated, the direct equivalent (same fixture environment and
Playwright config) was started:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= \
  CI=true E2E_FIXTURE_MODE=true NEXT_PUBLIC_E2E_FIXTURE_MODE=true NEXT_PUBLIC_DB_DOWN=true \
  POSTGRES_URL= DATABASE_URL= PLAYWRIGHT_USE_BUILD=true \
  gtimeout 180s pnpm --filter @manawg/web exec playwright test e2e/mobile-shell.spec.ts \
  --timeout=15000 --retries=0 --reporter=line
```

Its captured output before diagnosis was stopped was again only the `NO_COLOR` WebServer
warning. It reached the config's fixture build/start stage, but did not print a test result,
failing URL, locator, page-console message, or outer exit before it was stopped.

## Evidence and classification

- Current fixture server path: Playwright config builds and starts the isolated fixture
  server on `http://localhost:3101` (`PLAYWRIGHT_USE_BUILD=true`).
- Current fixture data supports share code `MTE8PZAT` and the seeded member; no failing
  route response was observed.
- There is no current `test-results` output from this diagnosis.
- Existing `playwright-report` artifacts are stale relative to the current spec and must
  not be treated as this run's result. They record older locator failures for exact
  `Kalender` and `Zurück zum Dashboard`; the current spec instead requests
  `Termine im Kalender öffnen` and `Zurück zu Dashboard`.

Conclusion: this is a **Playwright invocation/wrapper timeout issue**, not evidence of a
current UI contract defect or fixture-data/route failure. The requested `pnpm run` form
does not forward flags as intended, and `mobile-shell.spec.ts` also sets a 300000-ms
test-level timeout, defeating a CLI-only short timeout even with a correctly parsed CLI.

## Minimal recommendation for Luna

1. For immediate diagnosis, invoke Playwright directly via `pnpm --filter @manawg/web exec
   playwright test ...` with the same fixture environment; do not put a literal `--` between
   the spec and Playwright flags.
2. In `apps/web/e2e/mobile-shell.spec.ts`, remove the unconditional
   `test.setTimeout(300_000)` (or make it explicitly opt-in). Then the configured/CLI
   `--timeout=15000` is an effective bound and the retry helper cannot turn a focused run
   into a long wrapper wait.
