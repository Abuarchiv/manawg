# Changelog

All notable changes to ManaWG are listed here, newest first. Versions follow
[Semantic Versioning](https://semver.org): a patch release fixes bugs, a minor release adds
features, and a major release needs something from you when you update, such as a changed setting.
Every release says whether a self-hosted instance needs a manual step.

## [Unreleased]

## [1.0.0] - 2026-11-04

The first stable release. From here on, every change that reaches app.manawg.com and the Docker
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

[1.0.0]: https://github.com/Abuarchiv/manawg/releases/tag/v1.0.0
