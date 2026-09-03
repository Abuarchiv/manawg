## Context

See `proposal.md` for the motivation. The web application already has Playwright E2E helpers, fixture-mode guards, local/Preview base-URL handling, and CI lanes, but their trust boundaries are not yet one explicit contract. The checkout is concurrently changing release and database files, so this design limits implementation to test selection, Preview safety, and evidence.

## Goals / Non-Goals

**Goals:**

- Give contributors and CI one canonical Playwright entry point.
- Keep fixture verification deterministic and visibly separate from deployed-backend evidence.
- Gate protected Preview credentials on validated deployment provenance.
- Make authenticated Preview results identifiable and safe to repeat.

**Non-Goals:**

- Changing database schema, migration scripts, migration locking, or migration ownership.
- Changing production deployment or release approval policy.
- Replacing the application's existing authentication, API authorization, or data model.
- Adding broad backend integration coverage to compensate for every removed unit test.

## Decisions

### Keep one browser runner

Playwright remains the supported application verification runner, with package scripts and CI invoking it directly. Keeping Vitest alongside it would preserve a second lifecycle and make a green result ambiguous; adding another runner is not justified by the requested browser-level contract.

### Separate fixture and Preview lanes by explicit mode

Fixture runs will use the existing deterministic E2E boundary and local/build configuration. Preview runs will use a separate protected command or CI lane with an explicit deployed base origin. A single mode-switching command would make it too easy to mistake fixture success for real-service evidence.

### Validate the target before loading secrets

The Preview job will parse and validate the deployment-status payload before the test process receives QA credentials or an automation-bypass secret. The repository-owned canonical host pattern is `^https://manawg-[a-z0-9-]+-abditubes-projects\.vercel\.app$`; validation also requires a Vercel-created `Preview` event, HTTPS, and no userinfo, port, unexpected path, query string, or fragment. Accepting arbitrary event-supplied URLs was considered and rejected because host checks alone are not a credential boundary.

### Use trusted test code and disposable QA activity

The protected lane will check out the repository's trusted `main` state, compare its resolved commit with the deployment payload's source revision, and refuse to run if they differ; it will never execute an event-supplied ref or fork revision in the secrets-bearing job. It will use a dedicated QA identity, a unique run-tagged namespace, and mandatory cleanup before passing. A shared persistent account, ordinary user data, or optional cleanup was considered and rejected because failed runs would create durable cross-run coupling.

### Emit bounded evidence

CI output will identify the execution mode, validated origin, deployment identifier, source revision, and result while relying on CI secret masking and never echoing secret values. The result will remain a gate: target, source, authentication, flow, and cleanup failures return non-zero. This gives reviewers a small, auditable evidence record without building a new reporting service.

## Risks / Trade-offs

- [Fixture coverage can miss backend or provider regressions] → Keep the fixture lane explicitly labeled and require the protected Preview smoke for deployed-backend evidence; database-specific coverage remains a separate change owned by the release/database work.
- [Preview data cleanup can fail after a test crash] → Use a unique run namespace, require cleanup for a passing lane, and report the namespace on failure so remediation cannot be confused with success.
- [Deployment-status events can arrive out of order or point at an unavailable Preview] → Fail closed on event, URL, deployment-id, and source-revision validation and let the lane report an actionable non-zero failure.
- [Concurrent release edits may change the files this plan targets] → Rebase the implementation against the final release/database state and re-run the OpenSpec status and verification gates before applying tasks.

## Migration Plan

1. After the concurrent release/database work reaches a stable handoff, compare its final CI, package, and Playwright changes with this design and resolve overlap before implementation.
2. Apply the tasks in small commits, first establishing the runner contract, then fixture coverage, then protected Preview verification.
3. Run local lint, boundary checks, typecheck, build, bundle checks, and fixture E2E; run Preview verification only in its protected environment.
4. Roll back by reverting the test-runner/Preview-lane changes as one change if a gate is unreliable; no database rollback is part of this change.
