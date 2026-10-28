## 0. Spec and terminology

- [x] 0.1 Add `docs/brand/glossary-en.md` from design section 7; verify every glossary row of the design is present
- [x] 0.2 Add the English copy rules (D16) to `docs/brand/design-language.md`; verify `pnpm lint` passes
- [x] 0.3 Validate the change; verify `openspec validate add-english-locale --strict` passes

## 1. Infrastructure (one PR)

- [x] 1.1 Add `next-intl` and `use-intl` 4.x; verify `pnpm install --frozen-lockfile` and `pnpm audit --prod --audit-level high` pass
- [x] 1.2 Add `src/shared/i18n/locale.ts` (`resolveLocale`, `localeCookie`) with unit tests for cookie, q-sorted Accept-Language, `*` and invalid values
- [x] 1.3 Add `src/shared/i18n/intl.ts` (memoized formatters, `intlTag`) with unit tests for `de-DE` unchanged and `en-GB` `€12.50`
- [x] 1.4 Add all namespace catalog files, both registries, `Catalog<T>` parity typing and `src/i18n/next-intl.d.ts`; verify a missing English key fails `pnpm typecheck`
- [x] 1.5 Add `src/i18n/request.ts`, `withNextIntl` in `next.config.ts`, `src/core/i18n/{server-t,request-locale}.ts` and `src/shared/i18n/message.ts` (`Message`, `useMessage`)
- [x] 1.6 Wire `NextIntlClientProvider`, `lang` and the skip link in `src/app/layout.tsx`; verify the German `<head>` snapshot of `/`, `/neu`, `/registrieren` and `/entdecken/<module>` equals `main`
- [x] 1.7 Add optional `locale` to money, amount and time helpers, the English `parseEuroAmount` branch and `relativeTimeMessage`/`weekLabelMessage`; verify existing tests unchanged and new en cases pass
- [x] 1.8 Add additive `mutationError`, mark the D11 codes `// i18n-ignore` and replace the 7 literal sites with the constants; verify the unit suite passes without test edits
- [x] 1.9 Migrate the pilot consumers (`load-errors.ts`, `LoadErrorBanner.tsx`, `api/email/unsubscribe/route.ts`); verify `pnpm knip` is clean
- [x] 1.10 Add the `i18n-literal` (TypeScript AST) and `i18n-catalog-import` rules and regenerate the baseline; verify `[architecture] OK` and only `i18n-literal` plus the two size entries are baselined
- [x] 1.11 Add `tests/i18n-catalog.test.ts`, `e2e/support/i18n.ts` and `e2e/i18n-en-shell-smoke.spec.ts`; verify both pass and `e2e/pwa.spec.ts` stays German
- [x] 1.12 Record bundle and HTML gzip deltas for `/` and `/wg/[code]`; verify `bundle:check` passes and apply the nested provider fallback if the HTML delta exceeds 30 KB

## 2. Persistence and language switch (one PR)

- [x] 2.1 Add `wg_members.locale` with check constraint and migration `0037`; verify it applies on throwaway Postgres, `pnpm db:check` passes and a second `drizzle-kit generate` has no diff
- [x] 2.2 Store the request locale on WG creation, join and claim; verify with route unit tests
- [x] 2.3 Add `PATCH /api/account { locale }` (all memberships and account metadata) and `options.data.locale` on sign-up; verify 200, 400 and 401 cases
- [x] 2.4 Add `LanguageSwitch` to `ProfileTab.tsx` and `LegalLinks.tsx`, with fixture answer; verify `e2e/i18n-en-switch.spec.ts` (persistence, signed in and out, offline disabled, browser language)

## 3. UI packages (parallel, disjoint ownership per design section 9)

- [x] 3.1 Package A shell, navigation, dashboard, activity client, error pages; verify its English spec and empty baseline for owned files
- [x] 3.2 Package B expenses and expense form; verify English amount entry saves correct cents
- [x] 3.3 Package C debts, settlement, reminders page; verify English spec
- [x] 3.4 Package D import and OCR; verify English spec; OCR unknown payer is a control-character mapping key (not `null`, the member mapping is keyed by name) that the UI renders as `common.unknownPerson`
- [x] 3.5 Package E fixed costs and statement page; verify English spec
- [x] 3.6 Package F chores with `action` keys instead of German labels; verify English spec and no verb choice in code
- [x] 3.7 Package G calendar; verify English spec
- [x] 3.8 Package H shopping and supplies with unit labels; verify English spec and unchanged stored units
- [ ] 3.9 Package I noticeboard and chat; verify English spec and localized chat amounts
- [x] 3.10 Package J settings; verify English spec
- [x] 3.11 Package K entry and auth; verify English spec and flag the consent sentence for owner review
- [x] 3.12 Package L offline with review flags and legacy prefixes; verify unit tests for each legacy prefix and English spec

## 4. Server senders (parallel)

- [ ] 4.1 Package M push with per-recipient locale and SW fallback; verify a dispatch test with one de and one en recipient
- [ ] 4.2 Package N mails, unsubscribe page and Supabase templates; verify both locales render and German template tests are unchanged
- [ ] 4.3 Package O export and chat payload `amountCents`; verify English CSV uses `,` and `.` and German CSV is unchanged

## 5. Audit and activity

- [ ] 5.1 Store sentence parameters on every audit write, never content keys; verify a byte-identity test per event type for the German summary
- [ ] 5.2 Render feed `text` and `selfText` in the reader's locale with legacy fallback; verify English reader sees new rows in English and old rows in German
- [ ] 5.3 Replace remaining API fallback names with `null`; verify no `i18n-literal` entries remain under `app/api/**`

## 6. Polish and lock

- [ ] 6.1 Delete `pluralize`, `mutationErrorMessage`, the `*_MESSAGE` constants, `formatRelativeTime` and `formatWeekLabel`; verify `pnpm knip` is clean
- [ ] 6.2 Review all English catalogs against the glossary and D16; consolidate duplicates into `common`
- [ ] 6.3 Bump the SW `VERSION` and run the full English sweep at 320px in light and dark; verify every route passes `expectNoGermanChrome`
- [ ] 6.4 Verify the `i18n-literal` baseline is empty and all gates pass
