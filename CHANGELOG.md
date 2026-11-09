# Changelog

All notable changes to ManaWG are listed here, newest first. Versions follow
[Semantic Versioning](https://semver.org). Until 1.0.0, the middle number counts feature releases:
0.1.1 only fixes bugs, while 0.2.0 adds features and may need a manual step on a self-hosted
instance. Every release says whether it does. 1.0.0 will follow once setup and data model have
settled.

## [Unreleased]

### Added

- Receipt scanning recognises Spanish text: with the interface in Spanish, the scanner loads the
  Spanish model as well, so `ñ` and accents are kept. Other languages do not download it.
- The self-hosting guide has tested nginx and Traefik reverse-proxy examples with the `.env` values,
  the headers and limits ManaWG needs from a proxy, and a check that the sign-in limit sees each
  visitor separately ([Reverse proxy examples](docs/self-hosting.md#reverse-proxy-examples)).
- An invitation link that has expired offers a "Copy message" button with a ready-made request for
  a new link to send to whoever invited you.

### Changed

- Invitation links are valid for 14 days instead of 7. The invitation page, the invitation mail and
  the settings say so.
- Joining through an invitation takes one tap when your account already has a name: the button reads
  "Join as Mira", and "Change name" opens the name field. Creating a WG asks for the WG name only,
  with "You are Mira · change" for the name.
- The invitation page for visitors without an account says what ManaWG is for and how many
  flatmates are already in. The shared invitation text says what ManaWG is in one line.

### Fixed

- A taken name on the join page now moves focus to the name field even when the field was hidden.
- The structured data (JSON-LD) of the app now lists all supported interface languages instead
  of German only.
- Spanish shopping entries such as "2 kg de arroz" or "2 l de leche" no longer keep the "de" in the
  item name after a metric unit.
- The Settle Up import reads split amounts such as "1.234,56" correctly instead of as 1.23.
- A pause sent to the recurring-expenses collection endpoint pauses the template instead of moving
  its due date.
- Signing out with unsent offline changes still asks before discarding them when the last sync
  attempt fails.
- Editing an expense keeps what you typed when the member list refreshes in the background.
- Deleting a WG also removes the stored request replays that still held its text.
- A slow rate-limit service no longer holds the WG's write lock, so posts, comments, reactions and
  chat messages cannot stall the WG's other writes.
- Chat mentions notify only members whose `@name` is in the message, for new and edited messages.
- Absence entries in the activity log use one entity type. Migration `0044` converts older
  entries; the `setup` service applies it on start.
- The agent consent screen shows the host the authorization code is sent to, not the host the
  client declares for itself.
- The payment reminder mail no longer promises a one-click settlement; it asks to record the
  payment in the app.
- Failed post-commit steps when adding a shopping item, failed chore reminder dispatches and failed
  receipt scans are now reported with their cause instead of being dropped.

## [0.2.0] - 2026-11-09

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
  confirmation mail of such an account shows the code and no link, because opening the link
  would use up the code. Docker setups pick the new template up on
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
- Manual step only with Supabase hosted: run `scripts/supabase-auth-templates.mjs --apply` again,
  otherwise the sign-up code mail has no code. Docker setups need nothing beyond pulling the
  `0.2.0` image and restarting; `setup` applies the migrations `0042` and `0043` on start.

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

[0.2.0]: https://github.com/Abuarchiv/manawg/releases/tag/v0.2.0
[0.1.1]: https://github.com/Abuarchiv/manawg/releases/tag/v0.1.1
[0.1.0]: https://github.com/Abuarchiv/manawg/releases/tag/v0.1.0
