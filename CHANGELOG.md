# Changelog

All notable changes to ManaWG are listed here, newest first. Versions follow
[Semantic Versioning](https://semver.org). Until 1.0.0, the middle number counts feature releases:
0.1.1 only fixes bugs, while 0.2.0 adds features and may need a manual step on a self-hosted
instance. Every release says whether it does. 1.0.0 will follow once setup and data model have
settled.

## [Unreleased]

### Added

- Spanish (Español) as a third language: the interface, mails, push notifications, monthly
  statements and exports follow the device language or the choice in the profile settings.
  Migration 0043 allows the new value for the stored language. The Splitwise and Splid CSV
  importers also read Spanish column headers. Receipt scanning still recognises German and
  English text only.
- Import from Tricount and Settle Up (CSV) under *Expenses → Import*, next to Splitwise and Splid.
  Money transfers are marked as repayments like Splitwise payments, income entries and rows in other
  currencies than euros are listed as not imported. Needs a database migration (`0042`), which
  `setup` applies on start.

### Changed

- The invitation page for visitors without an account names who invited them to which flat, offers
  Google next to *Create account* as the main action, and links to sign-in as a plain text link. A
  link that is expired, used up or wrong is reported before the sign-up instead of after it. A
  signed-out member who reopens a used-up link now sees that notice instead of being forwarded to
  their flat after signing in.
- The notice after a mail link that could not be used points to the *Code by email* tab, because
  the password from before the confirmation is discarded.
- Registration no longer asks for a password: enter your name and email address, then the 8-digit
  code from the mail on the same page. An address that already has an account is signed in by the
  code instead. A password stays optional and can be set under *Settings → Access*. The
  confirmation mail now shows the code next to the link. Docker setups pick the new template up on
  start; with Supabase hosted, run `scripts/supabase-auth-templates.mjs --apply` again (see the
  self-hosting guide).
- The installed app's description and its "Join a flat" home-screen shortcut follow the device
  language instead of always being German. The PWA manifest is now served at
  `/manifest.webmanifest`.
- Links that open a new tab are announced as such by screen readers.

### Fixed

- A mail or Google link that failed during sign-up from an invitation no longer drops the
  invitation: after signing in on the page that follows, the visitor still lands on it.
- The English crash page labels its mail link "Report a problem by email", the wording the other
  error screens use.

### Self-hosting

- A Portainer template and a stack file for it: `portainer-template.json` and
  `docker/portainer/compose.yaml` run the Docker stack from Portainer without a shell, without
  `./docker/setup.sh` and without bind mounts ([Portainer](docs/self-hosting.md#portainer)). The
  normal `compose.yaml` is unchanged.

## [0.1.1] - 2026-11-05

### Fixed

- The data export calls its payment section "Cash payments", the name used on the expenses
  page. As "Settled payments" it showed 0 after shares had been marked as paid, which are listed
  with their expenses.
- The cleaning rota groups the tasks due within a week under "Next 7 days" instead of "This week",
  which also covered days of the following week.
- After confirming the email address, the page that asks for the password again explains why,
  instead of reading like a password reset.
- A new flat's only member no longer reads that they should reactivate a member who moved out
  before leaving; the danger zone now also mentions inviting someone.
- The sign-in page has "Sign in" as its browser tab title again instead of "Create or join a
  flat".
- A chat link ending in a closing bracket, such as a Wikipedia page "…_(disambiguation)", opens
  with the bracket instead of a page that does not exist.
- Screen readers announce the balances and expense tables of the monthly statement once each,
  instead of twice as regions with the same name.
### Self-hosting

- No manual step. Pull the `0.1.1` image and restart; there are no new database migrations.

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

[0.1.1]: https://github.com/Abuarchiv/manawg/releases/tag/v0.1.1
[0.1.0]: https://github.com/Abuarchiv/manawg/releases/tag/v0.1.0
