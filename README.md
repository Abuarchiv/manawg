# ManaWG: free, open-source WG app for shared flats

**Split expenses, rotate the cleaning schedule and share the shopping list with your flatmates.**
ManaWG is a free flatshare app (a *WG-App*, from German *Wohngemeinschaft*) for roommates and
house shares. It runs in the browser, installs on your phone like an app, and you can host it
yourself.

**[Try it](https://app.manawg.com)** · **[Self-host](#self-host)** · **[Contribute](#contributing)**

[![CI](https://github.com/Abuarchiv/manawg-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Abuarchiv/manawg-app/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Self-host with Docker](https://img.shields.io/badge/self--host-docker%20compose-2496ED?logo=docker&logoColor=white)](#self-host)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Abuarchiv/manawg-app/badge)](https://scorecard.dev/viewer/?uri=github.com/Abuarchiv/manawg-app)
[![GitHub stars](https://img.shields.io/github/stars/Abuarchiv/manawg-app?style=flat)](https://github.com/Abuarchiv/manawg-app/stargazers)
[![GitHub Discussions](https://img.shields.io/github/discussions/Abuarchiv/manawg-app)](https://github.com/Abuarchiv/manawg-app/discussions)

<p>
  <img src="docs/screenshots/start.png" width="24%" alt="ManaWG home screen with the shared flat overview">
  <img src="docs/screenshots/ausgaben.png" width="24%" alt="ManaWG expenses: who paid what and who owes whom">
  <img src="docs/screenshots/putzplan.png" width="24%" alt="ManaWG cleaning schedule with rotating chores">
  <img src="docs/screenshots/einkauf.png" width="24%" alt="ManaWG shared shopping list">
</p>

The interface is in German for now, as shown above. Amounts are in euros.

## Why ManaWG

Bill splitters like Splitwise cover the money, chore charts cover the cleaning. ManaWG puts what a
shared flat needs in one place, as a free Splitwise alternative that also plans the cleaning.

- **Free.** No paid plan and no locked features.
- **No ads, no tracking cookies.** The app stores what a flat needs and nothing more. You can
  export a WG's data as JSON or CSV and delete your account at any time.
- **Phone first.** It works in any browser, installs as a PWA, and the shopping list keeps
  working offline.
- **Open source, self-hostable.** Apache-2.0. Use the hosted app or run your own instance with
  Docker.

## Features

- **Expenses and bill splitting.** Split evenly or by custom amounts, see who owes whom, settle up
  with as few transfers as possible, add recurring costs, get a monthly statement by mail.
  Import from Splitwise or Splid (CSV) or from a screenshot (text recognition runs in your
  browser).
- **Cleaning schedule.** Chores rotate between flatmates, with absences taken into account and
  reminders.
- **Shopping list and supplies.** One list for the whole flat, usable offline, plus a list of
  household supplies.
- **Calendar.** Shared dates with recurrence, reminders and an iCal feed for your calendar app.
- **Chat and pinboard.** A flat chat, and a pinboard for notes that disappear once they are done.

A flat can have up to 20 members.

## Self-host

A whole instance (app, database, sign-in, image storage) runs on any machine with Docker:

```sh
git clone https://github.com/Abuarchiv/manawg-app.git
cd manawg-app
./docker/setup.sh            # creates .env with fresh secrets
docker compose up -d
```

The first start builds the app image, which takes about ten minutes. Then open
[http://localhost](http://localhost) and create an account; the sign-in code arrives in Mailpit at
[http://localhost:8025](http://localhost:8025). The [self-hosting guide](docs/self-hosting.md)
covers a public instance with your own domain and HTTPS, mail, updates, backups, and the
alternative setup on Vercel and Supabase.

## Tech stack

Next.js 15 and React 19 (PWA), TypeScript, Tailwind CSS 4, PostgreSQL with Drizzle ORM, Supabase
Auth and Storage. [docs/architecture.md](docs/architecture.md) explains how the app is
structured.

## Contributing

Contributions are welcome, in English or German: code, bug reports, translations, ideas.

- **Start small.** Issues labelled
  [good first issue](https://github.com/Abuarchiv/manawg-app/labels/good%20first%20issue) are
  scoped and described for a first pull request.
- **Ask and discuss.** Questions and ideas go to
  [Discussions](https://github.com/Abuarchiv/manawg-app/discussions).
- **Run it locally in five minutes,** without a database or accounts (Node 22, pnpm 9):

  ```sh
  corepack enable
  pnpm install
  pnpm --filter @manawg/web dev:fixtures
  ```

  Then open [localhost:3000/wg/MTE8PZAT](http://localhost:3000/wg/MTE8PZAT), a sample WG.

[CONTRIBUTING.md](CONTRIBUTING.md) walks through your first pull request, and
[docs/development.md](docs/development.md) lists all commands and tests.

### Roadmap and help wanted

- [#637](https://github.com/Abuarchiv/manawg-app/issues/637): upgrade to Next.js 16
- [#638](https://github.com/Abuarchiv/manawg-app/issues/638): upgrade Biome to 2.x
- [#639](https://github.com/Abuarchiv/manawg-app/issues/639): upgrade to TypeScript 7
- [#633](https://github.com/Abuarchiv/manawg-app/issues/633): translate the self-hosting guide
  to German

If ManaWG helps your flat, a star on GitHub is a kind way to say thanks and helps others find it.

## Security

Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## License

ManaWG is licensed under the [Apache License 2.0](LICENSE). You may use, change and distribute it,
also commercially, under the terms of that license.

---

## Auf Deutsch

ManaWG ist eine kostenlose WG-App für Wohngemeinschaften: WG-Kasse mit Ausgaben teilen und
abrechnen, Putzplan mit wechselnden Aufgaben, gemeinsame Einkaufsliste, dazu Kalender, Chat und
Pinnwand. Ohne Werbung und ohne Tracking, im Browser nutzbar und als App aufs Handy installierbar.

Ausprobieren kannst du sie direkt auf [app.manawg.com](https://app.manawg.com). Wer die Daten
lieber selbst hält, startet ManaWG mit Docker auf dem eigenen Rechner oder Server, siehe
[Self-host](#self-host) und die [Anleitung zum Selbsthosten](docs/self-hosting.md) (auf
Englisch).

Mitmachen ist willkommen, auf Deutsch oder Englisch: Fragen und Ideen in den
[Discussions](https://github.com/Abuarchiv/manawg-app/discussions), Fehler und Wünsche als
[Issue](https://github.com/Abuarchiv/manawg-app/issues). Wenn dir ManaWG in deiner WG hilft,
freuen wir uns über einen Stern.
