# ManaWG

The app for shared flats: split expenses, plan cleaning, keep a shopping list. Free, without ads,
in the browser and installable as a PWA.

**Use it:** [app.manawg.com](https://app.manawg.com) · **Host it yourself:** [self-hosting guide](docs/self-hosting.md)

[![CI](https://github.com/Abuarchiv/manawg-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Abuarchiv/manawg-app/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<p>
  <img src="docs/screenshots/start.png" width="24%" alt="WG overview">
  <img src="docs/screenshots/ausgaben.png" width="24%" alt="Expenses">
  <img src="docs/screenshots/putzplan.png" width="24%" alt="Cleaning schedule">
  <img src="docs/screenshots/einkauf.png" width="24%" alt="Shopping list">
</p>

## Features

- **Expenses:** split evenly or by custom amounts, see who owes whom, settle up with the fewest
  transfers, recurring costs, monthly statement by mail, receipt scan (OCR in the browser),
  import from Splitwise.
- **Cleaning schedule:** rotating chores, absences, reminders.
- **Shopping list and supplies:** shared by the whole WG, also usable offline.
- **Calendar, chat and pinboard:** shared dates with an iCal feed, a WG chat and notes that
  disappear once they are done.
- **Privacy:** no ads, no tracking cookies, export of all WG data as JSON or CSV, account
  deletion. The official instance runs in Frankfurt.

The interface is German. Amounts are in euros.

## Self-hosting

ManaWG runs on Vercel and Supabase; the free tiers are enough for a household. The
[self-hosting guide](docs/self-hosting.md) walks through the setup step by step.

## Development

```sh
corepack enable
pnpm install
pnpm --filter @manawg/web test:e2e:fixtures   # full Playwright suite, no database needed
```

Next.js 15, React 19, Supabase Auth, PostgreSQL with Drizzle, Tailwind 4 with shadcn/Base UI.

- [CONTRIBUTING.md](CONTRIBUTING.md): how to propose changes and the code conventions
- [docs/development.md](docs/development.md): local setup, commands, tests, CI
- [docs/architecture.md](docs/architecture.md): how the app is structured

## Security

Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## License

The code is licensed under the [Apache License 2.0](LICENSE): use it, change it and build on it,
also commercially. Keep the license and the [NOTICE](NOTICE) file with your copy.

"ManaWG" and the ManaWG logo are not covered by this license, see [TRADEMARK.md](TRADEMARK.md).

---

## Auf Deutsch

ManaWG ist die WG-App für Ausgaben, Putzplan und Einkaufsliste: kostenlos, werbefrei, im Browser
und als App installierbar. Nutzen kannst du sie direkt auf [app.manawg.com](https://app.manawg.com).
Wer die Daten lieber in eigenen Konten hält, kann ManaWG selbst betreiben, siehe die
[Anleitung zum Selbsthosten](docs/self-hosting.md) (auf Englisch). Fehler und Wünsche gerne als
[Issue](https://github.com/Abuarchiv/manawg-app/issues), auf Deutsch oder Englisch.
