# Settings slice — mobile redesign report

## Changed files (presentation only, logic preserved)
- `apps/web/src/app/wg/[code]/einstellungen/page.tsx` — Tabs/TabsList/TabsTrigger/TabsContent, direct shadcn `buttonVariants` back link, Skeleton fallback, semantic tokens, max-w-md handset column, safe-area top/bottom, 44px tab targets.
- `apps/web/src/components/wg/einstellungen/Section.tsx` — Card/CardHeader/CardTitle/CardDescription/CardContent, border-border.
- `apps/web/src/components/wg/einstellungen/LinkRow.tsx` — semantic tokens, ChevronRight Lucide, 44px row.
- `apps/web/src/components/wg/einstellungen/ThemeOption.tsx` — Button default/outline, aria-pressed, 44px.
- `apps/web/src/components/wg/einstellungen/ProfileTab.tsx` — FieldGroup/Field/FieldLabel/Input/Button/Alert/Spinner, h-11 text-base editable, PayPal load/save errors preserved.
- `apps/web/src/components/wg/einstellungen/NotificationSection.tsx` — Animate Switch for push + 7 preferences, Field/Separator/NativeSelect/Button/Alert/Skeleton/Spinner, quiet-hours Von/Bis preserved.
- `apps/web/src/components/wg/einstellungen/AccessTab.tsx` — Animate Switch for joining, Button/Alert/Badge/Item/Separator/Input/Spinner, AlertDialog for leave + delete-code confirm with Title/Description/Media/Footer, member deactivate/reactivate preserved.
- `apps/web/src/components/wg/einstellungen/DataTab.tsx` — Button/NativeSelect/Field/Alert/Spinner, buttonVariants Link for import, JSON/CSV download + summary counts preserved.
- `apps/web/src/components/wg/einstellungen/OfflineQueueSection.tsx` — Button/Badge/Item/Alert/Spinner, retry/check/edit/remove-attachment/discard + draft-guard + server-compare preserved.
- `apps/web/src/components/wg/MemberDeactivateDialog.tsx` — AlertDialog with Title/Description/Media/Footer, Alert/Spinner, open-balances warn-but-allow + reversible semantics preserved.
- `apps/web/src/components/wg/ShareWgCard.tsx` — Card/Button/Alert/Spinner, QR/copy/link/native-share + joiningEnabled block preserved, no invite sent.
- `apps/web/src/components/wg/OfflineBanner.tsx` — Button/Spinner, online/queued/success/warning branches + scoped WG/member counts + force retry preserved.
- `apps/web/src/components/wg/OfflineQueueNotice.tsx` — Alert wrapper, queuedCount<=0 null preserved.
- `apps/web/src/app/wg/[code]/einstellungen/error.tsx` — unchanged, delegates to Foundation `WgRouteErrorBoundary`.

## Preserved contracts
- Account/profile: device-bound identity, PayPal PATCH, theme preference + haptics.
- WG/member/invite: joiningEnabled toggle, rotate with 2-step confirm + router.replace, security overview, active/inactive lists, isAdmin gating, deactivate (active:false) + reactivate (active:true) + refreshMembers.
- Auth/security: memberAuthHeader, member_not_verified/403 handling, SocialLoginButtons link variant + next hash, sign-out clears identity/forgetWg/push /.
- Destructive: leave clears local only, delete requires shareCode match + DELETE + 403 handling, dialogs are confirm-only, no real delete/leave/invite executed.
- Data/export: export summary fetch, JSON/CSV blob download, section mapping, import href, legal links.
- Preferences/offline: push subscribe/unsubscribe + resync, 7 toggles PATCH with rollback, quiet hours, test notification, queue read/write/sync, conflict notes, editHref/draft guard.
- Return/draft/retry: hash tabs (#profil/#benachrichtigungen/#zugang/#daten), dynamic single-tab mount, focus/aria, pending disabled + Spinner + visible labels, input retained on failure.

## Unfinished / needs verification team
- No tests/build/lint/browser/graph run per wave rules.
- Visual check at 320/390/430 + dark + reduced-motion + keyboard still owed to verification.
- Cross-slice link `#daten` from OfflineBanner assumes Daten tab hash, unchanged behavior.

## E2E navigation fix — 2026-09-05

- Replaced the Base-UI `Button render={<Link />}` back-link composition with a plain `next/link` styled by the official shadcn `buttonVariants` helper. This keeps the WG-scoped `href`, compact ghost/icon styling, focus behavior and visible `sr-only` accessible name while guaranteeing a semantic `<a>` in the rendered DOM.
- No settings tab/hash, permission, data/export, offline-queue or destructive behavior changed. No tests, build or commit were run as requested.
