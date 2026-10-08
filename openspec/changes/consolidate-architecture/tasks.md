## 1. Layering

- [x] 1.1 Move `core/reads/*` to `src/composition/`; update imports. `core/activity-feed.ts` stays in core: it imports only core, and features call it.
- [x] 1.2 Extend the boundary check to the full layer matrix.

## 2. Data access and identity

- [x] 2.1 One pool and one module for `db` and `withTransaction`.
- [x] 2.2 Remove the member token, `verified`, `requireVerifiedMember`, `isVerifiedWgAdmin`, `checkWgAdminAccess` and client `member_not_verified` branches.
- [x] 2.3 Typed failure reason from `requireMember`; drop response-JSON sniffing.

## 3. HTTP and idempotency

- [x] 3.1 One error-helper set (`HTTP` defined once, no numeric literals) and `parseBody(schema)`.
- [x] 3.2 `withIdempotentWrite`; migrate every route; remove `ReplayCache` and the Upstash slot.
- [x] 3.3 Remove nested catch-alls inside `withWgRoute`; split oversized handlers.

## 4. Fixture mode

- [x] 4.1 Isolate E2E db-down branches behind one seam.

## 5. Client

- [x] 5.1 `useSyncedCollection` and one online/visibility subscription; migrate shopping, chores, inventory, pinnwand.
- [x] 5.2 Chore completion implemented once.
- [x] 5.3 Split the dashboard page, `ImportWizard`, the shopping and chat hooks.
- [x] 5.4 One component tree; remove `components/neu` and `shared/components/ui`.
- [x] 5.5 Replace Zustand in the toast store; drop the dependency.

## 6. Tests

- [x] 6.1 Shared unit-test loader; migrate all `vm`/`transpileModule` tests.
- [x] 6.2 Replace source-text extraction tests with tests of extracted pure modules.
- [x] 6.3 Move pure tests out of `e2e/`; replace SQL-text assertions with behaviour assertions.

## 7. Structure and comments

- [x] 7.1 Split features into `server/` (with `server-only`) and client modules.
- [x] 7.2 English-only comments; remove history narration and stray notes.
- [x] 7.3 Split `scripts/db-migrate.mjs` into modules.

## 8. Guardrails and docs

- [x] 8.1 `scripts/check-architecture.mjs` in lint and CI.
- [x] 8.2 Conventions in `AGENTS.md`; update `docs/architecture.md` and `README.md`.

## 9. Verification

- [ ] 9.1 Lint, typecheck, unit, build, bundle check and full fixture e2e pass; exact results in the PR.
