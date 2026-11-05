# Changelog

All notable changes to ManaWG are listed here, newest first. Versions follow
[Semantic Versioning](https://semver.org). Until 1.0.0, the middle number counts feature releases:
0.1.1 only fixes bugs, while 0.2.0 adds features and may need a manual step on a self-hosted
instance. Every release says whether it does. 1.0.0 will follow once setup and data model have
settled.

## [Unreleased]

## [0.1.0] - 2026-11-05

The first public release. From here on, every change that reaches app.manawg.com and the Docker
image is listed in this file.

### Added

- Expenses split evenly or by amount, balances, settle-up suggestions with as few transfers as
  possible, cash payments, payment reminders and recurring costs such as rent.
- A monthly statement page and mail with a PDF attached, and import from Splitwise or Splid (CSV)
  or from a screenshot, with text recognition in the browser.
- A cleaning rota that rotates chores by workload and skips flatmates who are away.
- Shopping list, household supplies, pinboard with comments and reactions, and chat.
- Calendar with recurring dates, reminders and an iCal feed.
- Push notifications, offline use with changes that sync later without duplicates, and English and
  German following the device language.
- Export of a WG as JSON or CSV, and account deletion.
- Self-hosting with Docker Compose: app, PostgreSQL, sign-in, image storage, a gateway with HTTPS
  and a mail catcher, plus backup and restore scripts.

### Self-hosting

- No manual step. The `setup` service applies all database migrations on start.

[0.1.0]: https://github.com/Abuarchiv/manawg/releases/tag/v0.1.0
