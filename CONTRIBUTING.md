# Contributing to ManaWG

Thanks for helping. Bug reports, fixes and improvements are welcome, in English or German.

## Before you start

- **Bugs:** open an [issue](https://github.com/Abuarchiv/manawg-app/issues/new/choose) with steps
  to reproduce. For security problems use [SECURITY.md](SECURITY.md) instead.
- **Small fixes** (typos, obvious bugs): open a pull request directly.
- **Features and larger changes:** open an issue first and wait for a maintainer's answer. ManaWG
  is deliberately small and phone-first, so not every good idea fits. Larger accepted changes
  start as an [OpenSpec](https://github.com/Fission-AI/OpenSpec) proposal under
  `openspec/changes/`.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need Node 22 and pnpm 9 (`corepack enable`). The full Playwright suite runs against in-memory
fixtures, so you need no database for most work:

```sh
pnpm install
pnpm --filter @manawg/web test:e2e:fixtures
```

For a running app with real sign-in, use your own Supabase project, never a production one. Setup,
all commands and the test gates are in [docs/development.md](docs/development.md).

## Pull requests

1. Fork the repository, branch from `main` and keep the change focused on one thing.
2. Run the gates locally; CI runs the same on every pull request:

   ```sh
   pnpm lint && pnpm --filter @manawg/web lint
   pnpm knip
   pnpm typecheck
   pnpm --filter @manawg/web test:unit
   pnpm build
   pnpm --filter @manawg/web test:e2e:fixtures
   ```

3. Describe what changed and why, and how you tested it. Add screenshots for UI changes at a
   320 px and a 390 px wide viewport, light and dark.
4. Sign off every commit (`git commit -s`), see [Developer Certificate of Origin](#developer-certificate-of-origin).

A maintainer reviews and merges. Write the pull request title as one sentence that says what the
change does.

## Code conventions

`apps/web/scripts/check-architecture.mjs` (part of `lint` and CI) enforces most of these. Layers
and their reasons are in [docs/architecture.md](docs/architecture.md).

- **Layers:** `app → fixtures → composition → features → components → core → shared`. Each layer
  imports only layers to its right. A feature never imports another feature; cross-feature reads
  go through `src/composition/`.
- **File size:** source files stay under 400 lines, test files under 800. Split along
  responsibilities.
- **Comments** are English and describe the code as it is, not its history.
- **Hooks** live in kebab-case files (`use-foo.ts`).
- **Tests:** unit tests are `*.test.ts` next to the module or in `apps/web/tests/` and run on
  `node:test`; mock with `mock.module`. End-to-end specs are `e2e/*.spec.ts` and only cover what
  needs a browser or a running server. A bug fix comes with a regression test at the cheapest
  level that catches it.
- **UI:** the app is phone-first, with one column on every screen size. Follow the
  [design language](docs/brand/design-language.md) and check light and dark mode.
- **Dependencies:** reuse what is installed. A new dependency needs a reason in the pull request.
- **Secrets:** never commit `.env` files, keys or connection strings, not even in tests.

## Developer Certificate of Origin

Every commit must be signed off. With `Signed-off-by: Your Name <you@example.com>` (added by
`git commit -s`) you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/):
that you wrote the change or have the right to submit it under the project's license.

## License

By contributing you agree that your contribution is licensed under the
[GNU Affero General Public License v3.0](LICENSE).
