## Why

The project is moving verification work toward Playwright, but fixture checks and deployment checks currently have different trust and coverage boundaries. A named contract is needed now so CI can distinguish deterministic local coverage from evidence gathered against an approved Preview deployment without expanding the concurrent database/release work.

## What Changes

- Make Playwright the single supported application test runner and remove obsolete Vitest-only commands and dependencies from the web package.
- Keep fixture E2E runs deterministic and explicit about their database-down boundary.
- Add a protected Preview verification lane that validates the deployment origin before using QA credentials or bypass headers.
- Require the Preview lane to run trusted repository test code against an authenticated deployment and clean up data it creates.
- Record the tested Preview origin and test mode in CI output so release reviewers can identify the evidence.
- Leave database schema, migration scripts, migration ownership, and production release execution out of this change.

## Capabilities

### New Capabilities

- `playwright-test-strategy`: Defines the supported Playwright runner, fixture-mode boundaries, and minimum application-flow coverage.
- `preview-verification`: Defines the trust, credential, origin, cleanup, and evidence requirements for authenticated Preview checks.

### Modified Capabilities

None.

## Impact

Affected areas are the web package scripts and development dependencies, Playwright configuration and E2E specs, and the CI workflow that starts fixture and Preview verification. No product API, database schema, migration implementation, or deployment ownership changes are included; those remain with the concurrently running release/database work.
