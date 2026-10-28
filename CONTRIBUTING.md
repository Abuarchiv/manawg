# Contributing to ManaWG

Thanks for helping. Bug reports, fixes, documentation and improvements are welcome, in English or
German. You do not need to be a developer to report a problem or fix a typo.

## Before you start

- **Questions** and ideas you want to talk through first: [Discussions](https://github.com/Abuarchiv/manawg-app/discussions).
- **First contribution:** issues labelled
  [good first issue](https://github.com/Abuarchiv/manawg-app/labels/good%20first%20issue) are
  small and well described; [help wanted](https://github.com/Abuarchiv/manawg-app/labels/help%20wanted)
  marks larger ones. Comment on the issue before you start, so nobody works on it twice.
- **Bugs and self-hosting problems:** open an
  [issue](https://github.com/Abuarchiv/manawg-app/issues/new/choose) with steps to reproduce. For
  security problems use [SECURITY.md](SECURITY.md) instead.
- **Small fixes** (typos, obvious bugs): open a pull request directly.
- **Features and larger changes:** open an issue first and wait for a maintainer's answer. ManaWG
  is deliberately small and phone-first, so not every good idea fits. For larger changes, agree
  on the approach in the issue before you write the code; accepted ones may start as an
  [OpenSpec](https://github.com/Fission-AI/OpenSpec) proposal in `openspec/changes/`.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Run it locally in five minutes

You need Node 22 and pnpm 9. No database and no accounts: fixture mode serves sample WGs from
memory.

```sh
git clone https://github.com/<you>/manawg-app.git   # your fork
cd manawg-app
corepack enable                                     # provides pnpm 9
pnpm install
pnpm --filter @manawg/web dev:fixtures
```

Open [localhost:3000/wg/MTE8PZAT](http://localhost:3000/wg/MTE8PZAT): a sample WG with
expenses, chores and a shopping list. Code changes reload in the browser. Sign-in and saving
need a real backend; for that, start the Docker stack from the
[self-hosting guide](docs/self-hosting.md) (`docker compose up -d --build` builds your checkout).
All commands and tests are in [docs/development.md](docs/development.md).

## Your first pull request

1. Pick an issue, for example a
   [good first issue](https://github.com/Abuarchiv/manawg-app/labels/good%20first%20issue), and
   comment that you are on it.
2. Create a branch in your fork: `git switch -c fix-shopping-list-sort`. Keep the change focused
   on one thing.
3. Make the change. A bug fix comes with a test that fails without it (see
   [Code conventions](#code-conventions)).
4. Run the quick checks:

   ```sh
   pnpm lint && pnpm typecheck && pnpm --filter @manawg/web test:unit
   ```

   CI also runs `pnpm knip`, `pnpm build` and the Playwright suite
   (`pnpm --filter @manawg/web test:e2e:fixtures`); run those too if you touched the area.
5. Commit and push to your fork.
6. Open the pull request against `main`. Its title is one sentence that says what the change
   does; the template asks what changed, why, and how you tested it. Add screenshots for UI
   changes at a 320 px and a 390 px wide viewport, light and dark.

A maintainer reviews, may ask for changes, and merges. Stuck at any step? Ask in the pull request
or in [Discussions](https://github.com/Abuarchiv/manawg-app/discussions).

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
  [design language](docs/brand/design-language.md) and check light and dark mode. New user-visible text goes into both catalogs (`de` and `en`).
- **Dependencies:** reuse what is installed. A new dependency needs a reason in the pull request.
- **Secrets:** never commit `.env` files, keys or connection strings, not even in tests.

## License

Contributions are licensed under the [Apache License 2.0](LICENSE), as section 5 of the license
provides. There is no CLA and no sign-off requirement.
