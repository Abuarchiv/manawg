# Changelog

All notable changes to ManaWG are listed here, newest first. Versions follow
[Semantic Versioning](https://semver.org). Until 1.0.0, the middle number counts feature releases:
0.1.1 only fixes bugs, while 0.2.0 adds features and may need a manual step on a self-hosted
instance. Every release says whether it does. 1.0.0 will follow once setup and data model have
settled.

## [Unreleased]

### Added

- Settings → Profile → Help links the frequently asked questions on manawg.com first, in German
  or English (Spanish readers get the English page), opening in a new tab. The report-by-email
  link follows it.
- Accounts without a flat can be deleted from the "Your flat" screen after sign-in, with the same
  confirmation as in the flat settings. After a completed deletion the start page confirms
  "Account deleted".
- While a flat has only one member, the Start card shows the current invitation link with a
  share button (the share sheet, or copying the link where there is none). When the newest link
  has expired, been used up or revoked, opening the card creates a fresh one, so a flat that is
  still alone never shows a dead link. "Remind me later" now hides the card for three days instead
  of seven. The card is gone within seconds of a second member joining, and every share checks
  the link with the server first.
- Self-hosted instances refuse passwords from known data breaches in Supabase Auth as well
  (`GOTRUE_PASSWORD_HIBP_ENABLED`), so direct calls to `/auth/v1` get the same check as the app's
  registration and password change. Pull the new `compose.yaml` and restart.
- The link preview of an invitation in WhatsApp, Signal, Telegram and other messengers names who
  invites to which flat ("Mika invites you to the flat “Lindenstraße”") and, once the flat has two
  members, how many are already in. Links that can no longer be used keep the generic preview.
- The Docker image takes `SENTRY_RELEASE`, `SENTRY_ORG` and `SENTRY_PROJECT` build arguments and
  a `sentry_auth_token` build secret. With them, error reports carry the release and point at the
  original source lines; the token is not stored in the image.
- The creator of a flat that is still alone a day after it was created gets one email with a
  button to invite flatmates. It goes out once per flat, between 24 and 72 hours after creation,
  from the daily maintenance job, in the member's language, and only to a confirmed address. Its
  unsubscribe link turns off setup tips by email for every flat of the account. Self-hosted
  instances apply the new column with the usual migrations on start.
- Members get a push when a new flatmate joins ("Mina joined Altbau"). It follows the
  noticeboard notification setting; the person who joined does not get it.
- Debtors get a push when an expense changes in amount, share or date ("your share 5.00 EUR to
  8.00 EUR") and when it is deleted. Edits to category, description or receipt stay quiet. The
  activity log shows the old and the new amount of an edit, and an edited expense shows "Edited" with
  the date of the edit in the details.
- The start page shows "New since your last visit": what other members added since you last had
  the page open, with their name first. The marker stays in this browser only and follows the
  server's clock. Without anything new, a single quiet line links to the activity list; without a
  marker (first visit, blocked storage) the heading stays neutral.
- Marking a task as done takes one tap and no confirm step. The toast has an Undo button that puts
  the task, its due date and its assignee back; it works for two minutes, as long as nobody has
  changed the task since, and it also removes a completion that is still waiting offline. A swap
  request closed by the completion opens again. With the keyboard, focus moves to Undo. Late
  tasks still ask first. Push notifications that were already sent are not withdrawn.
- Adding an expense is quicker: the amount comes right after the description, the category is a row
  of buttons instead of a drop-down, and a new expense starts on the category you used for the same
  description before (otherwise the last one you used). When the form opens with a description
  already filled in, the cursor is in the amount, and Enter there saves.
- After saving an expense, the confirmation says what it means for you, for example "You get €4.80
  back (Mina)" or "You owe Mina €10.00". The note that no money is transferred appears only for the
  first expense of a flat.
- Receipt scanning recognises Spanish text: with the interface in Spanish, the scanner loads the
  Spanish model as well, so `ñ` and accents are kept. Other languages do not download it.
- The self-hosting guide has tested nginx and Traefik reverse-proxy examples with the `.env` values,
  the headers and limits ManaWG needs from a proxy, and a check that the sign-in limit sees each
  visitor separately ([Reverse proxy examples](docs/self-hosting.md#reverse-proxy-examples)).
- While you are the only person in the flat, a short "invite flatmates" line stays on the Expenses
  tab, the empty shopping list and the empty cleaning rota. It disappears once someone joins.

### Changed

- An open flat tab sends one small "what changed" request every 30 seconds instead of one
  request per list, member roster and unread badge, and reloads only what changed. A list page
  that nobody else changes now costs at most two requests a minute. The chat checks every 8
  seconds while messages come in and slows to every 30 seconds after two quiet minutes; a new
  message, sending or typing speeds it up again. Self-hosted instances apply the new table and
  triggers with the usual migrations on start.
- The **Database** workflow runs the unit and database suites together with coverage and uploads
  the report as the `coverage` artifact. It fails when settle-up, ledger, payment or invite code
  drops below its measured coverage floor, and when any test skips itself although a database is
  set.
- A healthy `/api/health` answer may now be cached by a CDN or caching proxy for four minutes
  (`Cache-Control: public, s-maxage=240`), so an uptime monitor checking every minute no longer
  runs the health check each time. An unhealthy or rate-limited answer is still never cached, and
  an outage shows within five minutes. To always get a live answer, add a unique query parameter.
- The **Release production** workflow no longer needs Vercel. With the repository variable
  `PREVIEW_GATE` set to `database`, its Preview gate is the Preview database migration check and
  the new `PRODUCTION_DEPLOY_HOOK` secret deploys a self-hosted instance; `PREVIEW_GATE=on` keeps
  the Vercel Preview gate. The workflow checks gate and hook before it migrates anything, and
  still tags only after `/api/health` reports the new version. See the Releases section of
  `docs/development.md`.
- A page nobody has used for five minutes stops refreshing its lists, the chat and the unread
  count, even while it stays in front. The first click, key press or scroll refreshes it at once.
  A tab left open all day no longer sends thousands of requests to the server.
- While you are alone in the flat, the Start card's dismiss button reads "Remind me later" and
  hides it only for a week; with flatmates it stays hidden for good as before. Once a flatmate has
  joined and nothing has been entered yet, the card names them, links to "Add expense" and "Open
  shopping" and keeps the invite button.
- An invitation link that no longer works offers a "Copy message" button with a ready-made request for
  a new link to send to whoever invited you.
- Invitation links are valid for 14 days instead of 7. The invitation page, the invitation mail and
  the settings say so.
- Joining through an invitation takes one tap when your account already has a name: the button reads
  "Join as Mira", and "Change name" opens the name field. Creating a WG asks for the WG name only,
  with "You are Mira · change" for the name.
- The invitation page for visitors without an account says what ManaWG is for and how many
  flatmates are already in. The shared invitation text says what ManaWG is in one line.
- Opening the expense form from the shopping list now selects the category Groceries. For "Add as
  expense" on a single bought item, an earlier expense with the same description keeps its category.
- The balance card says "owes €5.00", "gets €12.00" or "settled" for each member instead of a
  signed number, and leaves the list out in a flat of two, where the heading already says it. The
  link to all reminders has a history icon; the bell stays for sending a reminder.
- The settle-up dialog opens at once and fills in the amounts as soon as they are checked. When the
  shares cover the whole balance it has one button, "Mark €10.00 as paid"; the cash option appears
  only when it would cover more. The notes sit under "Details", and more than three shares are
  collapsed.

### Fixed

- Text typed into the shopping list field right as the list or pantry finished loading could
  vanish, mostly in Safari. The field now keeps it.

- Moving focus with Tab in Safari no longer leaves the focused button or field hidden under the
  bottom bar when the smooth scroll to it stopped part way.

- After signing up, each step of creating or joining a flat ("Your flat", "Create a new flat",
  "Flat created") shows its own tab title and is announced to screen readers, instead of
  "Sign in". Reloading the "Flat created" step shows the invite link again instead of opening
  the flat.
- Creating a flat answers sooner: the response no longer waits for the activity-log entry, and
  the share code is checked by the database's unique index instead of a lookup before the write.
- Screen readers read a busy button by its label alone ("Saving…") instead of "Loading Saving…".
  Twenty buttons in chat, expenses, debts, import and the noticeboard showed a spinner that
  added its own name.
- The import instructions in the README no longer tell you to export from Tricount, which removed
  its export in version 8 (2024). Files exported from an earlier Tricount version still import.
- A taken name on the join page now moves focus to the name field even when the field was hidden.
- Going offline no longer puts a red error above the expenses, fixed costs, debts, pinboard or
  activity you were already looking at. The offline bar says it; the error only appears when nothing could
  be loaded or the server answered with an error.
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

- Quieter pushes: several shopping items added in a row replace one notification ("Mina added 3
  items to the shopping list") instead of buzzing each time, and a burst of chat messages from
  one person replaces the previous notification from that person without a new sound. Mentions,
  due chores and money pushes still alert. Chore reminders, assigned or not, arrive as one push per
  person and day ("Open for you: Bathroom, Trash (+1)") and only on the due day and the day after;
  the chore stays in "For you" and in the cleaning rota.
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
