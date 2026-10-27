# Design: English language support for ManaWG

OpenSpec change: `add-english-locale`
Written against `main` at `9ce9c5ab`, checked 2026-10-27.

- **Paths:** relative to `apps/web/`, unless they start with `/` or with a repo-root folder. The repo-root folders are `openspec/`, `supabase/`, `docs/`, `.github/`, and repo-root `scripts/`, written as `<root>/scripts/`.
- **Markers:**
  - **[verify]** is an assumption that the named phase must confirm before anything builds on it.
  - **Builder decision** is a choice the implementer makes without the owner. Each one gives its reason and can be reverted on request.

---

## 1. Intent and why

ManaWG only speaks German. Most of its target groups (Studien-WG, Berufs-WG) live with international students and professionals who don't read German well enough to settle money or plan cleaning. Today those flatmates either stay out of the app or depend on others to translate. The product promise "Verschiedene Menschen teilen einen Alltag" fails in exactly those mixed WGs.

The goal is a complete, professional English version.

- German stays the default and does not change.
- Language is chosen **per person**, not per WG. One German and one English flatmate share the same WG data, each in their own language.

Why now, and why planned rather than added piecemeal:

- **Volume.** About 2,100 German source lines sit in about 369 of 793 non-test source files. Roughly half are outside components: error mappers, push, mail, offline and audit.
- **Formatters.** About 33 `de-DE` Intl/`toLocale*` call sites exist, 19 of them module-level constants.
- **Persisted German text:**
  - `audit_events.summary`;
  - offline `lastError` in localStorage;
  - the chat payload `amount`;
  - the push payload `amountFormatted`;
  - the move-out name suffix ` (ausgezogen)`.
- **German text used as logic:**
  - the `startsWith('Server prüfen:' | 'Bild fehlt:' | 'Bild wurde entfernt:' | 'Noch keine Verbindung')` checks;
  - `actionLabel === 'Nachholen'`;
  - the client-side `hat`→`hast` rewrite in the feed.

Without one plan, parallel sessions would collide in the same few files and the English would drift in terminology.

## 2. Goals

1. **Every user-visible string is available in English (en-GB).** That covers:
   - UI, metadata, toasts, aria labels and error messages;
   - offline copy and push;
   - all mails and the unsubscribe HTML page;
   - CSV section labels and the SW fallback.

   The exceptions are listed in section 3.
2. **German output stays byte-identical.** The existing ~880 German E2E assertions and all German unit assertions stay green without being edited.
3. **Each person chooses a language, and the choice persists:**
   - a cookie for rendering;
   - `wg_members.locale` for server senders such as push, mail and cron;
   - Supabase `user_metadata.locale` for auth mails, written where Supabase allows it (D4).
4. **Server-generated text uses the recipient's language**, not the actor's.
5. **Dates, numbers, currency and amount input follow the locale.** The Berlin time-zone logic does not change.
6. **No new logic depends on display text, and no new localized text is written to the DB.** Existing persisted German keeps legacy-compatible readers.
7. **Gates:**
   - a ratchet gate blocks new hard-coded UI strings;
   - a catalog test enforces de/en parity and valid ICU;
   - an English E2E sweep proves completeness.
8. **Small PRs.** After the infrastructure phase, areas are independent packages with disjoint file ownership, so subagents can work on them in parallel worktrees.

## 3. Non-goals

- Localized URLs, locale prefixes or `hreflang`. Routes stay German (`/wg/[code]/putzen` and so on).
- **Translating user content:** names, titles, chat and Pinnwand posts.
  - This includes the app-composed swap request post (`features/chores/server/resolve-swap-request.ts`), which is written once in the author's language.
  - It also includes the ` (ausgezogen)` suffix that `core/db/member-names.ts` writes into a moved-out member's stored name. Builder decision: it is stored data now, and changing it would need a data migration that can collide with the unique-name index.
- Re-translating audit rows written before this change. They keep their stored German sentence.
- The landing site `manawg.com`, which is another repo, and the German legal pages it hosts.
- **Localized OG images, OG locale and JSON-LD.** Crawlers send no cookie, so these stay German and identical in every locale.
- **The web app manifest** (`public/manifest.json`: description, shortcut "WG beitreten").
  - Builder decision: the text appears only in the install sheet and one long-press shortcut.
  - A cookie on the manifest fetch of installed PWAs is not guaranteed.
  - A dynamic manifest changes a PWA-critical file for little gain. Follow-up on request.
- `SUPPORT_MAILTO` subject "Fehler in ManaWG" (`shared/lib/support-mailto.ts`). The support inbox is German, so it stays as is with `// i18n-ignore`.
- Languages other than de and en. The design allows a third language without restructuring, but nothing is built for one.
- Language per WG.
- Translating content through an API or at runtime.
- The ICS feed. It contains only user content and the brand name (`features/events/ics.ts`, `api/calendar/[id]/[token]/route.ts:34`).

## 4. Anti-goals (must not happen)

- **Changing any German string while extracting it.** Copy edits are separate PRs.
- **Translating error codes**, or putting localized text into API responses that carry codes today.
  - API responses carry no fallback display names. `'Unbekannt'` becomes `null` (D12).
- **Locale logic in the Edge middleware**, including `next-intl/middleware`. The middleware owns CSP, rate limits and the Supabase refresh.
- **Message catalogs inside client JS chunks.** The bundle budget is 120 KB shared and 55 KB per route (`scripts/check-bundle-budget.mjs:25–26`).
- **Using the UI locale for case folding, hashing or key parsing.** These keep their fixed tags:
  - `toLocaleLowerCase/UpperCase('de-DE')` in `MemberAvatar.tsx:27,57,59`, `activity.ts:245,252`, `activity-audit.ts:180` and `offline-action-builders.ts:102`;
  - the `en-CA`/`en-US`/`en-GB` key parsers in `core/utils/berlin-day.ts:20,27,73`, `composition/export.ts:214` and `notification-dispatch.ts:94`.
- **Changing time-zone semantics.** `Europe/Berlin` stays authoritative for WG days.
- **Machine-translated legal or consent text presented as binding.**
- **Changing German brand metadata or JSON-LD.** It is word-for-word identical to the landing (`52cdc402`, `fa63ea79`), and the German `<head>` output must not change.

## 5. Facts the design rests on

### Stack and dependencies

- Next `^15.5.28`, React `^19.1.0` (19.2.x installed), zod 4.
- Node 22.x in CI (`engines`), 26 locally. pnpm 9.
- No i18n library is installed.
- **next-intl 4.14.9** (npm, 2026-10-27):
  - Peers: `next ^12–^16` and `react ^19`, so it is compatible.
  - Dependencies: `use-intl ^4.14.9`, `icu-minify`, `@swc/core`, `@parcel/watcher`, `@eloqnt/*` and `negotiator`.
- **use-intl 4.14.9** exports `./core`, `./react` and `./format-message/format-only`, which is the precompiled-message runtime.

### Root layout (`src/app/layout.tsx`)

- `force-dynamic` (L16). It reads `headers()` for the CSP nonce (L140), so reading `cookies()` costs nothing extra.
- Hard-coded German:
  - `lang="de"` (L143);
  - JSON-LD `inLanguage: 'de-DE'` (L60);
  - `openGraph.locale: 'de_DE'` (L82);
  - the skip link "Zum Hauptinhalt springen" (L189).
- `robots: { index: false }` (L74–77). Every app page is noindex.
- `shared/lib/og.ts:8` repeats `locale: 'de_DE'` for pages that override OG.
- Providers: `ThemeProvider` (L193–205), with `SplashScreen`, `InputModality`, `PwaRegister` and `InstallPrompt` around and inside it.

### Rendering

- 205 of 295 `.tsx` files are `'use client'`, plus 53 `.ts` modules.
- About 60 `.tsx` files with copy have no directive: pages, layouts, `loading.tsx`, skeletons and UI primitives. They render as Server Components or inside client trees. **A single translation hook that works in both is therefore required.** That is why D1 picks next-intl and not use-intl alone.
- `app/global-error.tsx` renders its own `<html>` outside the root layout, so no provider is available there.
- **Server Actions:** none. `scripts/check-wg-auth-invariant.mjs:38` forbids them.

### Middleware (`src/middleware.ts`)

- The page matcher excludes `api`, `manifest.json` and every path containing a dot (L185–194).
- Origin checks and rate limits apply only to `isRateLimitedApiPath`, L26–36: `/api/account` (exact), `/api/auth/*`, `/api/wg[/*]`, `/api/calendar/*`, `/api/upload/*` and `/api/cron/*`.
- Mutations without `Origin` are rejected (`originAllowed`).
- With `MIGRATION_READ_ONLY=true`, every mutation gets a 503.

### Fixture mode

- `resolveFixtureRequest` calls `answerFixtureApiRequest` (`fixtures/api.ts:311`), which only answers `/api/wg…`. Other API paths reach the real route.
- `hasSessionCookie()` (`core/auth/session-hint.ts:8–15`) returns `true` in fixture builds.

### Architecture check (`scripts/check-architecture.mjs`)

- `CODE_RE` covers `.ts|tsx|mjs|cjs|js`, including `.d.ts`.
- `layerOf` maps unknown top-level folders (for example `src/i18n/`) to `app`. Imports that resolve outside `src/` are skipped.
- **Baseline semantics:**
  - Exact set: a new violation fails, and a fixed entry that is still listed fails.
  - `fileSize` counts `split('\n').length`. Growing past the entry fails. Shrinking also fails until the entry is lowered (L266–278).
- **Current baseline:** no violations, and two size entries, `src/core/db/schema.ts: 984` (983 in `wc`) and `e2e/account-delete-db.spec.ts: 1156`.
- `typescript` is a devDependency, so the AST is available to scripts.

### DB

- PayPal is removed from the app by a parallel change (`paypal-entfernen-20261027`, migration `0036_remove_paypal.sql`). This change builds on it, so every PayPal file, route and string is out of scope and the next migration number is `0037`. The schema files are listed in `drizzle.config.ts`.
- `drizzle(pool, { schema })` only gets `./schema` (`core/db/index.ts:5,69`).
- `wgMembersRelations` references `pushSubscriptions` (`schema.ts:863`).
- `wg_members` already uses `check()` (`schema.ts:120`).
- Grants are table-level (`0034_app_role_grants.sql`), so a new column needs no grant.

### Members

- `insert(wgMembers)` exists only in `app/api/wg/route.ts:79` (create) and `app/api/wg/[code]/members/route.ts:200` (join).
- `members/[id]/claim/route.ts:74–75` links an account to an existing member.

### Push

- `notification-dispatch.ts` formats one message per dispatch (L249) and fans it out to all selected members. The member select (L223–237) has no locale.
- Callers pass numbers, with one exception: `import-commit.ts:350` passes `amountFormatted`, which is German-formatted.

### Mail and auth

- **Senders:**
  - `core/auth/welcome-mail.ts`, called from `app/auth/callback/route.ts` and `api/auth/code-verify/route.ts`;
  - `core/mail/account-deleted.ts`, called from `api/account/route.ts:86` (request) and `api/cron/maintenance/route.ts:122` (retry, no request);
  - `core/mail/{brand-mail,templates}.ts`;
  - `features/expenses/statement-mail.ts`;
  - `features/expenses/statement-recipients.ts`, at the expenses root;
  - `features/expenses/server/{statement-*,reminder-mail}.ts`;
  - `app/api/wg/[code]/invitations/route.ts`.
- **Auth routes:**
  - Sign-up sets `options.data.full_name` (`api/auth/sign-up/route.ts:19`).
  - OTP uses `shouldCreateUser: false` (`code-request/route.ts:16`), so `data` is not applied to existing users.
  - `resetPasswordForEmail` has no `data` option.
  - `authPost` exposes `request` (`core/auth/route-helpers.ts:33`).
- **Supabase templates:** `supabase/templates/*.html` and `subjects.json`, synced by `<root>/scripts/supabase-auth-templates.mjs`. Subjects already use Go templating (`"{{ .Token }} ist dein Anmeldecode"`).

### Persisted German text

- **Audit:**
  - `audit_events.summary` is a finished German sentence.
  - The feed strips the stored actor name and puts the current name in front. It parses `hat`/`ist`/`wurde` (`activity-audit.ts:172–190`, `activity.ts:221–228`).
  - The client rewrites `hat`→`hast` and `ist`→`bist` for "Du" (`ActivityFeed.tsx:64–70`).
- **Audit write paths:** 96 `recordAuditEvent` calls, plus 5 direct `db.insert(auditEvents)` sites (`admin-succession.ts:91`, `api/account/route.ts:73`, `events/[id]/occurrence/route.ts:181`, `import-undo.ts:77`, `manual-payment.ts:140,206`).
- **Audit metadata:** it reaches every member through `publicAuditMetadata` (`activity/route.ts:241`, `core/audit-visibility.ts`). Post content was deliberately stripped from it (`drizzle/0030_audit_strip_content.sql`).
- **Offline queue:** stored in localStorage key `manawg:offline-actions` (`offline-store.ts:25`). IndexedDB holds only pending images (`offline-images.ts`).
- **German `lastError` prefixes are used as logic:**
  - `SERVER_CHECK_PREFIX`, used at `offline-replay-rules.ts:139`, `offline-queue.ts:65` and `OfflineQueueItem.tsx:46`;
  - `IMAGE_MISSING_PREFIX` and `IMAGE_REMOVED_PREFIX`, used at `offline-replay-rules.ts:143–144`;
  - `OFFLINE_NO_CONNECTION_TITLE`, used at `offline-queue.ts:150`.

  All are defined in `offline-failure-copy.ts:15–24`.
- **Chat:** the system payload stores a de-formatted `amount` (`features/expenses/server/expenses.ts:137–148`), rendered in `SystemMessage.tsx`.

### Text used as logic or concatenation

- `NETWORK_ERROR_CODE = 'Netzwerkfehler'` and `INVALID_RESPONSE_CODE = 'Unerwartete Serverantwort'` (`core/http/error-codes.ts:17,19`).
  - They are used as literals in 7 more files: `use-chat-reactions.ts:36`, `import-errors.ts:110`, `ImportUndo.tsx:17`, `CashPaymentList.tsx:130`, `MemberNameForm.tsx:22`, `use-notification-settings.ts:310` and `DataTab.tsx:79`.
  - They are never displayed raw.
  - Tests use both values (`tests/security-bodies-idempotency.test.ts:191,210` and five more).
- `actionLabel: 'Erledigt' | 'Nachholen'` (`chore-status.ts:9,41–72`):
  - compared at `ChoreCompleteDialog.tsx:24`;
  - concatenated at L84 and L92;
  - consumed at `TodayRow.tsx:34,46,94` and `ChoreRow.tsx:151,293`.
- Verb choice in code: `chore-completion.ts:173` (`'bist' | 'ist'`) and `SettlementReviewDialog.tsx:58` (`'hast' : 'hat'`).

### Shared error copy

- `mutationErrorMessage` and `RATE_LIMITED_MESSAGE`/`READ_ONLY_MESSAGE`/`SESSION_EXPIRED_MESSAGE` are used by 25 files in 8 packages.
- `pluralize` (`shared/lib/plural.ts`) is used by 20 files, including server code (`notifications.ts:139`, `import-commit.ts:326`, `import-undo.ts:76`).

### Amount parsing (`core/utils/amount.ts:3–19`)

- Today it already accepts `12.50` and `12,50`, and `1.234` with strict thousands grouping as 1234.
- It rejects `1,234`, because three decimals are invalid, and `1,234.50`.

### Tests and tooling

- **Playwright:** pins `locale: 'de-DE'` and `timezoneId: 'Europe/Berlin'` (`playwright.config.ts:108–109`). `testDir: './e2e'`. The WebKit config inherits `base.use`.
- `e2e/pwa.spec.ts:288` creates a context by hand. **Verified in Phase 1:** `browser.newContext()` inherits the config `locale` (`navigator.language` is `de-DE`) and `baseURL`, so the spec needs no change.
- **Unit tests:**
  - plain Node `--experimental-strip-types` plus `tests/support/register.mjs`;
  - `server-only` resolves to an empty module;
  - no JSX loader, so only `.ts` modules are unit-testable.
- **knip** scans `src/**/*.{ts,tsx,css}`, scripts, e2e and tests, and reports unused files and exports.
- **CI** (`ci.yml`): `pnpm audit --prod --audit-level high`, lint, knip, `analytics:check`, architecture, the auth invariant, typecheck, unit tests, build, `bundle:check` and `test:e2e:fixtures`.

### Service worker (`public/sw.js`)

- `VERSION = 'manawg-app-v7-nav-timeout'` (L14).
- German push fallback `fallbackPushData` (L118–122).
- `'refresh-shell'` handler (L153–155).
- Precaches `/`, `/offline` and `/manifest.json`. Navigations are network-first, and `/api` and `/auth` are bypassed.

### Navigation

- `components/app/navigation.ts` defines the sections Haushalt, Finanzen and Austausch.
- `app/wg/[code]/layout.tsx:170` has the tab "Start".

### Entry footer

- `components/entry/LegalLinks.tsx`, used by `NeuClient`, `RegistrierenClient`, `EinladungClient` and `PublicApp`.
- It contains the consent sentence (L32–45) and the landing links "Über ManaWG", "Die WG-App" and "WG-Ratgeber".

### Already safe

- Expense categories (`lebensmittel` …) and inventory categories are stable keys with separate label maps.
- Inventory units (`Stück`, `L`, `kg`, `Rolle`, `Packung`; `features/inventory/inventory.ts:8`, DB default `schema-inventory.ts:14`) are stored values. They are treated as keys with per-locale labels, so no data migration is needed.
- Chat system messages are `system_kind` plus payload.
- API errors are snake_case codes (`core/http/api-errors.ts:23`). CSV/JSON export column keys are English.
- Zod validation answers with codes (`core/http/parse-body.ts`).

## 6. Decisions

### D1. Library: next-intl v4 without i18n routing, plus `use-intl/core` for non-React code

**next-intl in "without i18n routing" mode**

- No middleware and no `[locale]` segment.
- `src/i18n/request.ts` (the default plugin path) returns `{ locale, messages, timeZone: 'Europe/Berlin' }`.
- The root layout wraps `<body>` content in `NextIntlClientProvider`.
- `useTranslations` works in client **and** Server Components. That is required because about 60 directive-less `.tsx` files with copy render on both sides.
- Async server code (`generateMetadata`, async pages) uses `getTranslations`.

**use-intl as an explicit dependency**

- Same caret range as next-intl uses (`^4.14.9`), so pnpm resolves one copy. pnpm is strict, so a transitive import would fail.
- Server senders, composition code and unit tests use `createTranslator` from `use-intl/core`, which runs in plain Node.

**Why next-intl**

- One hook for RSC and client components.
- ICU plural and select.
- Typed keys **and** typed arguments (AppConfig augmentation).
- Rich text (`t.rich`, needed for `SystemMessage.tsx`'s tabular-nums span).
- The de facto App Router standard, with no build plugin beyond the request-config alias.

**Rejected**

- **use-intl alone:** no RSC hook, so every directive-less component would need a second API.
- **A home-grown `t()`.**
- **i18next/react-i18next:** heavier, and no typed arguments without extra tooling.
- **Lingui:** needs an SWC macro step in the Sentry/analyzer chain.

**Config chain** (`next.config.ts`, L60–78): `withNextIntl` is innermost, giving `withSentryConfig(withBundleAnalyzer(withNextIntl(nextConfig)))`, or without Sentry when upload options are absent.

**Phase 1 acceptance**

- `pnpm install --frozen-lockfile` and `pnpm audit --prod --audit-level high` pass with next-intl's transitive dependencies (`@swc/core`, `@parcel/watcher`, `@eloqnt/*`). Record the result.
- If audit fails, stop and report. Pinning or overriding versions follows the existing `pnpm.overrides` pattern.
- `use-intl/core` imports under `test:unit`.
- The client runtime delta fits `bundle:check`. If it does not, enable precompiled messages: next-intl/icu-minify with the `use-intl/format-message/format-only` runtime. The flag is `createNextIntlPlugin({ experimental: { messages: { path, locales, precompile: true } } })`. It belongs to the extractor catalog pipeline (`messages.path`), so it does not apply to the TypeScript catalogs without further work. **Builder decision (Phase 1): no precompile, the full runtime stays.**
  - Measured against the branch base: the shared first-load JS is unchanged at 102.6 kB gzip (budget 120 kB). The runtime sits in one lazy chunk of 11.7 kB gzip (`intl-messageformat`), reached through `useMessage` in `LoadErrorBanner`. Today 11 of 22 pages share it, so neither budget counts it.
  - Every route that reaches it grows: `/wg/[code]` 234.0 to 246.2 kB gzip first-load JS (+12.2 kB; Next's own table says 239 to 252 kB), `/wg/[code]/ausgaben` +12.8 kB, `/` +0.1 kB, `/neu` +0.3 kB.
  - Projection: once a root-level or non-WG client component uses `useMessage`, the chunk joins the all-pages set, and the shared first-load JS becomes about 102.6 + 11.7 = 114.3 kB, which leaves about 5.7 kB of headroom under 120 kB. That fits, so the extractor pipeline for precompiled messages is not built.
  - Trigger: if `bundle:check` reports a shared first-load JS above 118 kB in any phase, switch to precompiled messages before merging.
  - `bundle:check` also prints the largest `/wg/[code]` first-load JS (informational, currently `/wg/[code]/ausgaben` at 308.6 kB) so the growth is visible in every PR.

### D2. Locale model

- **Type:** `type Locale = 'de' | 'en'`, with `LOCALES` and `DEFAULT_LOCALE = 'de'`.
- **Intl tags:** de → `de-DE`, en → `en-GB`.
- **en-GB, not en-US.** The users live in Germany and mostly learned European English. en-GB also gives:
  - 24-hour time;
  - day-month dates ("3 March 2026");
  - Monday as the first day of the week;
  - euro amounts with the sign in front and a point as decimal separator (`€1,284.50`).
- **Attributes:**
  - `<html lang>`: `de` (unchanged) / `en-GB`.
  - **Builder decision:** OG `locale` (`layout.tsx:82`, `og.ts:8`) and JSON-LD `inLanguage` (`layout.tsx:60`) stay `de_DE`/`de-DE` in every locale. Crawlers and link-preview bots never carry the cookie. Keeping them constant makes the German `<head>` byte-identical by construction and keeps the JSON-LD entity identical to the landing.

### D3. Locale resolution (rendering)

`src/shared/i18n/locale.ts` exports `resolveLocale({ cookie, acceptLanguage }): Locale`. It is pure, so it runs in Node, Edge and tests. It checks in this order:

1. Cookie `manawg_locale`, if it is a valid `Locale`.
2. `Accept-Language`, sorted by q:
   - the first tag whose primary subtag is `de` or `en` wins;
   - `*` and unknown tags are ignored;
   - a parser of about 10 lines, with no dependency.
3. `'de'`.

**Callers**

- `src/i18n/request.ts`, with `cookies()` and `headers()`.
- Route handlers, through `requestLocale(req)` in `src/core/i18n/request-locale.ts`, using `req.cookies` and `req.headers`.
- The middleware is not involved.

**Why Accept-Language counts**

- An English-speaking invitee opening `/einladung/...` should land in English without searching for a switch.
- Playwright pins `de-DE`. Node `fetch` sends `*` and crawlers usually send nothing, so tests and previews stay German.

**Known effect.** Existing users whose browser prefers English will see English after rollout. The visible switch (D5) covers that. The owner can veto by deleting step 2 (one line).

**Known limit.** A signed-in user on a new device without the cookie gets the Accept-Language result, not their stored `wg_members.locale`. Accepted. Switching once fixes it.

### D4. Locale storage (server senders)

**Column:** `wg_members.locale text NOT NULL DEFAULT 'de'` with `CHECK (locale in ('de','en'))` (migration `0037`, D13).

**Why this table**

- Push dispatch, statement mails and reminder mails already read `wg_members`, so no join, N+1 or Admin API call is added.
- It covers members without an account.
- It follows `0020_monthly_statement_emails.sql`.
- It needs no new table, RLS, grants (table-level) or account-deletion change.
- Existing rows get `de`, which is today's behaviour.

**Per person, not per WG**

- Every write updates **all** rows with the same `auth_user_id` in one statement (`UPDATE … WHERE auth_user_id = $1`).
- The request locale is written:
  - on WG creation (`app/api/wg/route.ts:79`);
  - on join (`app/api/wg/[code]/members/route.ts:200`);
  - on member claim (`app/api/wg/[code]/members/[id]/claim/route.ts:75`, the same `.set()` call).
- **Known limit.** Switching while signed out does not update existing rows. If a user never switches while signed in, push and mail keep the language from when they joined or claimed. Accepted.

**Supabase `user_metadata.locale`**

- Written on sign-up, in `options.data` next to `full_name` (`api/auth/sign-up/route.ts:19`).
- Written on every explicit switch while signed in, through `supabase.auth.updateUser({ data: { locale } })` with the request's session client. Supabase merges `data` keys.
- **Builder decision:** it is not written on OTP or password-reset requests. Supabase ignores `data` for existing users on `signInWithOtp` with `shouldCreateUser: false`, and `resetPasswordForEmail` has no `data` option. Users who never switched get German auth mails, which is the template default.
- Used only by the Supabase-hosted auth templates (D10) and the welcome and account-deleted mails as a fallback.

**Rejected**

- A `user_preferences` table: a join, no account-less members, and a deletion path.
- `user_metadata` as the only store: Admin API calls per recipient, and N+1 on push fan-out.

**`schema.ts` line budget (Builder decision)**

- Add `locale: text('locale').notNull().default('de'),` and `localeCheck: check('wg_members_locale_check', sql\`${t.locale} in ('de', 'en')\`),`. Each fits on one line within biome's 100 columns.
- In the same PR, compress the 6-line move-out comment at `schema.ts:97–102` to 4 lines without losing content. The file stays at 984 by the check's count, and the baseline is unchanged.
- No table moves. Moving `pushSubscriptions` would create a circular import with `wgMembersRelations` (`schema.ts:863`) and take the table out of the relational `schema` object (`core/db/index.ts:69`).

### D5. Language switch

**Component:** `src/components/app/LanguageSwitch.tsx`. It is a segmented `ToggleGroup` (`components/ui/toggle-group.tsx`) with the endonyms "Deutsch" and "English", which are never translated.

- In `components/wg/einstellungen/ProfileTab.tsx`, directly below the theme switch (L54–72).
- As a compact link variant in the entry footer `components/entry/LegalLinks.tsx`, which covers `/`, `/neu`, `/einladung/[token]` and `/registrieren`.

**Flow on change**

1. **Write the cookie** from shared `localeCookie(locale)`:
   - `path=/`, `max-age` one year, `SameSite=Lax`;
   - `Secure` unless `location.protocol === 'http:'`;
   - not HttpOnly, because it is not sensitive and must be writable signed out.
2. **If `hasSessionCookie()`** (`core/auth/session-hint.ts`) is true, `await` `PATCH /api/account { locale }`.
   - The route is already covered by the origin check and rate limit.
   - The handler uses `requireAccount` (architecture rule `route-auth`).
   - Zod-validated. Idempotent by nature, because it sets a value.
   - It updates all `wg_members` rows of the user, then `user_metadata.locale`.
   - It lives in `src/app/api/account/locale-patch.ts`, re-exported as `PATCH` from `route.ts` (107 lines today), so `route.ts` keeps its deletion focus.
   - **Builder decision: best-effort.** Any failure (401 for account-less legacy members, 503 in read-only mode, network) is ignored. The cookie already switched rendering, and the next switch retries the DB write.
3. **Post `'refresh-shell'`** to `navigator.serviceWorker.controller`. The SW's `waitUntil` survives the reload and refetches `/` and `/offline` in the new language.
4. **Call `window.location.reload()`.**

**Why a reload and not `router.refresh()`**

- The router cache holds RSC payloads for 5 minutes (`next.config.ts:53`).
- Text also lives in module state, `document.title` (`NeuClient.tsx:180–183`) and dynamic chunks.
- Other open tabs keep the old language until their next load. Accepted.

**Offline:** the switch is disabled offline with the existing offline hint.

**Fixture mode:** `src/fixtures/api.ts` answers `PATCH /api/account` with `200 { locale }`, so the E2E spec can assert the request.

### D6. Message catalogs and namespaces

**Format: TypeScript modules**

- Location: `src/shared/i18n/messages/{de,en}/<namespace>.ts`.
- German files are `export default { … } as const`.
- English files are `export default { … } satisfies Catalog<typeof de>`, where `Catalog<T>` maps every leaf to `string`.
- `src/shared/i18n/messages/{de,en}/index.ts` aggregate the namespaces with static imports.

**Why TypeScript and not JSON**

- Key parity becomes a **type error**: `satisfies` rejects missing and excess keys.
- Literal types let next-intl infer argument names.
- There is no JSON import-attribute risk under strip-types.
- `satisfies` and `as const` are erasable syntax.
- Cost: the 400-line budget applies, so namespaces stay split by area.
- **Verified in Phase 1:** a synthetic namespace of 400 messages (plural, select and plain arguments) typechecks without "type instantiation excessively deep", `tsc --noEmit` takes about 5 s more, and a missing or wrongly typed argument fails with TS2345 and TS2322. No fallback is needed.

**All namespace files are created in Phase 1.** Each starts as `{}`, except `common` and `meta`. The two `index.ts` registries and `AppConfig` never change again, and packages only edit their own two files.

**Keys and messages**

- camelCase, nested by screen or component (`chores.completeDialog.title`). Never the sentence itself.
- Full sentences with placeholders. No concatenated fragments.
- Agreement uses ICU `select`, for example `{assignee, select, self {Du bist} other {{name} ist}} als Nächstes dran`.
- **ICU escaping rule for German copy:**
  - a literal `{`, `}` or `#` (inside plural) must be quoted;
  - an ASCII `'` directly before `{`, `}`, `#` or `|` starts quoting and must be doubled;
  - rich-text tags are only used deliberately.
- Formatted dates and money are passed in as strings (D9). Counts are passed as numbers.
  - ICU `#` and number arguments format with the locale ("1.000" in German for 1000, where `pluralize` gives "1000"). Accepted: no realistic count reaches 1000.
  - One formatting path means no hydration drift and no next-intl time-zone warnings.

**`common` is frozen after Phase 1.** Phase 1 seeds the keys the design assigns to packages (`common.unknownPerson`, D12 and package I). Packages that need another generic string put it in their own namespace. Phase 6 consolidates duplicates.

**Catalogs are server-only for value imports**

- Only `src/i18n/request.ts` and `src/core/i18n/server-t.ts` (`import 'server-only'`) may value-import `@/shared/i18n/messages`.
- `import type` is allowed everywhere. It is needed by `src/i18n/next-intl.d.ts` and `src/shared/i18n/message.ts`.
- New architecture rule `i18n-catalog-import` enforces this (D15).

**Delivery to the client**

- The root layout passes the full catalog of the active locale to `NextIntlClientProvider`, with `timeZone: 'Europe/Berlin'`. In next-intl v4 the provider inherits it from the request config.
- It sits in the RSC payload, not in a JS chunk.
- Root layout props are sent once per document load. Soft navigations do not re-render the root layout, and `router.refresh()` does.
- Phase 1 measures the gzip HTML delta for `/` and `/wg/[code]`. If it exceeds about 30 KB gzip, the fallback is a nested provider in `src/app/wg/[code]/layout.tsx` with the WG namespaces only. Phase 1 measured the delta (section 11 item 2): it is far below 30 KB today, so the fallback is not applied yet. The full German copy is about 2,600 strings, 100 KB raw and 24 KB gzip as values alone, so the final catalog comes close to the threshold. Re-measure when Phase 3 has filled the catalogs. [verify nested provider merge semantics, only if the fallback is needed]

**`global-error.tsx`** cannot use the provider.

- **Builder decision:** it renders its few strings from a tiny inline two-locale map. The locale comes from `document.documentElement.lang`, falling back to the cookie.
- It carries `// i18n-ignore` lines with that reason.
- The catalog test cannot see it, so the package-A spec covers it.

### D7. Type safety

**`src/i18n/next-intl.d.ts`:** `declare module 'next-intl' { interface AppConfig { Locale: Locale; Messages: typeof deMessages } }`. Unknown keys and wrong or missing ICU arguments fail `pnpm typecheck` (`tsc --noEmit` plus `tsconfig.e2e.json`).

**`src/shared/i18n/message.ts`**

- Type `Message = { key: MessageKey; values?: Record<string, string | number | Message> }`. `MessageKey` is derived from `typeof deMessages`. Nested `Message` values are resolved first.
- Client and RSC hook `useMessage()`, returning `(m: Message) => string`. It wraps the root `useTranslations()` and holds the one unavoidable cast.
- Server counterpart `renderMessage(t, m)` in `core/i18n/server-t.ts`.

**Runtime test `tests/i18n-catalog.test.ts`.** For every key in both locales it checks:

- the set of placeholder and ICU argument names is identical;
- no value is empty;
- the message renders through `createTranslator` with dummy arguments, which catches ICU syntax errors;
- English values contain no `ß` or umlauts;
- German values contain no unbalanced braces after rendering.

### D8. Usage patterns (binding for all packages)

| Where | Pattern |
|---|---|
| Client component, or a directive-less component rendered in RSC | `const t = useTranslations('chores')` |
| Async Server Component, `generateMetadata` | `const t = await getTranslations('meta')`. Static `metadata` exports become `generateMetadata`. |
| Pure TS that produces copy (error mappers, status helpers, offline copy, `chore-completion.ts`, word-producing time helpers) | Returns a `Message`. Components render it with `useMessage()`. The modules stay pure. Their tests assert keys and values. |
| Server senders (push, mail, export, feeds, unsubscribe HTML) | `serverT(locale, namespace)` from `src/core/i18n/server-t.ts`, which wraps `createTranslator` and the catalog. |
| Client code outside React (offline sync, `invite-share.ts`) | Stores or returns a `Message`. Text is rendered at display time. |
| Plurals | ICU `{count, plural, one {# Tag} other {# Tage}}`. `shared/lib/plural.ts` is removed in Phase 6 when knip reports it unused. |
| Shared error copy | **Additive (Builder decision).** Phase 1 adds `mutationError(subjectKey, code, map, fallbackKey, retrySubjectKey?): Message` next to the unchanged `mutationErrorMessage`. The shared buckets become `common.errors.*`. The German pattern `"{subject}: {detail}"` is one message, `common.errors.withSubject`, with nested `Message` values. Each package migrates its own callers. Phase 6 deletes `mutationErrorMessage` and the `*_MESSAGE` constants. |
| Verb agreement in code (`'bist'/'ist'`, `'hast'/'hat'`, `hat`→`hast`) | Replaced by ICU `select` inside the full sentence. |

### D9. Date, number, currency and amount input

**`src/shared/i18n/intl.ts`**

- `intlTag(locale)`.
- `numberFormat(locale, options)` and `dateTimeFormat(locale, options)`, memoized in a `Map` keyed by locale plus serialized options.
- Module-level `new Intl.*('de-DE', …)` constants become calls to these at call time, inside the owning package.

**Existing helpers gain an optional `locale = 'de'`.** No caller changes on day one, and the German path is the current code.

- `core/utils/money.ts`: `formatEuroCents(cents, currency, { signed, locale })`.
- `core/utils/amount.ts`: `formatDecimal`, `formatEuroInput` and `formatCentsInput`, each with `(…, locale)`.
- `core/utils/time.ts` formatters that only use Intl (`formatShortDate`, `formatDayMonthYear`, `formatShortDateRange`, `formatTimeFull`) gain `locale`.
- **Word-producing helpers (Builder decision):**
  - Phase 1 adds `relativeTimeMessage(iso, now): Message` and `weekLabelMessage(weekStart, now): Message` (`common.time.*`).
  - `formatRelativeTime` and `formatWeekLabel` stay unchanged until the last caller has migrated. Today there are 10 client files.
  - The ICU messages reproduce today's German exactly: "gerade eben", "vor 5 Min", "vor 3 Std", "gestern", "vor 3 Tagen", "morgen", "in 3 Tagen", "Diese Woche", "Letzte Woche", "Woche ab 08.09.".

**Amount input: `parseEuroAmount(input, locale = 'de')` (Builder decision)**

- The `'de'` path is the current function, unchanged byte for byte (`amount.ts:3–19`).
- The `'en'` path strips `€`/`EUR` and spaces, then applies this rule: the last `.` or `,` followed by one or two digits at the end is the decimal separator, and every other separator is grouping.
- **A three-digit tail is ambiguous** and is resolved by locale:
  - in en, `1,234` is 1234 and `1.234` is invalid (`null`);
  - in de, `1.234` is 1234 and `1,234` is invalid (`null`), as today.
- **Why tolerant:** iOS `inputMode="decimal"` shows the **device** separator, so an English UI on a German iPhone produces commas. Both locales therefore accept `12,50` and `12.50` as 12.50.

**Time zones**

- Explicit `Europe/Berlin` stays wherever it is used today. Device-zone formatting stays device-zone.
- The key parsers and normalizers listed in section 4 are out of scope.

**CSV export follows the requester's locale** (`composition/export.ts:246,268–272`)

- de: `;` separator and decimal comma, unchanged.
- en: `,` separator and decimal point.
- The BOM and the English column keys stay.
- The audit `summary` column exports the stored text, which is German for every row. It is a data record. Builder decision.

**Sorting:** `inventory.ts:122` `localeCompare(…, 'de')` becomes `localeCompare(…, intlTag(locale))`. Other `localeCompare` calls compare IDs and ISO dates and stay.

### D10. Server-generated text uses the recipient's locale

| Sender | File(s) | Locale source |
|---|---|---|
| Push | `core/notifications/notifications.ts`, `notification-dispatch.ts` | Each recipient's `wg_members.locale`. `locale` joins the member select (L223–237). The message is formatted once per distinct locale (at most two). The URL is unchanged. Signature: `formatNotificationMessage(event, payload, locale)`. |
| Push payload amount | `features/expenses/server/import-commit.ts:350` | `amountFormatted` is dropped. The formatter uses `totalAmountCents` and `formatEuroCents(…, { locale })`. |
| SW fallback text | `public/sw.js:118–122` | `self.navigator.language.startsWith('en')` picks one of two hard-coded strings. `VERSION` is bumped. |
| Welcome mail | `core/auth/welcome-mail.ts` | Request locale, from the callback or code-verify request. The recipient is the current user. |
| Invitation mail | `app/api/wg/[code]/invitations/route.ts` | The inviter's request locale. The recipient has no account. A language choice in the dialog is YAGNI. |
| Reminder mail | `features/expenses/server/reminder-mail.ts` | The debtor's `wg_members.locale`. |
| Monthly statement | `features/expenses/statement-mail.ts`, `statement-recipients.ts`, `server/statement-run.ts` | `locale` added to `StatementRecipient` from `wg_members.locale`. The month name comes from `dateTimeFormat` (`statement-mail.ts:59`). |
| Account-deleted mail | `core/mail/account-deleted.ts` | `sendAccountDeletedMail(authUserId, email, locale)`. The request path (`api/account/route.ts:86`) passes `requestLocale(req)`. The cron retry (`api/cron/maintenance/route.ts:122`) passes `'de'`. Builder decision: a rare path, and the member rows are already gone. |
| Brand mail shell | `core/mail/brand-mail.ts` | `lang` attribute and footer strings by locale. Impressum and Datenschutz stay German pages, labelled "(German)" in English. |
| Unsubscribe HTML | `app/api/email/unsubscribe/route.ts` | The member's `locale`, found through `memberId` from the token (`core/mail/unsubscribe.ts`). Falls back to `requestLocale(req)`. |
| Activity and dashboard feeds | `composition/activity.ts`, `activity-audit.ts`, `dashboard-feed.ts` (served by `/api/wg/[code]/activity` and `/dashboard`) | `requestLocale(req)`. Items keep their shape and gain `selfText?: string` (D12). |
| Supabase auth mails | `supabase/templates/*.html`, `subjects.json`, `<root>/scripts/supabase-auth-templates.mjs` | `{{ if eq .Data.locale "en" }}…{{ else }}…{{ end }}` in each body and subject. Subjects already use Go templating (`{{ .Token }}`). [verify that `.Data` exposes `user_metadata` and that conditionals work in hosted subjects] If not, the fallback is a bilingual subject `"<de> / <en>"`. Pushing to the hosted project is **owner only**. |

### D11. Error codes, not text

**Phase 1, one PR, constants only (Builder decision)**

- `NETWORK_ERROR_CODE` and `INVALID_RESPONSE_CODE` keep their current values. They are opaque internal codes, never displayed, and asserted by existing tests.
- Their definitions carry `// i18n-ignore internal error code`.
- The literal uses become the constant: `use-chat-reactions.ts:36`, `import-errors.ts:110`, `ImportUndo.tsx:17` (computed key `[NETWORK_ERROR_CODE]`), `CashPaymentList.tsx:130`, `MemberNameForm.tsx:22`, `use-notification-settings.ts:310` and `DataTab.tsx:79`.
- No behaviour changes and no test edits.

**Inside the owning packages**

- **Offline (L):**
  - Queued actions gain `needsReview?: 'server' | 'imageMissing' | 'imageRemoved'`, `noConnection?: true` and `lastErrorMessage?: Message`.
  - `offline-replay-rules.ts:139,143–144`, `offline-queue.ts:65,150` and `OfflineQueueItem.tsx:46` check the flag **or** the legacy German prefix. localStorage rows written before the change keep German text.
  - A legacy `lastError` string is displayed as is.
  - The prefix constants stay, with `// i18n-ignore legacy persisted prefix`.
- **Chores (F):**
  - `actionLabel: 'Erledigt' | 'Nachholen'` becomes `action: 'complete' | 'catchUp'`.
  - The consumers `TodayRow.tsx` (A-owned) and `ChoreRow.tsx` move along in package F's PR. **That `TodayRow.tsx` edit is the one cross-package edit**; A must have merged first, or F rebases onto A.
  - `ChoreCompleteDialog.tsx:84,92` uses full messages (`chores.completeDialog.confirm.{complete|catchUp}`).

### D12. Persisted data

**Audit (Phase 5)**

- **Metadata.** Every audit write adds the sentence's parameters to `metadata_json`, for example `{ actorName, title }`. That covers the 96 `recordAuditEvent` calls and the 5 direct inserts listed in section 5.
  - Allowed parameters are only values that already appear in today's summary: names, titles, descriptions, counts and amounts in cents plus currency.
  - **Never post or chat content.** Keys `content*` are banned, consistent with `0030_audit_strip_content.sql`.
  - `core/audit-visibility.ts` keeps filtering private fields, and the new keys are public to WG members.
- **Two messages per event type:**
  - `audit.<type>.feed`: the text without the actor, for example "hat {title} eingetragen." / "added {title}.". It has a `self` select variant where verbs differ, for example "{self, select, yes {bist} other {ist}} abwesend" / "{self, select, yes {are} other {is}} away".
  - `audit.summary` = `"{actorName} {text}"` for actor-style events. Passive events ("… wurde …") use their feed message as the summary.
- **Writing `summary`.** It is still written, produced by `serverT('de', 'audit')`, and byte-identical to today. A unit test per event type checks this. That keeps the column NOT NULL, the export content and the legacy parser valid.
- **Rendering** (`composition/activity-audit.ts`):
  - If `audit.<type>` exists and the metadata carries all of its parameters, it renders `text` and `selfText` in the reader's locale.
  - Otherwise it uses the stored `summary` through `formatAuditActivityText`, which then only ever sees German. It also computes `selfText` server-side with today's `hat`→`hast`/`ist`→`bist` rule.
  - `ActivityFeed.tsx:64–70` drops its regex and picks `isMe ? (item.selfText ?? item.text) : item.text`.
- **`NOTIFICATION_FIELD_LABELS`** (`notifications/route.ts:82–95`): new rows store field **keys**. Legacy label arrays are shown as is.

**Other persisted data**

- **Chat payload:** the writer (`features/expenses/server/expenses.ts:137–148`) adds `amountCents` and `currency`. `SystemMessage.tsx` formats them in the reader's locale through `t.rich`, and falls back to the stored `amount` string.
- **Inventory units:** the values stay and act as keys. Labels per locale: `Stück` "pcs", `L` "L", `kg` "kg", `Rolle` "roll", `Packung` "pack". The stored keys carry `// i18n-ignore stored unit key` (`inventory.ts:8`, `schema-inventory.ts:14`, `inventory/route.ts:39`, `InventoryFormDrawer.tsx:72`).
- **Expense and inventory categories:** the values stay. Only the label maps move into catalogs.
- **Fallback display names:**
  - OCR payer `'Unbekannt'` (`features/expenses/ocr.ts:249`) becomes `null`.
  - The API fallbacks in `members/[id]/route.ts:84,91` and `reminders/balances/route.ts:51` become `null`.
  - Clients render `common.unknownPerson`. Client-side fallbacks (`pinnwand/page.tsx:23`, chat components, `ExpenseSplitFieldset.tsx:83`, `CommentRow.tsx`) use the same key.

### D13. Migration `0037_member_locale.sql`

Generated by `drizzle-kit generate` from the `schema.ts` change (D4). Expected SQL:

```sql
ALTER TABLE "wg_members" ADD COLUMN "locale" text DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "wg_members" ADD CONSTRAINT "wg_members_locale_check" CHECK ("wg_members"."locale" in ('de', 'en'));
```

- **Compatible.** It is additive with a default, so code that predates it keeps working. No grants are needed.
- **Generated files.** The snapshot and journal come from `drizzle-kit generate`. A second `generate` produces no diff.
- **Verification.** It is verified against throwaway Postgres (`pnpm test:db` with `TEST_DATABASE_URL`, plus `pnpm db:check`).
- **Production.** The release goes through `.github/workflows/release-production.yml`: Preview gate, then production migration, then deploy hook. That runs the migration **before** the deploy that reads the column. Only the owner triggers it, never an agent.

### D14. Metadata and SEO

- **Metadata.** All 24 `metadata`/`generateMetadata` sites use `getTranslations('meta')`. Static `metadata` exports become `generateMetadata`. The sites are:
  - root;
  - `page.tsx`, `not-found.tsx`, `registrieren/page.tsx`, `neu/layout.tsx`, `auth/reset/page.tsx`, `einladung/[token]/page.tsx`, `wg/not-found.tsx`, `entdecken/[module]/page.tsx`, `offline/page.tsx`;
  - `wg/[code]/layout.tsx` and the 12 `wg/[code]/*/layout.tsx` files;
  - `chat/page.tsx`.
- **German `<head>`.** The German values are the existing literals. Phase 1 snapshots the server HTML `<head>` of `/`, `/neu`, `/registrieren` and `/entdecken/<module>` before and after.
  - The snapshot normalizes the per-request nonce and build hashes.
  - It must match exactly in German.
  - **Result (Phase 1, production build in the fixture environment, base `f8241466` against the branch):** every `<html>` attribute, `meta`, `link`, `title` and JSON-LD tag is identical for `/`, `/neu`, `/registrieren` and `/entdecken/ausgaben`. The only difference is one additional async `<script>` for the shared chunk that holds the message runtime (26 to 27, 24 to 25, 22 to 23, 26 to 27 chunk scripts). Chunk file names differ between builds, so scripts are compared by count.
  - **Builder decision:** the extra chunk script is accepted. The acceptance reads "metadata, link and JSON-LD tags identical".
- **Route titles are pre-seeded.** Phase 1 puts every static title and description of the 24 sites into `meta` in both locales, so no package edits `meta` and parallel packages cannot collide:
  - `meta.brand.*` (root, `page.tsx`), `meta.authReset.title`, `meta.invite.{title,description}`, `meta.discover.description` (`{description}` suffix of the module pages, the module title and description stay data), `meta.join.{title,description}` (`neu/layout.tsx`), `meta.notFound.title`, `meta.offline.title`, `meta.register.{title,description}`, `meta.wg.{fallbackName,notFound}`;
  - `meta.pages.<route>` for the 13 `wg/[code]` section titles (`abos` to `vorraete`, including `chat`).
  - The sites switch to `getTranslations('meta')` inside their owning package (section 9). They only read keys, so `meta` stays frozen.
  - The suffix ` — ManaWG` and the title template are brand text and stay in code.
- **English brand text.** English title, description and keywords for the entry pages are an owner decision coordinated with the landing.
  - Until then, the English `meta` brand entries reuse the German brand title and description.
  - All app pages are noindex anyway (`layout.tsx:74–77`).
- **OG image, OG locale and JSON-LD** stay German and constant (D2, section 3).
- **The manifest** stays German and static (section 3).

### D15. Tests and gates

**Existing tests stay untouched.** German output is byte-identical and the D11 code values do not change. Only tests of pure helpers that switch to `Message` change; they assert keys and values (`AGENTS.md`: no copy-only tests).

**New unit tests (mechanism only)**

- `src/shared/i18n/locale.test.ts`: resolution order, q sorting, `*`, invalid cookie.
- `src/shared/i18n/intl.test.ts`: memoization, en-GB currency `€12.50`, de unchanged.
- `tests/i18n-catalog.test.ts` (D7).
- `core/utils/amount.test.ts`: the en and mixed-separator cases from D9. The existing de cases are unchanged.
- `notification-dispatch.test.ts`: per-recipient locale grouping.
- Audit: one byte-identity test per event type over the shared renderer (Phase 5).
- `shared/lib/plural.test.ts` is deleted together with `pluralize` in Phase 6.

**New E2E**

- **`e2e/support/i18n.ts`** (Phase 1):
  - `setEnglishLocale(context, baseURL)` sets the `manawg_locale=en` cookie. The name avoids the `use` prefix.
  - `expectNoGermanChrome(page)` scans only chrome: `nav`, `header`, `button`, `[role=tab]`, `label`, `h1`–`h3`, and the `aria-label` and `placeholder` attributes. It checks against a curated list of German UI words ("Speichern", "Abbrechen", "Einstellungen", "Ausgaben", "Putzplan", "Mitbewohner", "Erledigt", …), so fixture user content does not trigger it.
  - `expectNoHorizontalOverflow(page)` checks at 320px.
- **One spec per package**, `e2e/i18n-en-<package>.spec.ts`. Each visits its routes in English at 320px and 390px, in light and dark. It asserts `html[lang="en-GB"]`, key landmarks in English, no German chrome and no overflow.
- **`e2e/i18n-en-switch.spec.ts`** (Phase 2):
  - the switch persists across a reload;
  - the `PATCH /api/account` body is sent when signed in (fixture answer);
  - it is disabled offline;
  - a `de-DE` browser stays German;
  - an `en-GB` browser without a cookie gets English.

**New architecture rule `i18n-literal`** in `scripts/check-architecture.mjs`, inside the `src/` non-test block.

- **Builder decision: it uses the TypeScript AST** (`ts.createSourceFile`, devDependency `typescript`). A regex over `>…<` misreads generics and comparisons.
- It flags a file (`i18n-literal <file>`) when, outside lines carrying `// i18n-ignore <reason>`, it contains:
  - in `.tsx`: a `JsxText` node with two or more letters, after trimming;
  - a string-literal value of `aria-label`, `placeholder`, `title`, `alt`, `label` or `description` with letters;
  - in `.ts` and `.tsx`: a string literal or template-literal chunk containing `äöüÄÖÜß`, a `GERMAN_RE` word, or a word from the curated `GERMAN_UI_WORDS` list (navigation, module and status nouns, `Unbekannt`, `Jemand`, `Fehler`, …).
- **Exemptions:**
  - `src/shared/i18n/messages/**` and `src/fixtures/**`;
  - `*.test.*`;
  - `src/app/opengraph-image.tsx` (German by design);
  - the allowlist `ManaWG`, `Deutsch`, `English`, `PayPal`, `Splitwise`, `Splid`, `CSV`, `iOS`, `Android`, `Web Push`;
  - import-parser keywords (Splitwise/Splid headers, OCR `bezahlt von`), D11 codes, legacy prefixes and stored unit keys, each with `// i18n-ignore <reason>`.
- **Ratchet:**
  - Phase 1 writes the baseline with `--write-baseline`. Expect about 360 file entries.
  - Each package must remove its entries, because a fixed entry that is still listed fails.
  - New files cannot add entries.
  - **Baseline merge conflicts:** after a rebase, run `node scripts/check-architecture.mjs --write-baseline`. Accept the result only if `git diff scripts/architecture-baseline.json` shows removals only.
  - Limits: English literals in `.ts`, such as dev `Error` messages, are not flagged, on purpose. The rule is a heuristic, and completeness is proven by the English E2E sweep in Phase 6.

**Rule `i18n-catalog-import`.** A value import (not `import type`) of `@/shared/i18n/messages` from any file other than `src/i18n/request.ts` and `src/core/i18n/server-t.ts` is a violation.

**Gates for every PR:**

- `pnpm lint` (biome, plus the architecture and auth-invariant checks in CI);
- `pnpm knip`, `pnpm typecheck` and `pnpm --filter @manawg/web test:unit`;
- `pnpm build`, `bundle:check` and `test:e2e:fixtures`;
- `pnpm audit --prod --audit-level high` when dependencies change.

UI changes are also checked in light and dark mode and at 320px (`AGENTS.md`).

### D16. English copy rules (added to `docs/brand/design-language.md`)

- **Same persona as German:** state, not demand; no blame; no exclamation marks, emojis, slang or office jargon. "The app reminds, it doesn't chase."
- **Form:**
  - Address the user as "you", descriptively and not as a command.
  - Sentence case everywhere, including buttons.
  - British spelling with -ise (organise, cancelled, colour).
  - Pending labels in present tense with an ellipsis: "Saving…", "Deleting…", "Loading…".
  - Curly quotes ‘ ’ “ ”.
- **Amounts and dates:** `€24.80`, `+€42.30`, keep the Intl minus, 24-hour clock, `3 Mar` / `3 March 2026`.
- **Reference sentence:** "€24.80 to Lena, open since 3 March." Banned: "You owe Lina money!", "Great job, team", "Task overdue", "Pay up".
- **Brand name:** "ManaWG", never translated and never with an article.
  - "WG" in prose is "flat" (glossary).
  - The first explanation in onboarding uses "WG (shared flat)".
- **Brandbook addenda** (in `design-language.md`, because `brandbook.html` is a bundled reference):
  - the number-format chapter gets an English addendum;
  - the rule "Ein Substantiv, deutsch" is extended with "in English: one everyday English noun from the glossary".
  - [verify the chapter numbers 17 and 20 in `brandbook.html`; it is a single bundled line and could not be checked]

## 7. Glossary (de to en-GB)

Binding for all packages. The file `docs/brand/glossary-en.md` is created in Phase 0. Owner decisions are marked (O); until answered, the defaults below apply.

| German | English | Note |
|---|---|---|
| ManaWG | ManaWG | Word mark, never translated |
| WG (in UI text) | flat | "Your flat", "Leave flat", "Flat name". "WG (shared flat)" once in onboarding. |
| Wohngemeinschaft | flat share | Descriptive only |
| Mitbewohner(in) | flatmate | |
| WG-Code | flat code | The identifier `shareCode` is not shown |
| Einladung, Einladungslink | invitation, invite link | |
| Tab: Start | Home | `app/wg/[code]/layout.tsx:170` |
| Nav section: Haushalt | Household (O) | Not "Home", which is taken by the Start tab. Matches the expense category. |
| Nav section: Finanzen | Money (O) | |
| Nav section: Austausch | Together (O) | Needs approval |
| Putzplan | Cleaning rota | |
| Aufgabe | task | |
| erledigt / Erledigt | done / Done | |
| nachholen | catch up | "Catch up: {title}" |
| fällig, überfällig | due, overdue | Neutral wording: "Bathroom is due today." |
| tauschen (Putzdienst) | swap | |
| Einkäufe, Einkaufsliste | Shopping, Shopping list | |
| gekauft | bought | |
| Vorräte | Supplies | Not "Inventory" (office jargon) |
| Pinnwand | Noticeboard | |
| Chat | Chat | |
| Kalender, Termin | Calendar, event | |
| ganztägig | all day | |
| Ausgaben, Ausgabe | Expenses, expense | |
| ausgelegt / bezahlt von | paid / paid by | "Lina paid €18.90." |
| Fixkosten | Fixed costs | Route `abos`, but never "subscriptions" |
| Abrechnung (route page) | Statement | |
| Monatsabrechnung | Monthly statement | Never "bill" or "invoice" |
| ausgleichen, Ausgleich | settle up, settlement | |
| offen (Betrag) | open | "open since 3 March" |
| ausgeglichen | settled | |
| Barzahlung | Cash payment | |
| Mahnungen (route) | Reminders | Never "dunning" |
| Erinnerung | reminder | |
| Import | Import | |
| Aktivität | Activity | |
| Einstellungen | Settings | |
| Profil, Benachrichtigungen, Zugang, Daten (tabs) | Profile, Notifications, Access, Data | |
| Ruhezeit | Quiet hours | |
| Abwesenheit, abwesend | Away, away | |
| Auszug, ausziehen | moving out, move out | |
| Admin | Admin | |
| Konto | Account | |
| Konto & WG (aria) | Account and flat | |
| AGB | Terms (German) | Link label in English UI |
| Datenschutz, Datenschutzerklärung | Privacy policy (German) | |
| Impressum | Legal notice (German) | |
| Über ManaWG, Die WG-App, WG-Ratgeber | About ManaWG, The flat app, Flat-share guide | Landing pages stay German. Labels say "(German)" only in the legal row. |
| Kategorien: Lebensmittel, Haushalt, Wohnen, Freizeit, Mobilität, Sonstiges | Groceries, Household, Housing, Leisure, Transport, Other | |
| Inventar-Kategorien: Bad, Küche, Putzmittel, Sonstiges | Bathroom, Kitchen, Cleaning supplies, Other | |
| Einheiten: Stück, L, kg, Rolle, Packung | pcs, L, kg, roll, pack | |
| Pinnwand-Arten: Info, Frage, Problem, Bitte, Entscheidung | Info, Question, Problem, Request, Decision | |
| Hell, Dunkel, System | Light, Dark, System | |
| Offline | Offline | |
| Jemand | Someone | |
| Unbekannt (person) | Unknown | `common.unknownPerson` |
| Ehemaliges Mitglied | Former member | |
| System (audit actor) | System | |

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Client runtime (use-intl plus intl-messageformat) breaks the 120 KB / 55 KB budget | CI red | Measure in Phase 1 before any package starts. Then precompiled messages (D1). Only then reconsider D1. |
| next-intl's transitive dependencies (`@swc/core`, `@parcel/watcher`, `@eloqnt/*`) fail `pnpm audit`, or install slowly in CI or Vercel | CI red, longer builds | Phase 1 records audit and install time. Use `pnpm.overrides` for fixed versions. Stop and report if a high-severity finding has no fix. |
| Strict ICU argument types slow `tsc` or hit the depth limit | Typecheck slow or red | Phase 1 stress check (D6). Per-namespace fallback to keys-only typing. |
| Full catalog in the RSC payload makes HTML heavier | Slower first load on mobile | Measure in Phase 1. If more than 30 KB gzip, use the nested WG provider (D6). |
| German output drifts during extraction (ICU quoting, `#`, apostrophes) | ~880 E2E assertions fail, brand copy changes | Copy stays byte-identical. The ICU escaping rule (D6). The full German E2E suite on every PR. The German `<head>` snapshot. Reviewers diff `de/*.ts` against the removed literals. |
| Parallel packages touch the same files | Rebase conflicts, lost work | Ownership table (section 9) with every file in exactly one package, and one named exception (`TodayRow.tsx`, D11). Registries and `common` are frozen after Phase 1. One E2E spec per package. Baseline conflicts are resolved with `--write-baseline` and a removal-only diff. |
| Router cache and SW shell show the old language after a switch | Mixed language | Reload plus `'refresh-shell'` (D5), and `VERSION` bumps in Phase 4 (M) and Phase 6. |
| Server locale differs from client locale during hydration | Hydration errors | The locale comes only from the provider, never from `navigator`. Both sides use `Europe/Berlin`. Dates are pre-formatted strings. |
| A hand-made Playwright context without `locale` turns English through Accept-Language | German specs fail | Phase 1 verifies `e2e/pwa.spec.ts:288` and adds `locale: 'de-DE'` explicitly if it does not inherit it. |
| Push or mail in the wrong language | Confusing messages | Recipient locale from the DB (D10), with a dispatch unit test. Known limits in D3 and D4. |
| Old audit rows stay German for English readers | Mixed activity feed | Accepted and documented. New rows are fully localized. |
| Audit metadata leaks content | Privacy regression | Only parameters already in the summary. `content*` keys banned (D12). Review checklist item in Phase 5. |
| English quality varies across many agents | Unprofessional product | Glossary and D16 are inputs to every package. Phase 6 runs one consistency review over all `en/*.ts`. |
| Files over 400 lines after adding hooks or metadata | Lint red | Watch list: `expenses/[id]/route.ts` 393, `use-expense-form.ts` 390, `InventoryFormDrawer.tsx` 388, `ExpenseFormSection.tsx` 387, `offline-sync.ts` 387, `announcements/route.ts` 385, `EventEditModal.tsx` 380, `CalendarMonth.tsx` 377, `use-ausgaben-page.ts` 377, `AboForm.tsx` 371, `NeuClient.tsx` 368, `PayPalConnect.tsx` 367, `PublicApp.tsx` 363, `notifications.ts` 360, `fixtures/api.ts` 347. Split along responsibilities and keep the entry file. |
| `schema.ts` may not grow | Lint red in Phase 2 | Comment trim, net 0 lines (D4). |
| Supabase template conditionals unsupported | Auth mails only German | Bilingual fallback subject and body (D10). |
| Existing English-browser users see English after rollout | Surprise | One-tap switch. The owner can drop Accept-Language (D3). |
| New cookie not listed in the privacy policy | Compliance gap | Owner decision 2 (section 10). The cookie is functional and set only on explicit choice. Rendering without it uses Accept-Language and sets nothing. |
| Worktree disk usage (about 5 GB each) | ENOSPC | At most 4 package worktrees at once. Remove each after its merge. |
| Legal and consent wording in English | Liability | Owner decision 1. English UI links to the German legal pages marked "(German)". The consent sentence (`LegalLinks.tsx:32–45`) ships translated but is flagged in the PR for review before release. |

## 9. Phase plan

### Rules for every phase

- **Branches and commits**
  - One branch per PR, from `origin/main`, in its own worktree.
  - Agents commit locally. The owner pushes, opens and merges the PRs (`AGENTS.md`, plus the user rule against pushing).
  - Rebase on `origin/main` right before handoff and re-run all gates.
- **Report** the exact gate results in the PR description. Never mention AI tooling.
- **Comments** are English, with no history words (`comment-lang`, `comment-history`; `ponytail` is a banned word).
- **Scope of edits.** A package edits only:
  - the files it owns;
  - its own two catalog files;
  - its own `e2e/i18n-en-<pkg>.spec.ts`;
  - line removals in `scripts/architecture-baseline.json`.
- **Package checklist**
  - Replace literals with `t()`, `getTranslations` or `Message`.
  - Fill `de` with the exact current text and `en` per the glossary and D16.
  - Convert `pluralize`, the `=== 1 ?` ternaries and verb choices in code to ICU.
  - Migrate the package's own callers of `mutationErrorMessage`, the `*_MESSAGE` constants and `formatRelativeTime`/`formatWeekLabel` to the new APIs.
  - Pass the locale to formatters and parsers. Move module-level `Intl` constants to `intl.ts` calls.
  - Convert the package's route `metadata` to `generateMetadata`.
  - Remove the package's `i18n-literal` baseline entries.
  - Add the English E2E spec.
- **Every package's acceptance includes**
  - All gates green.
  - No `i18n-literal` entry left for owned files.
  - `tests/i18n-catalog.test.ts` green.
  - The unchanged German E2E suite green.
  - The English spec green at 320px, light and dark.

### Phase 0: Spec (docs only, 1 agent, 1 PR)

**Scope**

- `openspec/changes/add-english-locale/`:
  - `proposal.md`;
  - `design.md` (this document);
  - `tasks.md`;
  - a new capability spec `specs/internationalization/spec.md` (locale resolution, persistence, recipient locale, formatting, gates);
  - deltas for `member-settings` (language setting), `offline-platform` (no text as logic, legacy prefixes) and `activity-timeline` (localized feed, legacy rows).
- `docs/brand/glossary-en.md`.
- The D16 addendum in `docs/brand/design-language.md`.

**Acceptance**

- `openspec validate add-english-locale` passes.
- The owner decisions (section 10) are recorded in `design.md` with their defaults.
- Lint passes.

### Phase 1: Infrastructure (1 agent, 1 PR, about 1,200 lines diff, no DB)

**Owns**

- `package.json` and the lockfile (next-intl, use-intl).
- `next.config.ts`.
- `src/i18n/request.ts` and `src/i18n/next-intl.d.ts`.
- `src/shared/i18n/{locale,intl,message}.ts` plus their tests.
- `src/shared/i18n/messages/{de,en}/*.ts`: **all** namespace files plus both `index.ts`.
- `src/core/i18n/{server-t,request-locale}.ts`.
- `src/app/layout.tsx`: lang, provider, skip link. OG and JSON-LD stay unchanged (D2).
- `src/core/http/error-codes.ts` (additive `mutationError`, `// i18n-ignore` on the codes) and the 7 literal sites (D11, constants only).
- `src/core/utils/{money,amount,time}.ts` plus their tests:
  - optional locale;
  - en parser branch;
  - additive `relativeTimeMessage` and `weekLabelMessage`.
- **Pilot consumers, so knip and the provider are exercised:**
  - `src/core/guards/load-errors.ts` and `src/components/wg/LoadErrorBanner.tsx` (`Message` plus `useMessage`);
  - `src/app/api/email/unsubscribe/route.ts` (`requestLocale` plus `serverT`, German HTML unchanged; the PayPal return page it replaced is removed with PayPal). Package N adds the member locale from the token.
- `scripts/check-architecture.mjs` (`i18n-literal` on the AST, `i18n-catalog-import`) and `scripts/architecture-baseline.json` (regenerated).
- `tests/i18n-catalog.test.ts`, `e2e/support/i18n.ts` and `e2e/i18n-en-shell-smoke.spec.ts`.
- The `common` and `meta` catalogs.
- The `locale: 'de-DE'` fix in `e2e/pwa.spec.ts:288`, only if verification shows it is needed.

**Namespace files created here** (one file per locale each):

- `common`, `meta`, `shell`, `home`, `activity`
- `expenses`, `expenses-form`, `expenses-debts`, `expenses-import`, `expenses-abos`, `statement`
- `chores`, `events`, `shopping`, `inventory`, `pinnwand`, `chat`
- `settings`, `entry`, `auth`, `offline`
- `push`, `mail`, `audit`, `export`, `server-pages`

**Acceptance**

- A cookie `manawg_locale=en` renders `<html lang="en-GB">`, the skip link is English, and the provider serves English `common` strings (smoke spec).
- With no cookie and `de-DE`, output is unchanged. The German `<head>` snapshot for `/`, `/neu`, `/registrieren` and `/entdecken/<module>` (nonce and hashes normalized) is identical to `main`.
- `bundle:check` passes. The shared and per-route delta and the RSC/HTML gzip delta for `/` and `/wg/[code]` are recorded in the PR. If the gzip delta exceeds 30 KB, the D6 fallback is applied in this PR.
- `use-intl/core` works under `test:unit`. `pnpm audit --prod --audit-level high` passes.
- `[architecture] OK`. The new baseline contains only `i18n-literal` entries plus the 2 existing size entries.
- knip is clean. Every new module has a consumer.
- All [verify] items for D1, D6 and `pwa.spec.ts` are resolved and noted in `design.md`.

### Phase 2: Persistence and switch (1 agent, 1 PR, needs Phase 1)

**Owns**

- `src/core/db/schema.ts`: column, check, comment trim (D4).
- `drizzle/0037_*.sql`, the snapshot and the journal.
- `src/app/api/account/route.ts` (the re-export only) and the new `src/app/api/account/locale-patch.ts`.
- The locale lines only (Phase 5 edits these files later):
  - the two `insert(wgMembers)` calls in `src/app/api/wg/route.ts` and `src/app/api/wg/[code]/members/route.ts`;
  - the `.set()` in `src/app/api/wg/[code]/members/[id]/claim/route.ts`.
- `src/app/api/auth/sign-up/route.ts` (`options.data.locale`).
- `src/components/app/LanguageSwitch.tsx`.
- The language row in `ProfileTab.tsx` and the switch slot in `src/components/entry/LegalLinks.tsx`.
- `src/fixtures/api.ts` (the `PATCH /api/account` answer) and `e2e/i18n-en-switch.spec.ts`.

May run **in parallel with Phase 3**. Phase 3 packages must not touch the files above until this PR is merged. `ProfileTab.tsx` and `LegalLinks.tsx` are reserved for it.

**Acceptance**

- **Migration:** it applies cleanly on throwaway Postgres, `pnpm db:check` is green against it, and `drizzle-kit generate` produces no further diff.
- **`PATCH /api/account { locale }`:**
  - updates every row of the user and `user_metadata.locale`;
  - an invalid value gives a 400 with a code;
  - no session gives 401;
  - it passes the origin and rate-limit checks.
- **Switch spec green:** the choice persists over a reload, it works signed in and signed out, and it is disabled offline.
- **Line budget:** `schema.ts` stays at 984 by the check's count and the baseline is unchanged.
- **Handoff:** the owner is told that the production release (`release-production.yml`) runs the migration before the deploy.

### Phase 3: UI packages (parallel, needs Phase 1, at most 4 worktrees at a time)

- Each package is one PR, or two if the diff is above about 800 lines.
- Files not listed in any package stay with Phase 1 or a later phase.
- Globs are relative to `src/`.

| Pkg | Namespaces | Owns (globs) | DE lines (approx.) |
|---|---|---|---|
| A shell | `shell`, `home`, `activity` (client part) | `components/app/**` (except `LanguageSwitch.tsx`), `components/ui/**`, `components/animate-ui/**`, `components/brand/**`, `components/wg/*` (root files only, not `einstellungen/`; `LoadErrorBanner.tsx` after Phase 1), `app/wg/[code]/{layout,page,loading,error}.tsx`, `app/wg/[code]/_components/**`, `app/wg/[code]/_hooks/**`, `app/wg/[code]/aktivitaet/**`, `app/error.tsx`, `app/not-found.tsx`, `app/wg/not-found.tsx`, `app/global-error.tsx` (inline map, D6), `composition/{dashboard-today,dashboard-week-agenda,dashboard-insights,dashboard-balances,dashboard-data,dashboard-spend,activity-reminders,dashboard-links}.ts` | about 300 |
| B expenses | `expenses`, `expenses-form` | `features/expenses/**` except `components/{debts,import,abos,statement}/**`, `import-*.ts`, `ocr.ts`, `abo-*.ts`, `recurring-*.ts`, `monthly-statement*.ts`, `statement-mail.ts`, `statement-recipients.ts`, `debt-*.ts`, `debts.ts`, `settlement-scope.ts`, `reminders.ts`, `hooks/{use-abos-page,use-reminders-page}.ts`, `server/**`; plus `app/wg/[code]/ausgaben/**` | about 250 |
| C debts | `expenses-debts` | `features/expenses/components/debts/**` (incl. `settlement-errors.ts`), `features/expenses/{reminders,debts,settlement-scope}.ts`, `features/expenses/debt-*.ts`, `features/expenses/hooks/use-reminders-page.ts`, `app/wg/[code]/mahnungen/**` | about 110 |
| D import | `expenses-import` | `features/expenses/components/import/**`, `features/expenses/import-*.ts`, `features/expenses/ocr.ts`, `app/wg/[code]/import/**` | about 100 |
| E abos and statement | `expenses-abos`, `statement` | `features/expenses/components/{abos,statement}/**`, `features/expenses/{abo-*,recurring-*,monthly-statement*}.ts` (not `server/`), `features/expenses/hooks/use-abos-page.ts`, `app/wg/[code]/{abos,abrechnung}/**` | about 90 |
| F chores | `chores` | `features/chores/**` except `server/**`, `app/wg/[code]/putzen/**`; plus the `action` consumer lines in `app/wg/[code]/_components/TodayRow.tsx` (D11, after A is merged) | about 160 |
| G events | `events` | `features/events/**` except `server/**`, plus `app/wg/[code]/kalender/**` | about 90 |
| H shopping and inventory | `shopping`, `inventory` | `features/shopping/**` and `features/inventory/**` except `server/**`, plus `app/wg/[code]/{einkauf,vorraete}/**` | about 125 |
| I pinnwand and chat | `pinnwand`, `chat` | `features/pinnwand/**` and `features/chat/**` except `server/**`, plus `app/wg/[code]/{pinnwand,chat}/**`. Includes the `SystemMessage.tsx` `amountCents` fallback (D12) and `common.unknownPerson` at the chat and Pinnwand fallbacks. | about 130 |
| J settings | `settings` | `components/wg/einstellungen/**` except `ProfileTab.tsx` (until Phase 2 is merged) and `OfflineQueue*`/`offline-queue-*`; plus `app/wg/[code]/einstellungen/**` and `core/guards/settings-tabs.ts` | about 200 |
| K entry and auth | `entry`, `auth` | `components/entry/**` (except `LegalLinks.tsx` until Phase 2 is merged; the consent sentence is flagged for legal review), `components/auth/**`, `app/{page.tsx,EntryClient.tsx,use-account-name-prefill.ts}`, `app/{neu,einladung,entdecken,registrieren,auth}/**` (except the welcome-mail locale argument in `auth/callback/route.ts`, owned by N), `core/auth/{password-errors,auth-errors}.ts`, `core/infra/join-flow.ts`. Includes the German demo content in `PublicModulePreview.tsx`. | about 230 |
| L offline | `offline` | `core/offline/**`, `app/offline/**`, `components/wg/einstellungen/{OfflineQueue*,offline-queue-*}`. Includes the D11 flags with legacy prefix compatibility. | about 190 |

Package-specific acceptance, on top of the shared criteria:

- **A:**
  - `navigation.ts` labels come from catalogs. The route slugs and `iconKey` values are unchanged.
  - `global-error.tsx` renders English with the cookie set.
- **B, D:**
  - `parseEuroAmount` call sites pass the locale.
  - Entering `12.50` in English and `12,50` in German both save 1250 cents, and `1,234.50` in English saves 123450.
  - The OCR `'Unbekannt'` becomes `null` (D12).
- **F:**
  - The `catchUp` action replaces the label comparison and concatenation.
  - Completion sentences use ICU `select`, with no verb choice left in code (`chore-completion.ts:173`).
- **C:** `SettlementReviewDialog.tsx:58` uses ICU `select`.
- **H:** unit labels are mapped, and no stored values change.
- **L:**
  - A queued action with each legacy German prefix still behaves as today (unit test).
  - New actions store `Message` and the flags.

### Phase 4: Server senders (parallel, needs Phases 1 and 2)

| Pkg | Owns | Acceptance |
|---|---|---|
| M push | `core/notifications/**` (incl. the client modules `push-subscribe.ts`, `notification-warning.ts`, `notification-preferences.ts`, `push-priming.ts`, `web-push-errors.ts`), `public/sw.js` (fallback text, `VERSION` bump), the `amountFormatted` line in `features/expenses/server/import-commit.ts` | Dispatch selects `locale` and formats once per locale. Unit test: two recipients get de and en. German texts in `notifications.test.ts` are unchanged. |
| N mail | `core/mail/**`, `core/auth/welcome-mail.ts` plus its locale argument in `app/auth/callback/route.ts` and `app/api/auth/code-verify/route.ts`, `features/expenses/{statement-mail,statement-recipients}.ts`, `features/expenses/server/{statement-*,reminder-mail}.ts`, `app/api/email/unsubscribe/**`, the mail call lines in `app/api/wg/[code]/invitations/route.ts`, `app/api/account/route.ts:86` and `app/api/cron/maintenance/route.ts:122`, `supabase/templates/**`, `<root>/scripts/supabase-auth-templates.mjs` | Every mail renders in both locales. `templates.test.ts` German values are unchanged and an en case is added. Templates are validated locally with `supabase/templates/preview.mjs`. Pushing them to the hosted project is "Owner only". |
| O export, chat writer | `composition/export*.ts` (incl. `export-queries-*.ts`), `app/api/wg/[code]/export/**`, `features/expenses/server/expenses.ts` (chat payload `amountCents`) | English CSV uses `,` and `.` while German output is unchanged (unit test). Section labels are localized. New chat rows carry `amountCents` and `currency`. |

### Phase 5: Audit and activity (1 agent, 1–2 PRs, needs Phase 4)

**Owns**

- Every `summary:` site and direct `auditEvents` insert in `app/api/**`, `core/db/admin-succession.ts` and `features/*/server/**`. The insert sites are listed in section 5.
- `core/audit.ts`.
- `composition/{activity,activity-audit,dashboard-feed,dashboard-queries}.ts`.
- The `text`/`selfText` lines in `app/wg/[code]/_components/ActivityFeed.tsx`.
- `NOTIFICATION_FIELD_LABELS` in `app/api/wg/[code]/notifications/route.ts`.
- The remaining German literals in `app/api/**` that no other package owns, for example the `'Unbekannt'` names in `members/[id]/route.ts` and `reminders/balances/route.ts`, which become `null`.
- The `audit` namespace.

**Acceptance**

- Every audit event type has `audit.<type>.feed`, and all write sites store its parameters, with no `content*` keys.
- `summary` is produced by `serverT('de')` and is byte-identical to today's text (unit test per type).
- An English reader sees new rows in English and old rows in German (fixture plus E2E).
- "You" variants come from `selfText`, and the client regex is gone.
- The activity and dashboard feeds use `requestLocale`.
- No `i18n-literal` entry remains under `app/api/**`.

### Phase 6: Polish and lock (1 agent, needs everything else)

**Scope**

- Delete `shared/lib/plural.ts` and its test.
- Delete `mutationErrorMessage`, `RATE_LIMITED_MESSAGE`, `READ_ONLY_MESSAGE`, `SESSION_EXPIRED_MESSAGE`, `formatRelativeTime` and `formatWeekLabel` once knip reports them unused.
- Bump the SW `VERSION`.
- Consolidate duplicate generic strings into `common`.
- Review all `en/*.ts` once against the glossary and D16.
- Run the full English E2E sweep (every route, `expectNoGermanChrome`), including the `accessibility.spec.ts` label-in-name checks with the English cookie.
- Remove `i18n-literal` scaffolding that is no longer needed.

**Acceptance**

- The `i18n-literal` baseline is empty, so the rule applies with zero tolerance. The only `// i18n-ignore` lines left are the documented exemptions in D15.
- knip reports no unused files or exports.
- The English sweep is green at 320px in light and dark.
- All `openspec` tasks are checked, and the change is ready to archive.

### Ordering summary

```
P0 -> P1 -> { P2 || P3 (A..L, max 4 concurrent; F after A) } -> P4 (M || N || O) -> P5 -> P6
```

## 10. Open owner decisions

The defaults in this document apply until they are answered. None of them blocks building.

1. **Legal review of English consent and legal-link wording** (`LegalLinks.tsx:32–45`). Default: a faithful translation with links to the German pages labelled "(German)". It is flagged in the K PR and must be reviewed before release.
2. **Listing the `manawg_locale` cookie in the privacy policy**, which is in the landing repo. Default: none until the owner decides.
3. **en-GB versus en-US.** Default: en-GB.
4. **Whether Accept-Language counts for first visits (D3).** Default: yes.
5. **English names for the navigation sections.** Defaults: Household, Money, Together. "Start" becomes Home.
6. **English brand title, description and taglines ("Alltag teilen.")**, coordinated with the landing. Default: no English brand metadata, German stays.
7. **The Brandbook addenda (D16).**
8. **Owner actions:**
   - pushing the bilingual Supabase auth templates to the hosted project (Phase 4 N);
   - the production release with migration `0037` (`release-production.yml`), after the PayPal removal with `0036`.

## 11. Items to verify early

1. Phase 1:
   - `pnpm audit --prod --audit-level high` and install time with next-intl 4.14.x's transitive dependencies;
   - `use-intl/core` under `tests/support/register.mjs`.

   The peer compatibility with Next 15.5 and React 19 is already confirmed.
   Resolved in Phase 1: next-intl and use-intl 4.14.9 install with a frozen lockfile, `pnpm audit --prod --audit-level high` reports no known vulnerabilities, and `use-intl/core` runs under `test:unit`. The only warning is the unmet optional peer `@swc/helpers@>=0.5.17` (found 0.5.15) under next-intl > @swc/core.
2. Phase 1 (measured, production build with the fixture environment): shared first-load JS is 102.6 kB gzip (budget 120 kB), the heaviest route 34.3 kB (budget 55 kB), `bundle:check` passes. The HTML of `/` is 11,108 B gzip with the `de` cookie and 11,036 B with `en`. `/wg/MTE8PZAT` is 10,079 B (`de`) and 10,008 B (`en`). Before the provider, `/` was 10,102 B, so the catalog added about 1.0 KB gzip (3.4 KB raw) before the `meta` pre-seed, and the same constant applies to every page. The nested provider fallback is not needed yet; the projection for the full catalog is in D6.
   Deltas against the branch base `f8241466` (same build, fixture environment), gzip:
   - First-load JS: `/` +0.1 kB, `/neu` +0.3 kB, `/wg/[code]` +12.2 kB (234.0 to 246.2), `/wg/[code]/ausgaben` +12.8 kB, `/wg/[code]/chat` +0.9 kB. The shared set is unchanged (102.7 to 102.6 kB). The growth is the lazy message runtime chunk (11.7 kB, 11 of 22 pages), which the two budgets do not count.
   - HTML after the meta pre-seed (D14): `/` 10,082 to 11,461 B (`de`) and 11,431 B (`en`), `/wg/MTE8PZAT` 9,047 to 10,416 B (`de`) and 10,371 B (`en`), so +1.4 KB per page.
   - Decision and trigger for the runtime: D1.
3. Phase 1: `tsc` behaviour with strict ICU argument inference at scale (D6). Resolved, no problem at 400 messages.
4. Phase 1: whether `e2e/pwa.spec.ts:288` inherits `locale: 'de-DE'`. Resolved, it does.
5. Phase 1, only if the D6 fallback is needed: nested `NextIntlClientProvider` semantics.
6. Phase 4 N, hosted Supabase templates: whether `.Data` exposes `user_metadata` and whether `{{ if }}` works in subjects. Variable templating in subjects is confirmed by `subjects.json`.
7. Phase 0: the Brandbook chapter numbers for the number-format and "Ein Substantiv" rules. `brandbook.html` is one bundled line and could not be checked.

Resolved and removed from this list:

- the reminders module path (`features/expenses/reminders.ts`);
- the `schema.ts` table move (dropped, D4);
- manifest cookies (the manifest is a non-goal).