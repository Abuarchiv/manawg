## What and why

<!-- One or two sentences. Link the issue: Fixes #123 -->

## How it was tested

<!-- Commands you ran, devices or browsers you checked. -->

## Screenshots

<!-- UI changes only: 320 px and 390 px wide, light and dark. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm --filter @manawg/web test:unit` pass
- [ ] `pnpm build` passes, and the e2e suite if the change touches the UI or a route
- [ ] A bug fix has a regression test, or the description says why not
- [ ] No secrets, `.env` files or connection strings in the diff

CI additionally runs `pnpm knip`, `pnpm --dir apps/web analytics:check`, the schema-drift check and the Playwright suite.
