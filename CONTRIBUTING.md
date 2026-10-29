# Contributing to ManaWG

Thanks for helping. Bug reports, fixes, documentation and improvements are welcome. You do not
need to be a developer to report a problem or fix a typo.

## Before you start

- **Questions** and ideas you want to talk through first: [Discussions](https://github.com/Abuarchiv/manawg/discussions).
- **First contribution:** issues labelled
  [good first issue](https://github.com/Abuarchiv/manawg/labels/good%20first%20issue) are
  small and well described; [help wanted](https://github.com/Abuarchiv/manawg/labels/help%20wanted)
  marks larger ones. Comment on the issue before you start, so nobody works on it twice. If none
  are open, ask in Discussions or open an issue.
- **Bugs and self-hosting problems:** open an
  [issue](https://github.com/Abuarchiv/manawg/issues/new/choose) with steps to reproduce. For
  security problems use [SECURITY.md](SECURITY.md) instead.
- **Small fixes** (typos, obvious bugs): open a pull request directly.
- **Features and larger changes:** open an issue first and agree on the approach with a
  maintainer before you write the code. ManaWG is deliberately small and phone-first, so not every
  good idea fits.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Run it locally in five minutes

You need Node 22 and pnpm 9 on Linux, macOS, or Windows via WSL2; the package scripts assume a
POSIX shell. No database and no accounts: fixture mode serves sample WGs from memory.

```sh
git clone https://github.com/<you>/manawg.git   # your fork
cd manawg
corepack enable                                     # provides pnpm 9
pnpm install
pnpm --filter @manawg/web dev:fixtures
```

Open [localhost:3000/wg/MTE8PZAT](http://localhost:3000/wg/MTE8PZAT): a sample WG with
expenses, chores and a shopping list. Code changes reload in the browser. Sign-in and saving
need a real backend. Test changes behind sign-in against your own Supabase project with
`pnpm dev`, or end to end with the Docker stack from the
[self-hosting guide](docs/self-hosting.md) (`docker compose up -d --build` builds your checkout;
no hot reload).

All commands and tests are in [docs/development.md](docs/development.md).

## Your first pull request

1. Pick an open issue (for example one labelled
   [good first issue](https://github.com/Abuarchiv/manawg/labels/good%20first%20issue), if
   there is one) or open one describing your change, and comment that you are on it.
2. Create a branch in your fork: `git switch -c fix-shopping-list-sort`. Keep the change focused
   on one thing.
3. Make the change. A bug fix comes with a test that fails without it (see
   [Code conventions](#code-conventions)).
4. Run the quick checks:

   ```sh
   pnpm lint && pnpm typecheck && pnpm --filter @manawg/web test:unit
   ```

   CI additionally runs `pnpm knip`, `pnpm --dir apps/web analytics:check`, the schema-drift
   check, `pnpm build` and the Playwright suite (`pnpm --filter @manawg/web test:e2e:fixtures`).
   Run the Playwright suite too if you touched a UI or a route. Once per machine:
   `pnpm --filter @manawg/web exec playwright install chromium` (on Linux add `--with-deps`).
   The suite builds the app first and takes a few minutes.
5. Commit and push to your fork.
6. Open the pull request against `main`. Its title is one sentence that says what the change
   does; the template asks what changed, why, and how you tested it. Add screenshots for UI
   changes at a 320 px and a 390 px wide viewport, light and dark.

A maintainer reviews, may ask for changes, and merges. Stuck at any step? Ask in the pull request
or in [Discussions](https://github.com/Abuarchiv/manawg/discussions).

## Code conventions

`apps/web/scripts/check-architecture.mjs` and `check-wg-auth-invariant.mjs` are part of
`pnpm lint` and CI; the first enforces most of these. Layers and their reasons are in
[docs/architecture.md](docs/architecture.md).

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
  New user-visible text goes into both catalogs (`de` and `en`).
- **Dependencies:** reuse what is installed. A new dependency needs a reason in the pull request.
- **Secrets:** never commit `.env` files, keys or connection strings, not even in tests.

## Texts and translations

User-facing text lives in `apps/web/src/shared/i18n/messages/{de,en}/*.ts`, never in components.
Every key needs both locales. English wording follows
[docs/brand/glossary-en.md](docs/brand/glossary-en.md). The `i18n-literal` check fails on German
UI copy outside the catalogs; `// i18n-ignore <reason>` is only for technical literals. Server
texts (push, mail, export, activity) use the recipient's language.

## License

Contributions are licensed under the [Apache License 2.0](LICENSE), as section 5 of the license
provides. There is no CLA and no sign-off requirement.
