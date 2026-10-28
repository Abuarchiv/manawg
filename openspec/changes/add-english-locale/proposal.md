## Why

ManaWG only speaks German. Many WGs share a flat with international students and professionals who cannot settle money or plan cleaning in German, so they either stay out of the app or depend on flatmates to translate. Directories such as AlternativeTo and SaaSHub also reject apps without an English interface.

## What Changes

- Every person can choose German or English. The choice is per person, not per WG; German stays the default and its output stays byte-identical.
- Locale resolution for rendering: `manawg_locale` cookie, then `Accept-Language`, then German. Routes stay German and unprefixed.
- `wg_members.locale` (`'de' | 'en'`, default `'de'`) stores the language for server senders. Migration `0037`.
- `PATCH /api/account { locale }` stores the choice for the signed-in person across all their memberships.
- A language switch in the profile settings and in the entry footer.
- All UI text, metadata, aria labels, toasts and error copy come from typed de/en message catalogs.
- Dates, numbers, currency, CSV export and amount input follow the locale; `Europe/Berlin` stays authoritative for WG days.
- Push, mails, the unsubscribe page, CSV labels and the activity feed render in the recipient's language.
- New audit rows store their sentence parameters so the feed can render them in the reader's language; old rows keep their German text.
- Offline queue and chore status stop using German text as logic; legacy stored German prefixes keep working.
- New gates: an `i18n-literal` architecture ratchet against hard-coded UI text, a catalog parity test, and English E2E specs.
- API fallback names such as `'Unbekannt'` become `null`; clients render a localized label. **BREAKING** for API consumers that rely on the German fallback name (only the app itself).

## Capabilities

### New Capabilities

- `internationalization`: locale resolution and persistence, recipient-locale server text, locale-aware formatting and amount input, and the gates that keep both languages complete.

### Modified Capabilities

- `member-settings`: members can choose their language in the profile settings.
- `offline-platform`: queued actions carry review flags instead of German text, and legacy German entries still behave as before.
- `activity-timeline`: the feed renders new entries in the reader's language and keeps old entries readable.

## Impact

- Dependencies: `next-intl` and `use-intl` 4.x.
- Code: root layout, about 370 source files with German copy, `core/utils/{money,amount,time}.ts`, notifications, mail, export, audit, offline queue, `scripts/check-architecture.mjs`.
- Database: additive column `wg_members.locale` with a check constraint; no backfill beyond the default.
- Supabase auth templates gain an English branch; pushing them to the hosted project is an owner action.
- Production release goes through `release-production.yml` so the migration runs before the deploy.
- Unaffected: URLs, the landing site, German legal pages, OG images, JSON-LD and the web app manifest.
