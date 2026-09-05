# Shell / entry implementation handoff

Status: requested shell source slice is implemented. Focused Biome check passes for the Shell/Entry scope. No typecheck, build, test, browser or graph gate is claimed.

Worktree: `/Users/abu/Company/manawg-app-mobile-redesign`

Branch: `codex/mobile-shadcn-redesign-20260905`

## Implemented in this resumed wave

- Four stable bottom destinations: Start, Haushalt, Finanzen, Austausch. Original route URLs remain. Nested household/finance/communication paths activate their parent; exact destinations use `aria-current="page"`, grouped destinations use `aria-current="location"`. Activity belongs to Start. Fixed the incomplete OpenCode expression mixing `??` and `||`.
- Shared WG header with current WG, search and visible Konto & WG entry. `SubNav` retains `label`/`items` and their counts, supplements canonical group destinations, and uses actual route links. On pages without their own SubNav, the shell supplies the same navigation. Its optional `fallback` prop uses a CSS `:has` rule to avoid two visible copies. No client measurement/registration system was introduced.
- `PageHeaderActions` keeps the public FormToggleButton/SettingsLink/CalendarLink props. Buttons have phone hit areas and stable visible Neu/Schließen labels. Navigation uses semantic links with upstream button variants.
- Start now uses actual Card/Item/Badge/Avatar/Empty/Skeleton composition: explained personal balance, seven/thirty-day WG totals, prioritized existing dashboard insights, open shopping/pinnwand work, assigned upcoming chores, visible recent activity, and the existing health data behind a real Animate UI collapsible. The old stat grid and empty sparkline are no longer used by Start.
- A new WG gets a real first-action/invite state, using existing setup flags, membership count, the actual WG name and invitation policy. It links to the existing shopping input and reuses the existing guarded share operation. No sample residents, generated activity or fabricated expenses were added.
- Public entry/discovery keeps membership lookup, retry, one-WG redirect and invitation precedence. It now uses real Item/Empty/Card surfaces, grouped navigation and access to every existing public module. The preview exposes no private WG content.
- Create/join/WG selection are fully recomposed with Card/Field/Input/Button. Existing initialization, saved drafts, URL/next intent, account switching, membership checks and request functions are retained. Back buttons are disabled while their mutation is pending. Creating is no longer presented as universally recommended over joining.
- E-mail and SMS are separate in-page shadcn tabs, with their controlled values/state in the existing parent. E-mail sign-in/sign-up/reset, phone request/verify/resend/change-number and Google sign-in/link behavior remain. Legacy recovery disclosure uses actual Animate UI with mounted content and inert closed fields.
- Password reset has the shared entry frame, FieldGroup, failure/expiry feedback and a return to request another link. The page's recovery marker comparison now requires a real user before comparing IDs: two missing values previously compared equal. API/client password-update logic and marker cleanup remain unchanged. This narrow guard correction is unverified and should receive focused recovery coverage in integration.
- Dashboard balance/activity helpers use original primitives; activity prose is readable with separated timestamp and amount. Sharing an invitation via clipboard is distinguished from the native share result in CopyCodeButton.
- Invite completion now uses Card/Badge/Button primitives, semantic tokens and a Lucide share icon. Native share, clipboard fallback, code copy, failure retry, WhatsApp deep link and skip behavior remain distinct and guarded.
- Datenschutz now uses the same phone spacing, semantic link treatment and full Card composition. All privacy statements remain unchanged.
- Final shell cleanup in `components/neu/InviteStep.tsx` removed the remaining WhatsApp-green and legacy spacing treatment. Its native-share success, clipboard fallback, code-copy success and failure states now have separate labels/live announcements while the existing AbortError cancellation and busy guards remain intact.
- Final privacy cleanup in `app/datenschutz/page.tsx` uses semantic `buttonVariants`, a Nova Card and compact phone-safe spacing. The privacy copy itself was not changed.
- Luna High lint repair fixed the remaining Shell/Entry Biome diagnostics: mechanical formatting/import fixes used `biome check --write`, while string concatenations were changed to template literals and loading/status containers became semantic `<output>` elements. No lint suppression or config weakening was added.
- The Start page includes a named `Module` region using the existing shadcn Card/Item primitives with accessible canonical links for Ausgaben, Einkauf, Putzen and Pinnwand. Descriptions use only loaded dashboard values and neutral loading labels; no sample counts are introduced.

## Changed paths in this resumed wave

All source paths below are relative to `apps/web/src/`.

- `app/wg/[code]/layout.tsx`
- `app/wg/[code]/page.tsx`
- `app/neu/NeuClient.tsx`
- `app/auth/reset/page.tsx`
- `components/app/navigation.ts` (new)
- `components/app/WgAppHeader.tsx` (new)
- `components/entry/EntryFrame.tsx` (new)
- `components/entry/PublicApp.tsx`
- `components/entry/WgWelcome.tsx`
- `components/wg/NavItem.tsx`
- `components/wg/SubNav.tsx`
- `components/wg/PageHeaderActions.tsx`
- `components/wg/dashboard/ActivityFeed.tsx`
- `components/wg/dashboard/BalanceBars.tsx`
- `components/wg/dashboard/CopyCodeButton.tsx`
- `components/wg/dashboard/DashboardSkeletons.tsx`
- `components/wg/dashboard/ModuleCard.tsx`
- `components/wg/dashboard/Panel.tsx`
- `components/wg/dashboard/Sparkline.tsx`
- `components/wg/dashboard/Stat.tsx`
- `components/wg/dashboard/TodayIcon.tsx`
- `components/neu/BackButton.tsx`
- `components/neu/Field.tsx`
- `components/auth/CredentialsAuth.tsx`
- `components/auth/LegacyAccountRecovery.tsx`
- `components/auth/PasswordResetForm.tsx`
- `components/auth/SocialLoginButtons.tsx`

`app/page.tsx`, `app/EntryClient.tsx`, `app/neu/page.tsx`, `app/neu/layout.tsx` and `app/entdecken/[module]/page.tsx` continue to route to the redesigned consumers without requiring source changes. Existing ErrorBox already composes the installed Alert and was retained.

## Remaining source work

None in the requested shell fix. The broader redesign still requires integration verification and any fixes found there. No additional source polishing was started after this boundary.

## Integration risks and deferred verification

- No tests, typecheck, build, browser, graph update, commits, pushes, dependency changes or live data/payment operations were run by this owner in this resumed wave. The focused Biome check was run twice after repair and passed on the final run; pnpm emitted its existing warning that the `pnpm` field is ignored.
- Only source reading and narrow text searches were used after the edits. Import organization/formatting and TypeScript compatibility still need the final project gates.
- Verify generated Tailwind `group-has` behavior with the completed feature pages: one local navigation should be visible, with page-supplied counters preserved. Check long labels, 320px width, text enlargement, keyboard and bottom safe area.
- Verify the new shared header alongside the independently owned chat/feature/settings headers. Those files were read-only for this owner.
- Verify busy/loading/stale/error Start states with actual API fixtures, new-WG flags, balance sign meaning, recurring/absence/announcement links, activity destinations and invite lock state.
- Verify all create/join invitation and nested-next cases, interrupted drafts, account switching, auth method changes, recovery marker expiry/no-user state, and local legacy-profile claim behavior.
- `ModuleCard`, `Stat` and `Sparkline` are retained compatibility exports; Start no longer imports them. Their removal was not started at the finalization boundary.

No owner-started command remains running. Other workers' edits, Support/Settings, WgContextProvider, root layout, shared UI, global CSS, dependency files, domain/API controllers and stored data formats were not modified by this owner.
