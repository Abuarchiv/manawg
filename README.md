# ManaWG

The app for shared flats: split expenses, plan cleaning, keep a shopping list. Free, without ads,
in the browser and installable as a PWA.

**Use it:** [app.manawg.com](https://app.manawg.com) · **Host it yourself:** [self-hosting guide](docs/self-hosting.md)

[![CI](https://github.com/Abuarchiv/manawg-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Abuarchiv/manawg-app/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Abuarchiv/manawg-app/badge)](https://scorecard.dev/viewer/?uri=github.com/Abuarchiv/manawg-app)

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

With Docker, a whole instance (app, database, sign-in, image storage) runs on your own machine:

```sh
git clone https://github.com/Abuarchiv/manawg-app.git
cd manawg-app
./docker/setup.sh            # creates .env with fresh secrets
docker compose up -d
```

Open [http://localhost](http://localhost) and create an account; the sign-in code arrives in
Mailpit at [http://localhost:8025](http://localhost:8025). The
[self-hosting guide](docs/self-hosting.md) covers a public instance with your own domain and
HTTPS, mail, updates, backups, and the alternative setup on Vercel and Supabase.

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

Questions and ideas are welcome in [Discussions](https://github.com/Abuarchiv/manawg-app/discussions).
Looking for a place to start? Try an issue labelled
[good first issue](https://github.com/Abuarchiv/manawg-app/labels/good%20first%20issue).

## Security

Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## License

The code is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a
modified version as a network service, you must offer its source code to its users.

"ManaWG" and the ManaWG logo are not covered by this license, see [TRADEMARK.md](TRADEMARK.md).

---

## Auf Deutsch

ManaWG ist die WG-App für Ausgaben, Putzplan und Einkaufsliste: kostenlos, werbefrei, im Browser
und als App installierbar. Nutzen kannst du sie direkt auf [app.manawg.com](https://app.manawg.com).
Wer die Daten lieber selbst hält, startet ManaWG mit Docker auf dem eigenen Rechner oder Server,
siehe oben und die [Anleitung zum Selbsthosten](docs/self-hosting.md) (auf Englisch). Fehler und Wünsche gerne als
[Issue](https://github.com/Abuarchiv/manawg-app/issues), auf Deutsch oder Englisch.
