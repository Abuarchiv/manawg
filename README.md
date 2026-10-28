# ManaWG

**One app for your shared flat: split expenses, rotate the cleaning, share the shopping list.**

**Try it:** [app.manawg.com](https://app.manawg.com) · **Host it yourself:** [Docker setup](#host-it-yourself) · **Help build it:** [contributing](#contributing)

[![CI](https://github.com/Abuarchiv/manawg-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Abuarchiv/manawg-app/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Self-host with Docker](https://img.shields.io/badge/self--host-docker%20compose-2496ED?logo=docker&logoColor=white)](#host-it-yourself)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Abuarchiv/manawg-app/badge)](https://scorecard.dev/viewer/?uri=github.com/Abuarchiv/manawg-app)

<p>
  <img src="docs/screenshots/start.png" width="24%" alt="WG overview">
  <img src="docs/screenshots/ausgaben.png" width="24%" alt="Expenses">
  <img src="docs/screenshots/putzplan.png" width="24%" alt="Cleaning schedule">
  <img src="docs/screenshots/einkauf.png" width="24%" alt="Shopping list">
</p>

## Why ManaWG

- **Free, completely.** No paid plan and nothing locked behind one: every feature, any number of
  flatmates, expenses and lists.
- **No ads, no tracking.** No ad networks, no tracking cookies. The app stores what a WG needs and
  nothing more, and you can export all of it as JSON or CSV or delete your account at any time.
- **Made for the phone.** Runs in any browser and installs as an app (PWA), with offline support
  for the shopping list.
- **Yours to run.** Open source under Apache-2.0. Use app.manawg.com, hosted in Frankfurt, or run
  your own with one `docker compose up`.

## Features

- **Expenses:** split evenly or by custom amounts, see who owes whom, settle up with the fewest
  transfers, recurring costs, monthly statement by mail, receipt scan (OCR in the browser),
  import from Splitwise.
- **Cleaning schedule:** rotating chores, absences, reminders.
- **Shopping list and supplies:** shared by the whole WG, also usable offline.
- **Calendar, chat and pinboard:** shared dates with an iCal feed, a WG chat and notes that
  disappear once they are done.

The interface is German. Amounts are in euros.

## Host it yourself

A whole instance (app, database, sign-in, image storage) runs on any machine with Docker:

```sh
git clone https://github.com/Abuarchiv/manawg-app.git
cd manawg-app
./docker/setup.sh            # creates .env with fresh secrets
docker compose up -d
```

The first start builds the app image, which takes about ten minutes. Then open
[http://localhost](http://localhost) and create an account; the sign-in code arrives in Mailpit at
[http://localhost:8025](http://localhost:8025). The
[self-hosting guide](docs/self-hosting.md) covers a public instance with your own domain and
HTTPS, mail, updates, backups, and the alternative setup on Vercel and Supabase.

## Contributing

New contributors are welcome, in English or German, with code, bug reports, translations or
ideas.

- **Start small:** issues labelled
  [good first issue](https://github.com/Abuarchiv/manawg-app/labels/good%20first%20issue) are
  scoped and described for a first pull request.
- **Ask and discuss:** questions and ideas go to
  [Discussions](https://github.com/Abuarchiv/manawg-app/discussions).
- **Run it locally in five minutes,** without a database:

  ```sh
  corepack enable
  pnpm install
  pnpm --filter @manawg/web dev:fixtures
  ```

  Then open [localhost:3000/wg/MTE8PZAT](http://localhost:3000/wg/MTE8PZAT), a sample WG.

[CONTRIBUTING.md](CONTRIBUTING.md) walks through your first pull request.
[docs/development.md](docs/development.md) has all commands and tests,
[docs/architecture.md](docs/architecture.md) explains how the app is structured. Built with
Next.js 15, React 19, Supabase Auth, PostgreSQL with Drizzle and Tailwind 4.

## Security

Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## License

The code is licensed under the [Apache License 2.0](LICENSE): use it, change it and build on it,
also commercially. Keep the license and the [NOTICE](NOTICE) file with every copy.

"ManaWG" and the ManaWG logo are not covered by this license, see [TRADEMARK.md](TRADEMARK.md).

---

## Auf Deutsch

ManaWG ist die WG-App für Ausgaben, Putzplan und Einkaufsliste: komplett kostenlos, ohne Werbung
und ohne Tracking, im Browser und als App installierbar. Nutzen kannst du sie direkt auf
[app.manawg.com](https://app.manawg.com). Wer die Daten lieber selbst hält, startet ManaWG mit
Docker auf dem eigenen Rechner oder Server, siehe [oben](#host-it-yourself) und die
[Anleitung zum Selbsthosten](docs/self-hosting.md) (auf Englisch). Mitmachen ist willkommen:
Fragen und Ideen in den [Discussions](https://github.com/Abuarchiv/manawg-app/discussions),
Fehler und Wünsche als [Issue](https://github.com/Abuarchiv/manawg-app/issues), auf Deutsch oder
Englisch.
