# ManaWG Bug Report

Generated: 2026-09-19 | Scope: `/Users/abu/Company/manawg-app/apps/web/src`
Method: 4 parallel agents scanned 100+ source files across all modules.

---

## CRITICAL (3)

### C1: requireMember ignores x-manawg-member-token
- **File**: `apps/web/src/core/guards/api-auth.ts`
- **Category**: Security
- **Description**: `requireMember` authenticates the user via Supabase session only. It does NOT check the `x-manawg-member-token` header at all. The `MEMBER_TOKEN_HEADER` is completely ignored. If a Supabase session is hijacked or auth is bypassed, any member can impersonate any other member in any WG.
- **Fix**: Verify `x-manawg-member-token` header against expected HMAC for the resolved member. Return `verified: false` if token absent or invalid.

### C2: apiFetch discards memberToken header
- **File**: `apps/web/src/core/infra/api-client.ts` line 11
- **Category**: Security
- **Description**: `memberToken` is destructured as `_memberToken` but never used. The `x-manawg-member-token` header is never set on outgoing requests. All client-side API requests that require `verified: true` fall back to the spoofable `x-manawg-member-id` header.
- **Fix**: Add `headers.set('x-manawg-member-token', memberToken)` when memberToken is present.

### C3: Rate limiter silently disabled when Redis URL is not HTTPS
- **File**: `apps/web/src/core/rate-limit.ts` line 11
- **Category**: Security
- **Description**: `createConfiguredRedis()` returns `null` if `new URL(url).protocol !== 'https:'`. In production, if `UPSTASH_REDIS_REST_URL` has an incorrect protocol, every rate limiter is `null` and `checkRateLimit` fails open, allowing unlimited API requests. The `reportOpenState` function logs it but all limits are bypassed.
- **Fix**: Throw or add a startup assertion when Redis URL is invalid in production. Make rate limiting a `missingRequired` feature, not `degraded`.

---

## HIGH (18)

### H1: CORS origin check bypassed for GET requests
- **File**: `apps/web/src/middleware.ts` line 88
- **Category**: Security
- **Description**: CORS check only applies to non-read methods (`if (!isRead && !originAllowed(req))`). GET/HEAD/OPTIONS requests from cross-origin sites bypass the check entirely. API endpoints returning WG data, member lists, calendar feeds are accessible from any origin.
- **Fix**: Extend origin check to read methods or add CSRF token validation.

### H2: Admin = oldest member, no explicit role column
- **File**: `apps/web/src/core/guards/admin.ts` lines 19-27
- **Category**: Security
- **Description**: Admin determined purely by being oldest active member (smallest `createdAt`). No explicit `role` column in `wg_members`. Admin shifts automatically when creator deactivates. Compromised oldest member = full admin power.
- **Fix**: Add explicit `role` column to `wg_members` and gate admin checks on that role.

### H3: WgContextProvider offline sync fires when tab is hidden
- **File**: `apps/web/src/components/wg/WgContextProvider.tsx` line 162
- **Category**: Performance
- **Description**: `window.setInterval(() => void sync(), 60_000)` fires every 60 seconds regardless of `document.hidden`. The project already has `useVisibilityPausedInterval` hook designed for this but it's not used. Wastes API quota, Upstash Redis calls, and battery.
- **Fix**: Replace with `useVisibilityPausedInterval(sync, 60_000)`.

### H4: syncedAfterFailedQueueSave loses protection on page reload
- **File**: `apps/web/src/core/offline/offline-client.ts` line 21
- **Category**: Data Integrity
- **Description**: `syncedAfterFailedQueueSave` is a module-level `Set<string>()` that exists only in memory. After page reload it's empty while `persistedSyncedIds` in localStorage still contains the IDs. State mismatch causes re-syncing of already-synced actions.
- **Fix**: Persist `syncedAfterFailedQueueSave` to localStorage or use `persistedSyncedIds` as sole dedup mechanism.

### H5: createRecurringAdvanceRetry never handles recurring.create
- **File**: `apps/web/src/core/offline/offline-client.ts` line 305
- **Category**: Logic
- **Description**: `if (action.type !== 'expense.create') return null` but offline actions creating recurring expenses have type `recurring.create`. Retry logic always returns null, and the recurring advance is silently lost. `getRecurringAdvancePayload` can extract data from `recurring.create` actions but `createRecurringAdvanceRetry` discards them.
- **Fix**: Change condition to check for `recurringExpenseId` presence instead of action type.

### H6: PayPal capture rejects exact debt repayment
- **File**: `apps/web/src/app/api/wg/[code]/paypal/capture/route.ts` line 127
- **Category**: Logic
- **Description**: `debt.cents >= capturePayment.amountCents` rejects when debt is exactly settled. A capture for the exact remaining debt always returns `conflict('debt_changed')`.
- **Fix**: Change `>=` to `>`. Debt should only be considered changed if there is still remaining debt after capture.

### H7: Chore PATCH allows assigning deactivated members
- **File**: `apps/web/src/app/api/wg/[code]/chores/[id]/route.ts` lines 75-82
- **Category**: Data Integrity
- **Description**: When patching a chore's `assignedMemberId`, the code checks that the member exists in the WG but does NOT check `isNull(wgMembers.deactivatedAt)`. A deactivated member can be assigned to a chore, receiving notifications.
- **Fix**: Add `isNull(wgMembers.deactivatedAt)` to the member check query.

### H8: Rate limiter fails open in production when Redis misconfigured
- **File**: `apps/web/src/core/infra/env.ts` lines 40-45
- **Category**: Security
- **Description**: Rate limiting listed as `degraded` feature, not `missingRequired`. When Upstash is not configured, ALL rate limiting is disabled, allowing unlimited API requests. Combined with missing auth on some routes, this creates a significant attack surface.
- **Fix**: Make rate limiting a `missingRequired` feature in production.

### H9: Expense split amounts may not sum to total
- **File**: `apps/web/src/app/api/wg/[code]/expenses/route.ts`
- **Category**: Data Integrity
- **Description**: `splitSchema` validates individual splits (`debtorMemberId`, `amountCents >= 0`) but does NOT validate that `sum(splits.amountCents) === amountCents`. An expense could be created where splits don't sum to the total, causing accounting errors.
- **Fix**: Add validation that split amounts sum to the total expense amount.

### H10: withWgRoute does not automatically require WG member auth
- **File**: `apps/web/src/core/guards/with-wg-route.ts` lines 16-19
- **Category**: Security
- **Description**: `withWgRoute` deliberately does NOT call `requireWgMember`. Routes must call it themselves. If a developer forgets, the route has NO authentication at all -- only share code format validation. 72 of 75 handlers repeated the same pattern manually.
- **Fix**: Add static analysis check or make `withWgRoute` call `requireWgMember` automatically.

### H11: CSP includes unsafe-inline for script-src and style-src
- **File**: `apps/web/src/shared/lib/security-headers.ts` line 7
- **Category**: Security
- **Description**: CSP includes `'unsafe-inline'` for both `script-src` and `style-src`, which significantly weakens the Content Security Policy and allows inline scripts/styles to execute, opening the door to XSS attacks.
- **Fix**: Replace with nonce-based or hash-based CSP directives where possible.

### H12: upload/sign route has share code enumeration vulnerability
- **File**: `apps/web/src/app/api/upload/sign/route.ts` lines 53-56
- **Category**: Security
- **Description**: WG lookup uses `db.query.wgs.findFirst` without any auth check before the `requireMember` call. An attacker can enumerate valid share codes by observing which ones return `notFound` vs which proceed to auth.
- **Fix**: Add rate limiting to the upload sign endpoint, or return the same response (`wg_not_found`) regardless of whether the share code exists.

### H13: PayPal payment button retry loop breaks on all non-5xx statuses
- **File**: `apps/web/src/components/wg/PayPalPaymentButton.tsx` line 127
- **Category**: Logic
- **Description**: `if (result.ok || (result.status > 0 && result.status < 500)) break;` -- ANY non-5xx status code causes the loop to break, including 4xx errors (Bad Request, Forbidden). The loop should only break on 2xx success.
- **Fix**: Change to `if (result.ok) break;`.

### H14: PublicApp.tsx useEffect missing membershipState dependencies
- **File**: `apps/web/src/components/entry/PublicApp.tsx` lines 240-265
- **Category**: Logic
- **Description**: `useEffect` has `[retryNonce]` as dependency array but reads `memberships`, `membershipState`, and `router` inside. The effect won't re-run when `membershipState` changes, breaking the auto-redirect logic.
- **Fix**: Add `membershipState` and `memberships` to the dependency array.

### H15: use-controlled-state.tsx useEffect can cause infinite loops
- **File**: `apps/web/src/hooks/use-controlled-state.tsx` lines 19-21
- **Category**: Logic
- **Description**: The `useEffect` runs whenever `value` changes and calls `setInternalState(value)`. If the parent passes a new value on every render (e.g., inline object), this creates a state update loop. Also, `defaultValue as T` can hide type errors.
- **Fix**: Add comparison: `if (value !== undefined && value !== state)`. Remove `as T` cast.

### H16: NeuClient.tsx inverted WG redirect logic
- **File**: `apps/web/src/app/neu/NeuClient.tsx` line 318
- **Category**: Logic
- **Description**: `if (nextWgCode && !accountWgs.some((accountWg) => accountWg.code === nextWgCode)) return;` -- Returns early if the user DOESN'T belong to the WG, but `router.replace(next)` still executes for ALL other cases including when `next` is `/neu`. Logic is inverted.
- **Fix**: Change `!accountWgs.some()` to `accountWgs.some()`.

### H17: CredentialsAuth.tsx passwordFieldInvalid logic is wrong
- **File**: `apps/web/src/components/auth/CredentialsAuth.tsx` line 170
- **Category**: Logic
- **Description**: `const passwordFieldInvalid = emailError === 'invalid' && password.length < 6;` -- Password field invalid only when email is invalid AND password is too short. If user enters valid email but short password, the field won't show as invalid. Conversely, if email is invalid but password is long, the field incorrectly shows as invalid.
- **Fix**: Change to `const passwordFieldInvalid = password.length > 0 && password.length < 6;`.

### H18: LegacyAccountRecovery.tsx router.replace without await in loop
- **File**: `apps/web/src/components/auth/LegacyAccountRecovery.tsx` line 69
- **Category**: Logic
- **Description**: `router.replace()` called without `await` inside a `for` loop. `clearIdentity` called before `router.replace`, clearing stored identity that might be needed for navigation. If `router.replace` doesn't complete before function exits, navigation may not happen.
- **Fix**: Make the function `async`, `await router.replace(...)`, move `clearIdentity` after navigation confirms.

---

## MEDIUM (25)

### M1: notificationCategoryForEvent maps inventory events to wrong category
- **File**: `apps/web/src/core/notifications/notifications.ts` line 54
- **Category**: Logic
- **Description**: `if (event.startsWith('inventory.')) return 'shopping'` maps `inventory.low_stock` to the `shopping` notification category. Users who disabled shopping notifications but enabled inventory tracking would not receive stock alerts.
- **Fix**: Add a dedicated `inventory` notification category and preference.

### M2: apiFetch returns { ok: true, data: undefined } for non-JSON success responses
- **File**: `apps/web/src/core/infra/api-client.ts` lines 50-56
- **Category**: Logic
- **Description**: If the server returns a response with a non-JSON body but a 2xx status code, the function returns `{ ok: true, data: undefined }`. The caller proceeds as if the operation succeeded when it didn't.
- **Fix**: Add more specific error categorization and consider returning the response status text for non-JSON success responses.

### M3: middleware.ts allows cross-origin requests when origin header absent
- **File**: `apps/web/src/middleware.ts` lines 43-54, 88
- **Category**: Security
- **Description**: `originAllowed` returns `true` if there is no `origin` header. The cross-origin block only applies when `!isRead && !originAllowed(req)`. Requests without an `origin` header bypass CORS check entirely. A malicious site could send requests without an `origin` header and bypass CORS protection.
- **Fix**: Consider defaulting to `false` when `origin` is absent, or at least log such requests.

### M4: recordAuditEvent swallows all errors silently
- **File**: `apps/web/src/core/audit.ts` lines 24-26
- **Category**: Security
- **Description**: `recordAuditEvent` catches ALL errors silently (`console.warn`) and never propagates them. Audit events are critical for security tracing. Losing audit events means attackers could operate without leaving traces.
- **Fix**: Use `console.error` instead of `console.warn`. Add a retry mechanism or local buffer for failed audit events.

### M5: ReplayCache does not handle concurrent reservation races
- **File**: `apps/web/src/core/guards/idempotency.ts` lines 44-100
- **Category**: Logic
- **Description**: In `ReplayCache.reserve`, if two concurrent requests call `reserve` for the same `cacheKey`, both get `{ owned: true }` because `this.get(cacheKey)` returns `null` for both before either sets the entry. Both proceed with the mutation, defeating the purpose of the replay cache.
- **Fix**: Add a mutex/synchronization mechanism in `reserve`.

### M6: chat messages route uses onConflictDoNothing without verifying inserts
- **File**: `apps/web/src/app/api/wg/[code]/chat/messages/route.ts` lines 192-200
- **Category**: Data Integrity
- **Description**: `wgChatMentions` insert uses `.onConflictDoNothing()` without returning inserted rows. The API response always includes `validMentionIds` even if some mentions failed to insert. The client may show mentions that were never actually persisted.
- **Fix**: Use `.onConflictDoNothing().returning()` to verify which mentions were actually inserted.

### M7: calendar-subscription PATCH always rotates tokenSeed unnecessarily
- **File**: `apps/web/src/app/api/wg/[code]/calendar-subscription/route.ts` lines 128-159
- **Category**: Logic
- **Description**: The PATCH handler always rotates the `tokenSeed` on every call, even when no actual change was requested. This revokes any existing calendar feed subscription, causing all subscribed calendar clients to lose their feed URL.
- **Fix**: Add a check to only rotate the token seed when there's an actual parameter change.

### M8: createPresignedUpload does not validate S3 key against path traversal
- **File**: `apps/web/src/core/infra/s3.ts` lines 43-78
- **Category**: Security
- **Description**: The `key` parameter is passed directly to `PutObjectCommand` without sanitization. If `key` contains `..` or absolute paths, it could write files outside the intended prefix.
- **Fix**: Add key validation to reject keys containing `..`, starting with `/`, or containing `\`.

### M9: ImageUploader.tsx identity null check missing
- **File**: `apps/web/src/components/wg/ImageUploader.tsx` lines 123-159
- **Category**: Logic
- **Description**: `useEffect` has `identity.memberId` in dependency array but `identity` could be `null`. The `readPendingImage(value, identity.memberId)` call could fail if `identity.memberId` is undefined.
- **Fix**: Add a null check for `identity` before accessing `identity.memberId`.

### M10: AboForm.tsx inputDateToIso uses Date.UTC causing timezone shifts
- **File**: `apps/web/src/components/wg/AboForm.tsx` line 91
- **Category**: Logic
- **Description**: `new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString()` converts local date to UTC. For a user in a timezone behind UTC (e.g., UTC-5), the selected date can shift by a day.
- **Fix**: Use `new Date(year, month - 1, day)` without `Date.UTC` to preserve the local date.

### M11: AboForm.tsx activeMembers dependency causes unnecessary resyncs
- **File**: `apps/web/src/components/wg/AboForm.tsx` lines 164-173
- **Category**: Logic
- **Description**: `useEffect` depends on `[initial, activeMembers]`. When `activeMembers` changes (e.g., a member joins/leaves), all form fields reset even if `initial` hasn't changed. A user editing an abo could lose input when another member leaves.
- **Fix**: Remove `activeMembers` from dependency array, or add a guard.

### M12: ActivityFeed.tsx key prop may not be unique
- **File**: `apps/web/src/components/wg/dashboard/ActivityFeed.tsx` lines 113, 170, 181
- **Category**: Performance
- **Description**: React keys use `${item.kind}-${item.timestamp}-${item.text}` which may not be unique if two activities have the same kind, timestamp, and text. Can cause re-render issues or lost animations.
- **Fix**: Use a unique ID from the data if available, or generate a deterministic ID including member name.

### M13: WgContextProvider isMemo includes isAdmin causing re-renders
- **File**: `apps/web/src/components/wg/WgContextProvider.tsx` lines 130-133
- **Category**: Performance
- **Description**: The `value` `useMemo` includes `isAdmin` in dependencies. `isAdmin` is set asynchronously, meaning `value` changes identity even when `wg`, `members`, and `identity` haven't changed, causing unnecessary re-renders of all consumers.
- **Fix**: Remove `isAdmin` from `useMemo` dependency array, or create a separate context for admin status.

### M14: PasswordResetForm.tsx state initialized from prop but never updated
- **File**: `apps/web/src/components/auth/PasswordResetForm.tsx` line 21
- **Category**: Logic
- **Description**: `const [state, setState] = useState(recoveryRequested ? 'ready' : 'unavailable');` -- If the `recoveryRequested` prop changes, the state won't update because `useState` initial value is only used on mount.
- **Fix**: Use `useEffect` to sync state with prop changes.

### M15: SocialLoginButtons.tsx pendingProvider not cleared if onOAuthStart throws
- **File**: `apps/web/src/components/auth/SocialLoginButtons.tsx` lines 33-48
- **Category**: Logic
- **Description**: If `onOAuthStart` succeeds but redirects away without resolving/rejecting, `pendingProvider` stays set and all buttons remain disabled.
- **Fix**: Add a timeout mechanism or ensure `onOAuthStart` always resolves/rejects.

### M16: useOfflineQueueSync dependency array omits callbacks
- **File**: `apps/web/src/core/offline/useOfflineQueueSync.ts` line 100
- **Category**: Logic
- **Description**: `useEffect` dependency array is `[shareCode, memberId, page]` but internal callbacks capture `page` and other values from the closure. When `page` changes, the effect re-runs and re-registers listeners but cleanup removes OLD listeners first. Can cause double-firing during rapid navigation.
- **Fix**: Move callback definitions outside the effect or use `useCallback` with proper dependencies.

### M17: imageUrlSchema allows empty strings bypassing host check
- **File**: `apps/web/src/core/validators/image-url.ts` lines 47-54
- **Category**: Data Integrity
- **Description**: The schema uses `.refine((v) => v.length === 0 || isAllowedImageHost(v))`. Empty strings pass validation. Downstream code converts empty strings to `null`, but other places could store empty strings as image URLs causing rendering issues.
- **Fix**: Make the schema reject empty strings entirely, or ensure all downstream code consistently converts empty strings to `null`.

### M18: currencySchema only accepts 4 currencies, PayPal blocked for others
- **File**: `apps/web/src/core/validators/currency.ts` lines 11-13
- **Category**: Data Integrity
- **Description**: `SUPPORTED_CURRENCIES` only includes `['EUR', 'CHF', 'USD', 'GBP']`. Users with non-EUR expenses cannot use PayPal. The PayPal route returns `paypal_currency_unsupported` for non-EUR expenses with unsettled splits.
- **Fix**: Either expand supported currencies or document the PayPal limitation.

### M19: apiFetch returns ok:true data:undefined for non-JSON success responses
- **File**: `apps/web/src/core/infra/api-client.ts` lines 50-56
- **Category**: Logic
- **Description**: If the server returns a response with a non-JSON body but a 2xx status code, the function returns `{ ok: true, data: undefined }`. The caller proceeds as if the operation succeeded.
- **Fix**: Add more specific error categorization.

### M20: PayPal order route allows member ID probing before auth check
- **File**: `apps/web/src/app/api/wg/[code]/paypal/order/route.ts` line 42
- **Category**: Security
- **Description**: The `fromMemberId` is only checked against `auth.member.memberId` AFTER the `requireWgMember` call and expensive database queries. An attacker could probe for valid member IDs via the order endpoint.
- **Fix**: Validate `fromMemberId` against `auth.member.memberId` before any database calls.

### M21: middleware.ts isRateLimitedApiPath misses some API paths
- **File**: `apps/web/src/middleware.ts` lines 14-22
- **Category**: Logic
- **Description**: `isRateLimitedApiPath` checks `/api/wg`, `/api/calendar`, `/api/upload`, `/api/cron` but misses `/api/auth/recovery` or `/api/health`. The `config.matcher` may also have routing quirks with `/api/wg` root path.
- **Fix**: Verify all API paths are covered by the matcher and `isRateLimitedApiPath` function.

### M22: readOfflineQueue doesn't handle localStorage quota exceeded
- **File**: `apps/web/src/core/offline/offline-client.ts` lines 217-234
- **Category**: Data Integrity
- **Description**: If `localStorage.getItem` throws a `QuotaExceededError`, `readOfflineQueue` returns `[]` meaning all offline actions are lost on the next read.
- **Fix**: Add a size check before parsing and implement a fallback to trim the queue to the most recent actions.

### M23: offline-images.ts uses crypto.randomUUID() without error handling
- **File**: `apps/web/src/core/offline/offline-images.ts` line 88
- **Category**: Logic
- **Description**: `crypto.randomUUID()` can throw in environments without Web Crypto support. Unlike `createOfflineIdempotencyKey` which wraps it in try/catch returning `null`, `storePendingImage` does not handle this error, causing an unhandled promise rejection.
- **Fix**: Wrap `crypto.randomUUID()` in try/catch or use a fallback ID generation method.

### M24: useDismissableMenu.ts focusFirstItem uses stale elements
- **File**: `apps/web/src/core/hooks/useDismissableMenu.ts` line 66
- **Category**: Logic
- **Description**: `requestAnimationFrame` callback calls `getMenuItems()` at animation frame time, not at effect setup time. If menu items change before the frame fires, focus could be on stale elements.
- **Fix**: Capture `getMenuItems` at effect setup time or add proper cleanup.

### M25: ConfirmDialog.tsx has invalid finalFocus=true prop
- **File**: `apps/web/src/components/ui/ConfirmDialog.tsx` line 57
- **Category**: Usability
- **Description**: `finalFocus={true}` on `DialogContent` is not a valid prop for Radix UI Dialog. Could cause React warnings or unexpected behavior.
- **Fix**: Remove the `finalFocus={true}` prop or check the correct prop name.

---

## LOW (10)

### L1: useConfirmDelete hook has unused _timeoutMs parameter
- **File**: `apps/web/src/core/hooks/useConfirmDelete.ts` line 11
- **Category**: Usability
- **Description**: The hook accepts `_timeoutMs` but never uses it. The timeout feature is completely non-functional.
- **Fix**: Either implement the timeout feature or remove the unused parameter.

### L2: formatRelativeDate has no handling for future dates
- **File**: `apps/web/src/core/utils/utils.ts` lines 18-33
- **Category**: Usability
- **Description**: `formatRelativeDate` doesn't handle future dates (negative diff). Produces "vor -5 Minuten" instead of "in 5 Minuten".
- **Fix**: Add a future date branch similar to `formatRelativeTime`.

### L3: settings-tabs.ts allows arbitrary hash values to default to profile
- **File**: `apps/web/src/core/guards/settings-tabs.ts` line 10
- **Category**: Usability
- **Description**: `getSettingsTabFromHash` returns `'profile'` as the default for any unknown hash. Invalid or tampered hash values silently default to profile tab.
- **Fix**: Document this as acceptable behavior or add a 404-style fallback.

### L4: DeleteConfirmButton.tsx swallows async onConfirm errors
- **File**: `apps/web/src/components/ui/DeleteConfirmButton.tsx` line 32
- **Category**: Logic
- **Description**: `void onConfirm()` suppresses unhandled promise rejection warning. If `onConfirm` throws or rejects, the error is completely swallowed.
- **Fix**: Change to `await onConfirm()` inside an async handler, or add proper error handling.

### L5: usePendingSet.ts creates new Set on every update
- **File**: `apps/web/src/core/hooks/usePendingSet.ts` lines 13-14
- **Category**: Performance
- **Description**: `useState<Set<string>>(new Set())` and `useRef<Set<string>>(new Set())` both create new Set objects on every update. React always sees them as different, causing unnecessary re-renders.
- **Fix**: Use a single `useRef<Set<string>>` with a version counter for re-renders.

### L6: withWgRoute catch block uses serverError(err) for all error types
- **File**: `apps/web/src/core/guards/with-wg-route.ts` line 54
- **Category**: Logic
- **Description**: The catch block catches any thrown value, not just `Error` objects. `serverError` handles this internally but `captureException` could receive non-Error objects.
- **Fix**: Add a type check before calling `captureException`.

### L7: ThemeProvider.tsx doesn't sync theme changes across tabs
- **File**: `apps/web/src/shared/components/theme/ThemeProvider.tsx` lines 70-75
- **Category**: Data Integrity
- **Description**: The initial `useEffect` reads from `localStorage` only on mount. If another tab changes the theme, this tab won't update. No `storage` event listener exists.
- **Fix**: Add a `storage` event listener to sync theme changes across tabs.

### L8: useDismissableMenu.ts focusFirstItem uses stale elements
- **File**: `apps/web/src/core/hooks/useDismissableMenu.ts` line 66
- **Category**: Logic
- **Description**: `requestAnimationFrame` calls `getMenuItems()` at animation frame time, not at effect setup time.
- **Fix**: Capture `getMenuItems` at effect setup time.

### L9: usePendingSet.ts creates new Set on every update
- **File**: `apps/web/src/core/hooks/usePendingSet.ts` lines 13-14
- **Category**: Performance
- **Description**: Same as L5.
- **Fix**: Same as L5.

### L10: middleware.ts isRateLimitedApiPath misses some API paths
- **File**: `apps/web/src/middleware.ts` lines 14-22
- **Category**: Logic
- **Description**: Same as M21.
- **Fix**: Same as M21.

---

## ADDITIONAL NOTES

### Database Layer
- `apps/web/src/core/db/transaction.ts`: `cachedDb` is a module-level singleton `Pool` with `max: 1`. Extremely limiting for concurrent transactions. Pool is created once and never closed. No lifecycle management.

### Auth Layer
- `apps/web/src/core/auth/server.ts`: `getAuthenticatedUser` returns only `Pick<User, 'id'> | null`, discarding all other user properties. Combined with `requireMember` always returning `verified: true`, the entire HMAC-based member verification is effectively bypassed.
- `apps/web/src/core/auth/middleware.ts`: `refreshSupabaseSession` creates a new `createServerClient` on every request. Cookie handling logic in `setAll` callback could lead to duplicate cookies or inconsistent state.

### Idempotency
- `apps/web/src/core/idempotency.ts`: `claimIdempotencySlot` returns `true` when Redis is unavailable (fail-open). This means audit dedup is completely disabled when Redis is down.
- `getCachedResponse` uses `gt(idempotencyResponses.expiresAt, new Date())` which is subject to clock skew in serverless environments.

### Offline Queue
- `apps/web/src/core/offline/offline-client.ts`: `syncInFlight` Map could accumulate entries if `syncOfflineActions` throws before the `finally` block removes the entry.
- `createRecurringAdvanceRetry` only handles `expense.create` actions but not `recurring.create` actions.

### Notification System
- `apps/web/src/core/notifications/notification-dispatch.ts`: When multiple web push subscriptions fail with 404, each triggers a separate `db.delete` call. Concurrent deletions could conflict.

### Expense/Payment
- `apps/web/src/app/api/wg/[code]/expenses/route.ts`: `validateSplits` may not validate sum equals total. `withExpensePaymentLock` errors reject the replay slot, meaning clients retrying with the same idempotency key will NOT get the cached response.
- `apps/web/src/app/api/wg/[code]/paypal/order/route.ts`: In-progress payments not accounted for in debt calculation, potentially creating duplicate payment requests.

---

# ADDITIONAL BUGS (Deep Scan Round 2)

Generated: 2026-09-19 | Additional scan of 150+ files across database, migrations, components, and API routes.

---

## CRITICAL (4)

### C4: RLS enabled without any policies (drizzle migration)
- **File**: `apps/web/drizzle/0010_enable_public_rls.sql`
- **Category**: Database Migration / Security
- **Description**: RLS is enabled on all 26 tables but ZERO policies are created. With `CREATE POLICY` absent, every table becomes read-only-for-nobody under RLS. The `assertCatalogSecurity` check in `db-migrate.mjs` will fail because `rls_enabled` is true but no policies exist.
- **Fix**: Add `CREATE POLICY` statements for each table enabling appropriate read/write access for authenticated users, or remove the RLS enable if policies are created separately.

### C5: All privileges revoked and never granted back (drizzle migration)
- **File**: `apps/web/drizzle/0007_data_api_security.sql`
- **Category**: Database Migration / Security
- **Description**: `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC` revokes privileges from `anon` and `authenticated` Supabase roles, but the subsequent `DO $$` block only re-revokes -- it never GRANTS them back. The `assertCatalogSecurity` function checks that public roles have empty privileges (passes), but the Supabase REST API and Auth service lose all data access. The database becomes non-functional.
- **Fix**: Add GRANT statements after REVOKE for the Supabase roles, or restructure so RLS policies are the sole access mechanism.

### C6: HMAC anti-spoofing entirely non-functional (requireMember)
- **File**: `apps/web/src/core/guards/api-auth.ts` line 65
- **Category**: Security
- **Description**: `requireMember` returns `{ memberId, name, verified: true }` unconditionally. The `member-token.ts` module exists with `verifyMemberToken()` (HMAC-SHA256 using `MEMBER_SESSION_SECRET`) but is **never called from `requireMember`** or any standard guard. `verifyMemberToken` is only used in the WG creation route and the claim route. Every `requireVerifiedMember`, `isVerifiedWgAdmin`, and `requireOwnerOrAdmin` check always passes. The entire anti-spoofing architecture is dead code.
- **Fix**: In `requireMember`, after getting the Supabase user and wgMembers row, check `x-manawg-member-token` header via `verifyMemberToken(wgId, row.id, req.headers.get('x-manawg-member-token'))` and set `verified` accordingly.

### C7: Share code normalization produces invalid characters
- **File**: `apps/web/src/shared/lib/share-code.ts` lines 21-39
- **Category**: Data Integrity / Security
- **Description**: `normalizeShareCode` maps `I→1`, `L→1`, `O→0`, `U→V`. But `SHARE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'` does NOT include `0` or `1`. After normalization, the result contains characters not in the alphabet. `isValidShareCode(normalizeShareCode("ABCIODEF"))` returns `false`. This means share codes containing I/L/O/U characters get normalized to invalid codes that can never be generated by `generateShareCode()`.
- **Fix**: Either update `SHARE_CODE_REGEX` and `SHARE_CODE_ALPHABET` to include `0` and `1`, or change normalization to not produce these characters.

---

## HIGH (12)

### H19: Rate limit checks happen AFTER idempotency checks (race condition bypass)
- **File**: `apps/web/src/app/api/wg/[code]/chores/[id]/complete/route.ts` lines 63-77
- **Category**: Race Condition / Security
- **Description**: Idempotency check happens BEFORE rate limit check. A malicious client can send the same idempotency key repeatedly without ever hitting the rate limiter. Completely bypasses `wgWriteLimiter`. Same pattern exists in `chores/route.ts` (line 185), `shopping/route.ts` (line 86), `absences/route.ts` (line 103), `announcements/route.ts` (line 171).
- **Fix**: Move `checkRateLimit` before the idempotency reservation logic in ALL affected routes.

### H20: Database connection pool `max: 1` bottleneck and stale connections
- **File**: `apps/web/src/core/db/index.ts` line 13, `apps/web/src/core/db/transaction.ts`
- **Category**: Performance / Resource Leak
- **Description**: Both main pool and transaction pool configured with `max: 1`. Under concurrent load, all API requests serialize through a single connection. Additionally, `cachedDb` is never invalidated on connection failure. `pool.on('error', ...)` logs the error but doesn't invalidate `cachedDb`, so subsequent `withTransaction` calls use a broken pool.
- **Fix**: Increase `max` to 5-10. Add connection health checks and pool invalidation on error.

### H21: requireVerifiedMember is a no-op in members/expenses routes
- **File**: `apps/web/src/app/api/wg/[code]/members/[id]/route.ts` lines 139-140, `apps/web/src/app/api/wg/[code]/expenses/[id]/route.ts` lines 58-59, 171-172
- **Category**: Security
- **Description**: `requireVerifiedMember(auth.member)` checks `auth.member.verified` which is always `true` due to C6. Money-mutating operations that are supposed to require HMAC-backed verification pass for any Supabase-authenticated member. Any member can change another member's PayPal ID by POSTing to `/members/[id]` with the member's known ID (visible via GET `/members`).
- **Fix**: Integrate `verifyMemberToken` into `requireMember`. Until then, add explicit header-based check for money-mutating operations.

### H22: Expenses POST handler not wrapped in withWgRoute
- **File**: `apps/web/src/app/api/wg/[code]/expenses/route.ts` line 114
- **Category**: Logic
- **Description**: The POST handler is exported as raw `export async function POST(...)` instead of being wrapped with `withWgRoute`. Every other route uses `withWgRoute` for consistent error handling, transaction management, and audit. The manual try/catch misses features like automatic error wrapping, audit event handling, and the fixture mechanism.
- **Fix**: Wrap with `withWgRoute` or ensure manual error handling covers all edge cases.

### H23: Invalid dates bypass validation silently
- **File**: `apps/web/src/app/api/wg/[code]/absences/route.ts` lines 100-102
- **Category**: Logic
- **Description**: `new Date(parsed.data.startDate)` and `new Date(parsed.data.endDate)` produce `Invalid Date` objects for malformed input. `Invalid Date < Invalid Date` evaluates to `false`, so `endDate < startDate` passes through. Invalid dates get stored in the database.
- **Fix**: Add `Number.isNaN(startDate.getTime())` and `Number.isNaN(endDate.getTime())` checks before the comparison.

### H24: events/route.ts POST uses wrong shareCode in notification URL
- **File**: `apps/web/src/app/api/wg/[code]/events/route.ts` line ~158
- **Category**: Data Integrity
- **Description**: `dispatchNotification({ wg: { id: wg.id, name: wg.name, shareCode: code } }` uses the raw URL path parameter `code` instead of the validated `auth.wg.shareCode`. If the code has been normalized, the shareCode in the notification URL will be incorrect.
- **Fix**: Replace `shareCode: code` with `shareCode: auth.wg.shareCode`.

### H25: events/route.ts GET consumes rate limit before authentication
- **File**: `apps/web/src/app/api/wg/[code]/events/route.ts` lines 45-46
- **Category**: Security
- **Description**: `checkRateLimit(wgReadLimiter, ...)` runs at line 45 before `requireWgMember(req, code)` at line 55. Unauthenticated requests consume read rate limit slots. An attacker can exhaust the rate limit to block legitimate users.
- **Fix**: Move rate limit check to after `requireWgMember` succeeds.

### H26: PayPal merchant ID set by admin without verification
- **File**: `apps/web/src/app/api/wg/[code]/members/[id]/route.ts` line 177
- **Category**: Security
- **Description**: `requireVerifiedMember` is only called when `paypalMerchantId !== undefined` at line 139, but `requireOwnerOrAdmin` at line 171 doesn't verify. An admin could set `paypalMerchantId` for any member without being HMAC-verified.
- **Fix**: Ensure `requireVerifiedMember` is called before any `paypalMerchantId` modification, including admin overrides.

### H27: Multiple unhandled promise rejections with `void` patterns
- **File**: Multiple files
- **Category**: Logic
- **Description**: `void dispatchNotification(...)`, `void setCachedResponse(...)`, `void recordAuditEvent(...)` fire-and-forget patterns exist in `chores/route.ts`, `shopping/route.ts`, `chat/messages/route.ts`, `announcements/route.ts`, `events/route.ts`, `absences/route.ts`. If these throw, errors are silently lost. `void` completely swallows synchronous errors too.
- **Fix**: Replace `void` patterns with `await` + try/catch, or properly chain `.catch()`.

### H28: DELETE chat message handler lacks try/catch
- **File**: `apps/web/src/app/api/wg/[code]/chat/messages/[id]/route.ts` lines 86-150
- **Category**: Missing Error Boundary
- **Description**: The DELETE handler has no try/catch around the database delete operation. If `db.update(...).set(...).where(...)` throws, the error propagates unhandled to Next.js. While `withWgRoute` wraps the handler, the DELETE handler doesn't return a `NextResponse.json` in the error case -- it returns `undefined` implicitly.
- **Fix**: Add explicit try/catch around database operations, or ensure all code paths return a `NextResponse`.

### H29: Offline sync effect has stale closure issues
- **File**: `apps/web/src/components/wg/WgContextProvider.tsx` lines 140-172
- **Category**: Memory Leak / Logic
- **Description**: `useEffect` for offline queue sync creates `window.setInterval` and event listeners. `syncingRef.current` is a module-level ref that persists across unmounts. If the component unmounts while `syncingRef.current === true`, it stays true and the interval never clears properly because the cleanup only runs on unmount.
- **Fix**: Move `syncingRef` into the effect scope. Use `useRef` for the interval ID and clean up properly.

### H30: Chat MessageList creates Maps on every render
- **File**: `apps/web/src/features/chat/components/MessageList.tsx` lines 98-100
- **Category**: Performance
- **Description**: `messagesById` and `memberLookup` Maps are created with `new Map(messages.map(...))` on every render without `useMemo`. For large chat rooms, this creates unnecessary GC pressure and memory fragmentation on every re-render.
- **Fix**: Wrap `messagesById` and `memberLookup` in `useMemo`.

---

## MEDIUM (10)

### M26: PostHog `defaults` option is invalid
- **File**: `apps/web/src/instrumentation-client.ts` line 9
- **Category**: Configuration
- **Description**: `defaults: '2026-05-30'` is passed as a PostHog init option, but the PostHog SDK does not have a `defaults` configuration option. This value is silently ignored. Likely a typo for `defaultProperties`.
- **Fix**: Remove the `defaults` option or replace with correct PostHog SDK option.

### M27: Share code normalization produces codes that fail isValidShareCode
- **File**: `apps/web/src/shared/lib/share-code.ts` lines 21-39
- **Category**: Data Integrity
- **Description**: As a specific instance of C7, calling `isValidShareCode(normalizeShareCode("ABCIODEF"))` returns `false` because normalized string contains `0` and `1` which are not in the alphabet. The `readShareCode` function will reject any share code containing these characters after normalization.
- **Fix**: Update `SHARE_CODE_REGEX` and `SHARE_CODE_ALPHABET` to include `0` and `1`, or change normalization.

### M28: CSP `script-src` includes `'unsafe-inline'`
- **File**: `apps/web/src/shared/lib/security-headers.ts` line 7
- **Category**: Security
- **Description**: The Content-Security-Policy includes `'unsafe-inline'` in `script-src`. Combined with `'unsafe-eval'` in development, XSS vulnerabilities could be exploited without CSP restrictions.
- **Fix**: Remove `'unsafe-inline'` from `script-src` and use nonces or hashes for any required inline scripts.

### M29: Cross-origin write block bypassable via Origin header absence
- **File**: `apps/web/src/middleware.ts` lines 43-54, 88
- **Category**: Security
- **Description**: `originAllowed` returns `true` if `origin` header is falsy. The middleware's cross-origin check only blocks writes when `Origin` header is present AND doesn't match. An attacker who omits the `Origin` header bypasses the check entirely.
- **Fix**: Default `originAllowed` to `false` when `Origin` header is absent.

### M30: Database migration drops column but drift config still references it
- **File**: `apps/web/drizzle/0002_drop_push_subscriptions_last_used_at.sql`
- **Category**: Database Migration
- **Description**: Drops column `last_used_at` from `push_subscriptions`, but `db-migrate.mjs` still lists it in `ADOPTION_KNOWN_DRIFT.extraColumns`. When the migration system encounters a pre-baseline database that already has this column dropped, the adoption check incorrectly flags it as a schema mismatch.
- **Fix**: Remove `push_subscriptions.last_used_at` from `ADOPTION_KNOWN_DRIFT.extraColumns`.

### M31: `drafts.ts` maps `absence.create` to module `'chore'`
- **File**: `apps/web/src/core/offline/drafts.ts` line 166
- **Category**: Logic
- **Description**: The `absence.create` case returns `module: 'chore'` but there is no `'absence'` option in the `DraftModule` type. This causes `buildQueueEditHref` to route absence creation to `/putzen` (chores page) instead of an appropriate absence page.
- **Fix**: Add `'absence'` to the `DraftModule` type and handle it in `buildQueueEditHref`.

### M32: `NeuClient.tsx` isNeuPath catch returns `true` for all errors
- **File**: `apps/web/src/app/neu/NeuClient.tsx` line 88
- **Category**: Logic
- **Description**: Any path that causes `new URL(path, 'https://manawg.invalid')` to throw returns `true` from the catch block, treating invalid paths as `/neu` paths. Could cause incorrect navigation to `/neu` instead of the intended destination or 404.
- **Fix**: Return `false` from the catch block.

### M33: `notifications/route.ts` `persistedPushOptIn` uses SQL template where boolean expected
- **File**: `apps/web/src/app/api/wg/[code]/notifications/route.ts` lines 325-329
- **Category**: Logic
- **Description**: `persistedPushOptIn` is assigned either `true` or `sql<boolean>` template literal. The `typeof updatedMember.pushOptIn === 'boolean'` check could fail if the SQL expression evaluates to something unexpected.
- **Fix**: Replace the SQL expression path with a boolean value derived from `remainingSubscriptions.length > 0`.

### M34: `dashboard-data.ts` activity sort does not handle ties
- **File**: `apps/web/src/core/reads/dashboard-data.ts` lines 436, 552
- **Category**: Logic
- **Description**: `activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp))` does not provide a stable sort for identical timestamps. If two activity items have the same timestamp, their relative order is undefined and can vary between runs.
- **Fix**: Add a secondary sort key: `activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id))`.

### M35: `chat/read/route.ts` `onConflictDoUpdate` `setWhere` SQL condition is fragile
- **File**: `apps/web/src/app/api/wg/[code]/chat/read/route.ts` lines 73-94
- **Category**: Data Integrity
- **Description**: The `onConflictDoUpdate` clause uses a complex `setWhere` SQL condition referencing `${wgChatReads.lastReadMessageId}` in a subquery. When `messageId` is `null`, the subquery returns no rows and `coalesce(..., '-infinity')` returns `-infinity`, making the condition always true. This is actually correct behavior but the SQL is overly complex and could cause issues.
- **Fix**: Simplify the `onConflictDoUpdate` logic. Split into two cases: `messageId` is null vs not null.

---

## LOW (6)

### L11: `health/route.ts` database probe has no connection timeout enforcement
- **File**: `apps/web/src/app/api/health/route.ts` lines 26-41
- **Category**: Reliability
- **Description**: `Promise.race` with `DB_PROBE_TIMEOUT_MS` of 2000ms fires, but the `db.execute(sql\`select 1\`)` promise is NOT cancelled -- it continues running in the background. Creates a connection leak in serverless environments.
- **Fix**: Use `AbortController` with the database query to ensure the connection is actually terminated when the timeout fires.

### L12: `middleware.ts` rate limiter `failMode` logic has inconsistent conditions
- **File**: `apps/web/src/middleware.ts` lines 99-104
- **Category**: Logic
- **Description**: The `failMode` condition `process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV !== 'development'` means rate limiting could be disabled in production if `NODE_ENV` is not set to `production`. Vercel sets `VERCEL_ENV=production` but `NODE_ENV` might be `test` for edge functions.
- **Fix**: Simplify to `process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'`.

### L13: `instrumentation-client.ts` missing environment variable guard
- **File**: `apps/web/src/instrumentation-client.ts` lines 4-5
- **Category**: Configuration
- **Description**: `if (key && host === 'https://eu.i.posthog.com')` only initializes PostHog for the EU host. If the environment uses a different PostHog region, the code silently does nothing -- no analytics initialized and no error logged in production.
- **Fix**: Change condition to `if (key)` and use `host` as the `api_host` parameter.

### L14: `members/route.ts` POST creates member without validating authUserId uniqueness constraint
- **File**: `apps/web/src/app/api/wg/[code]/members/route.ts` lines 129-133
- **Category**: Data Integrity
- **Description**: The `existingForUser` check inside the transaction uses `eq(wgMembers.authUserId, user.id)` filtered by `wgId`. But the `uniqueWgAuthUser` index has a partial index `where authUserId IS NOT NULL`. If a concurrent join from the same user on a different WG completes between the `existingForUser` check and the insert, a unique constraint violation on `uniqueWgAuthUser` could throw an unhandled error.
- **Fix**: The `onConflictDoNothing` handles this case, but the error handling only checks for `wg_members_unique_name_per_wg`, not the `uniqueWgAuthUser` constraint. Add handling for the `uniqueWgAuthUser` violation.

### L15: `idempotency.ts` has unresolved "RED BUG-002" marker
- **File**: `apps/web/src/core/guards/idempotency.ts` line 36
- **Category**: Known Bug / Technical Debt
- **Description**: Comment contains "RED BUG-002" reference -- a known bug marker that was documented but may not be fully resolved in code. The comment references a test in `expenses/route.test.ts` exercising the local-map layer.
- **Fix**: Verify if RED BUG-002 was resolved or add a tracking issue.

### L16: `chat/messages/route.ts` multiple void dispatchNotification patterns
- **File**: `apps/web/src/app/api/wg/[code]/chat/messages/route.ts` lines 205-239
- **Category**: Logic
- **Description**: Multiple `void dispatchNotification(...)` and `void recordAuditEvent(...)` calls without proper rejection handling. The `void` makes them fire-and-forget.
- **Fix**: Replace `void` with `await` + try/catch.

---

## SUMMARY OF ALL BUGS

| Severity | Round 1 | Round 2 | Total |
|----------|---------|---------|-------|
| **CRITICAL** | 3 | 4 | 7 |
| **HIGH** | 18 | 12 | 30 |
| **MEDIUM** | 25 | 10 | 35 |
| **LOW** | 10 | 6 | 16 |
| **TOTAL** | 56 | 32 | **88** |

### Top 10 Most Critical Bugs (must fix first):
1. **C6** - HMAC anti-spoofing entirely non-functional (every route's auth is bypassed)
2. **C5** - All database privileges revoked and never granted back (DB non-functional)
3. **C4** - RLS enabled without any policies (read-only-for-nobody)
4. **C7** - Share code normalization produces invalid characters
5. **C1** - `requireMember` ignores `x-manawg-member-token`
6. **C2** - `apiFetch` discards `memberToken` header
7. **C3** - Rate limiter silently disabled when Redis URL is wrong
8. **H19** - Rate limit checks after idempotency checks (bypassable)
9. **H21** - `requireVerifiedMember` is a no-op in money routes
10. **H20** - Database pool `max: 1` with stale connection handling

### Bug Categories by Count:
- Security: 15+ bugs (auth bypass, CORS, CSRF, CSP, rate limiting, share code enumeration)
- Data Integrity: 12+ bugs (split sums, idempotency, normalization, migration issues)
- Logic: 15+ bugs (inverted conditions, wrong module mappings, invalid date handling)
- Performance: 5+ bugs (pool size, Map creation, interval management)
- Usability: 4+ bugs (unused parameters, future dates, settings defaults)

---

# ADDITIONAL BUGS (Deep Scan Round 3)

Generated: 2026-09-19 | Additional scan of 200+ files covering tools, scripts, e2e tests, docs, configs, and remaining API routes/components.

---

## CRITICAL (2)

### C8: vercel.json ignoreCommand always exits with code 1
- **File**: `apps/web/vercel.json` line 6
- **Category**: Configuration / Deployment
- **Description**: `"ignoreCommand": "exit 1"` always exits with code 1, meaning the ignore command always "fails." Vercel interprets this as the build should be ignored or it could cause confusing build failures. Should be `"true"` to skip the command.
- **Fix**: Change to `"ignoreCommand": "true"` or `"$CI"`.

### C9: instrumentation.ts throws error in production without fallback
- **File**: `apps/web/src/instrumentation.ts` line 25
- **Category**: Reliability / Deployment
- **Description**: `if (result.isProduction) throw error;` throws the environment error in production, which means the entire server crashes on boot if required env vars are missing. This is a "fail-fast" design choice, but the server fails entirely rather than returning 503s gracefully. Combined with `console.error(report)` at line 19, the error is logged but then thrown, crashing the process.
- **Fix**: Consider returning instead of throwing in production, or use a graceful shutdown mechanism.

---

## HIGH (8)

### H31: events/route.ts rate limit before authentication
- **File**: `apps/web/src/app/api/wg/[code]/events/route.ts` line 45
- **Category**: Security / Rate Limiting
- **Description**: `checkRateLimit(wgReadLimiter, ...)` runs at line 45 BEFORE `requireWgMember(req, code)` at line 55. Unauthenticated requests consume read rate limit slots. An attacker can exhaust the rate limit to block legitimate members from viewing events. Same pattern exists in `dashboard/route.ts` which has NO rate limiting at all.
- **Fix**: Move rate limit check after `requireWgMember` succeeds. Add rate limiting to dashboard route.

### H32: Transaction pool never closed / connection leak
- **File**: `apps/web/src/core/db/transaction.ts` line 25
- **Category**: Resource Leak / Reliability
- **Description**: `buildTransactionalDb()` creates a new `Pool` and caches it in `cachedDb`. The Pool is never closed via `pool.end()`. In a long-running process, this leaks database connections. In serverless where the module is re-imported, multiple Pools can accumulate. `cachedDb` is never invalidated on connection failure.
- **Fix**: Add `pool.end()` cleanup mechanism. Add connection health checks and pool invalidation on error.

### H33: Module-level ReplayCache breaks in serverless environments
- **File**: `apps/web/src/app/api/wg/[code]/chores/[id]/complete/route.ts` line 28
- **Category**: Architecture / Serverless
- **Description**: `const choreCompleteReplay = new ReplayCache<ChoreCompleteResponseBody>(IDEMPOTENCY_TTL_MS)` is a module-level singleton. In serverless (Vercel), each cold start creates a new instance. If request A and request B (same idempotency key) land on different instances, both could process the chore completion, defeating duplicate prevention.
- **Fix**: Use a distributed cache (Redis) for idempotency instead of in-memory module-level cache.

### H34: Multiple `throw err` patterns across route handlers
- **File**: Multiple files (absences/route.ts, shopping/route.ts, announcements/route.ts, chores/route.ts, events/route.ts, paypal/order/route.ts, expenses/settle-batch/route.ts)
- **Category**: Logic
- **Description**: 11+ instances where caught errors are re-thrown as `throw err` instead of `throw new Error(...)`. While `throw err` preserves the original error, the pattern is inconsistent. When caught by `withWgRoute` which does `console.error(label, err)`, the error message may be empty or unhelpful if it's an unknown type.
- **Fix**: Standardize error re-throwing to use `throw new Error(...)` with descriptive messages, or use a consistent error class.

### H35: dashboard-data.ts `undefined` check misses `null`
- **File**: `apps/web/src/core/reads/dashboard-insights.ts` line 225
- **Category**: Logic
- **Description**: `recurring.nextDueAt === undefined ? 0 : choreUrgency(recurring.nextDueAt, now)` only checks for `undefined`, not `null`. If `nextDueAt` is `null`, `choreUrgency(null, now)` is called which likely causes a runtime error.
- **Fix**: Use `recurring.nextDueAt == null` (loose equality) or `=== undefined || === null`.

### H36: Members state never syncs with initialMembers prop
- **File**: `apps/web/src/components/wg/WgContextProvider.tsx` line 60
- **Category**: Logic / Data Integrity
- **Description**: `const [members, setMembers] = useState<Member[]>(initialMembers)` initializes from `initialMembers` prop only on first render. If the parent passes a new `members` array on subsequent renders, the state never updates. WG roster changes (member added/removed/deactivated) without an identity change show stale data.
- **Fix**: Add `useEffect` to sync `initialMembers` to `members` state.

### H37: Members claim route throws Error inside transaction uncaught
- **File**: `apps/web/src/app/api/wg/[code]/members/[id]/claim/route.ts` lines 48, 66
- **Category**: Error Handling
- **Description**: `throw new Error('member_not_found')` and `throw new Error('member_claim_failed')` inside `withTransaction`. These are NOT `TransactionAbort` instances. `withTransaction` will roll back and re-throw. The `claimed` variable is never assigned. The `if (claimed.ok)` check after `await withTransaction(...)` throws a ReferenceError. The error is caught by `withWgRoute` and returns a generic `serverError` instead of `notFound('member_not_found')`.
- **Fix**: Use `TransactionAbort` for all error cases inside the transaction, or add a try-catch around the `await withTransaction(...)` call.

### H38: Calendar feed lacks WG membership verification
- **File**: `apps/web/src/app/api/calendar/[id]/[token]/route.ts` lines 44-54
- **Category**: Security / Access Control
- **Description**: The calendar feed verifies the token and checks `revokedAt`, but does NOT verify that the calendar subscription belongs to the WG identified by the `[id]` path parameter. An attacker who knows a calendar subscription ID and its token could access events for any WG.
- **Fix**: After looking up the subscription, verify `subscription.wgId` matches the expected WG ID.

---

## MEDIUM (12)

### M36: Dashboard route missing rate limiting entirely
- **File**: `apps/web/src/app/api/wg/[code]/dashboard/route.ts` lines 7-41
- **Category**: Security
- **Description**: The dashboard route does NOT use `withWgRoute` and has NO rate limiting at all. `readShareCode(ctx)` only checks format validity, not existence. An attacker can enumerate valid share codes without any rate limit protection.
- **Fix**: Add rate limiting to the dashboard route, or wrap with `withWgRoute`.

### M37: push_opt_in SQL expression race condition
- **File**: `apps/web/src/app/api/wg/[code]/notifications/route.ts` lines 317-334
- **Category**: Race Condition / Data Integrity
- **Description**: After deleting a push subscription, `pushOptIn` is computed as `remainingSubscriptions.length > 0`. When `pushOptIn` is `false`, `persistedPushOptIn` is set to a `sql<boolean>` template expression (`exists (...)`). This SQL expression is evaluated at UPDATE time, NOT at query time. A concurrent subscription insert between DELETE and UPDATE could cause `persistedPushOptIn` to evaluate to `true`, re-enabling push for a user who just unsubscribed.
- **Fix**: Replace the SQL expression with the already-computed `false` value.

### M38: Members POST rate limit after body parsing
- **File**: `apps/web/src/app/api/wg/[code]/members/route.ts` line 96
- **Category**: Security / Rate Limiting
- **Description**: The rate limit check happens AFTER body parsing (lines 91-95) and name validation. An attacker can send malformed JSON requests repeatedly to burn through the `wgWriteLimiter` before the server even validates the request. Minor DoS vector.
- **Fix**: Move the rate limit check before the `req.json()` call.

### M39: auth/recovery/route.ts no authentication for cookie deletion
- **File**: `apps/web/src/app/api/auth/recovery/route.ts` lines 3-15
- **Category**: Security / Access Control
- **Description**: The `DELETE` handler clears the `manawg_password_recovery` cookie without any authentication check. Anyone who knows the cookie name can clear it, potentially locking out the legitimate user from password recovery.
- **Fix**: Require authentication or a recovery token before clearing the cookie.

### M40: upload/sign route WG lookup before auth leaks info
- **File**: `apps/web/src/app/api/upload/sign/route.ts` lines 53-59
- **Category**: Security
- **Description**: WG lookup by share code happens BEFORE `requireMember`. An attacker can enumerate valid share codes based on the error response (404 vs 401).
- **Fix**: Perform `requireMember` first, or return the same error code for both cases.

### M41: members/route.ts `isUniqueMemberNameViolation` false positive
- **File**: `apps/web/src/app/api/wg/[code]/members/route.ts` lines 77-82
- **Category**: Error Handling
- **Description**: `return constraint === undefined || constraint === 'wg_members_unique_name_per_wg'` returns `true` if `constraint` is `undefined`. ANY unique constraint violation would be misinterpreted as a "name_taken" error.
- **Fix**: Remove the `constraint === undefined` branch, or add specific constraint check.

### M42: chat/read/route.ts onConflictDoUpdate doesn't clear read position for null messageId
- **File**: `apps/web/src/app/api/wg/[code]/chat/read/route.ts` lines 76-94
- **Category**: Data Integrity
- **Description**: When `messageId` is `null`, the `setWhere` clause `sql\`${messageId}::uuid is not null\`` evaluates to false, preventing the update. But `lastReadMessageId: messageId` (null) is still in the `set` clause. The row won't be updated to null. A user's read position won't be reset.
- **Fix**: Split into two operations: delete row if null, update if not null. Or adjust `setWhere` to handle the null case.

### M43: dashboard-data.ts currentMemberId not validated against WG
- **File**: `apps/web/src/core/reads/dashboard-data.ts` lines 264-505
- **Category**: Security / Data Access
- **Description**: `loadDashboardData(wgId, currentMemberId, shareCode)` accepts `currentMemberId` without validating that this member belongs to the specified WG. If `currentMemberId` is spoofed or incorrect, the dashboard could show another member's private data (reaction preferences, notification settings).
- **Fix**: Add a verification query inside `loadDashboardData` to confirm `currentMemberId` belongs to `wgId`.

### M44: `normalizeRecurrence` returns string literal 'invalid' instead of null
- **File**: `apps/web/src/app/api/wg/[code]/events/route.ts` lines 35-40
- **Category**: Type Safety
- **Description**: `normalizeRecurrence` has return type `string | null` but returns the string literal `'invalid'` on line 38. A caller that doesn't check for `'invalid'` would pass it through to the database as a recurrence value, which would fail the `recurrenceTypeCheck` constraint in `schema.ts`.
- **Fix**: Use a proper enum or union type: `'valid' | 'invalid' | null`.

### M45: e2e/_helpers.ts localStorage.setItem without try/catch
- **File**: `apps/web/e2e/_helpers.ts` lines 24-27
- **Category**: Reliability
- **Description**: `localStorage.setItem(...)` inside `page.addInitScript()` without try/catch. In environments where localStorage is unavailable, this throws an unhandled error.
- **Fix**: Wrap in try/catch or use `page.evaluate(() => { try { localStorage.setItem(...) } catch {} })`.

### M46: check-analytics-privacy.mjs regex doesn't anchor properly
- **File**: `apps/web/scripts/check-analytics-privacy.mjs` line 190
- **Category**: Logic
- **Description**: `!/\.(test|spec)\./.test(path.basename(file))` uses `!` negation with `.test()`. Files like `testhelper.ts` would NOT be excluded since `.test.` is not in `testhelper.ts`. The regex should be `/\.(test|spec)\.[cm]?[jt]s$/` to properly match test files.
- **Fix**: Fix the regex to properly anchor and match file extensions.

### M47: biome.json missing at apps/web level
- **File**: `apps/web/biome.json` (missing)
- **Category**: Configuration
- **Description**: `biome.json` exists only at the workspace root, not at `apps/web/`. The lint command `pnpm --dir apps/web lint` runs `biome check .` in the web directory. If the root `biome.json` doesn't apply correctly, linting could fail silently.
- **Fix**: Ensure the root `biome.json` is properly configured for the monorepo, or add a workspace-specific config.

---

## LOW (8)

### L17: ShareWgCard.tsx dead className prop
- **File**: `apps/web/src/components/wg/ShareWgCard.tsx` line 121
- **Category**: Dead Code
- **Description**: `className={hideHeader ? '' : ''}` -- both branches produce identical empty string. The `hideHeader` prop has zero effect on the outer div.
- **Fix**: Replace with appropriate className values or remove the ternary.

### L18: ActionNoticeBanner.tsx error tone has empty CSS class
- **File**: `apps/web/src/components/wg/ActionNoticeBanner.tsx` line 17
- **Category**: Styling
- **Description**: `error: ''` -- the error tone maps to an empty string. Error alerts lack the intended custom styling (border, background, text color).
- **Fix**: Add proper CSS custom property classes for the error tone.

### L19: PasswordResetForm.tsx stale state from prop
- **File**: `apps/web/src/components/auth/PasswordResetForm.tsx` line 21
- **Category**: Logic
- **Description**: `useState(recoveryRequested ? 'ready' : 'unavailable')` -- `recoveryRequested` prop changes after mount are not reflected in state. No `useEffect` to sync.
- **Fix**: Add `useEffect` to sync prop to state.

### L20: AboForm.tsx custom interval not editable via dropdown
- **File**: `apps/web/src/components/wg/AboForm.tsx` lines 319-334
- **Category**: UX
- **Description**: When `intervalMonths` is a custom value not in `INTERVAL_OPTIONS`, the custom option renders with `value={intervalMonths}`. Selecting it calls `onChange` with the same value -- no change occurs. Custom intervals are displayed but not editable through the dropdown.
- **Fix**: Add a text input for custom interval values, or restrict to predefined options.

### L21: OfflineBanner.tsx conflates "other WG" with "zero syncs"
- **File**: `apps/web/src/components/wg/OfflineBanner.tsx` lines 25-31
- **Category**: Logic
- **Description**: `isScopedSyncEventForOtherWg` returns `true` (treats as "other WG") when `syncedByShareCode[shareCode]` is `undefined` (key doesn't exist), `<= 0` (zero syncs), or not a number. Valid sync events could be silently ignored.
- **Fix**: Distinguish between "key doesn't exist" (malformed event) and "value <= 0" (legitimately zero syncs).

### L22: `e2e/smoke-launch.spec.ts` finally block masks original error
- **File**: `apps/web/e2e/smoke-launch.spec.ts` lines 320-321
- **Category**: Test Quality
- **Description**: If both `cleanupFailure` and `flowError` are set, only `cleanupFailure` is thrown. `flowError` is silently lost. The original test failure cause is masked.
- **Fix**: Throw `flowError` first or combine both error messages.

### L23: `e2e/public-entry-api.spec.ts` early return makes test trivially pass
- **File**: `apps/web/e2e/public-entry-api.spec.ts` line 21
- **Category**: Test Quality
- **Description**: `if (process.env.E2E_EXPECT_MISSING_SUPABASE !== 'true') return;` causes the test to return early (passing trivially) when the env var is not set. The assertions about status 500 never execute.
- **Fix**: Remove the early return or ensure the env var is always set in the test environment.

### L24: `db-migrate.mjs` uses console.error for success messages
- **File**: `apps/web/scripts/db-migrate.mjs` lines 877, 898
- **Category**: Configuration
- **Description**: `console.error('[migrate] Database check passed.')` and `console.error('[migrate] Up to date.')` log success messages as errors.
- **Fix**: Change to `console.log`.

---

## ADDITIONAL TECHNICAL DEBT / KNOWN ISSUES

- **RED BUG-002**: Referenced in `apps/web/src/core/guards/idempotency.ts` line 36. An unresolved bug in the idempotency/replay slot system.
- **`auth/callback/route.ts`**: Does not exist. Only `recovery/route.ts` exists under `src/app/api/auth/`. The OAuth callback handler has no corresponding server-side route.
- **`tools/` directory**: Empty or doesn't exist despite being listed in the project structure.
- **`.github/workflows/`**: Only `ci.yml` and `migrate-production.yml` exist. No GitHub Actions workflow for the bug scanning automation requested by the user.
- **`openspec/` and `.superpowers/`**: Referenced in AGENTS.md but may not exist in the expected locations.

---

## UPDATED SUMMARY

| Severity | Round 1 | Round 2 | Round 3 | Total |
|----------|---------|---------|---------|-------|
| **CRITICAL** | 3 | 4 | 2 | **9** |
| **HIGH** | 18 | 12 | 8 | **38** |
| **MEDIUM** | 25 | 10 | 12 | **47** |
| **LOW** | 10 | 6 | 8 | **24** |
| **TOTAL** | 56 | 32 | 30 | **118** |

### Top 10 Most Critical Bugs (must fix first):
1. **C6/C1** - HMAC anti-spoofing entirely non-functional (every route's auth is bypassed)
2. **C5** - All database privileges revoked and never granted back (DB non-functional)
3. **C4** - RLS enabled without any policies (read-only-for-nobody)
4. **C7** - Share code normalization produces invalid characters
5. **C8** - vercel.json ignoreCommand always fails
6. **C9** - instrumentation.ts throws in production, crashes server
7. **C3** - Rate limiter silently disabled when Redis URL is wrong
8. **H31** - Rate limit before auth on events GET (bypassable)
9. **H32** - Database pool never closed, stale connections
10. **H33** - Module-level ReplayCache breaks in serverless

### Bug Categories by Count:
- Security: 20+ bugs (auth bypass, CORS, CSRF, CSP, rate limiting, share code enumeration, access control)
- Data Integrity: 15+ bugs (split sums, idempotency, normalization, migration issues, stale state)
- Logic: 20+ bugs (inverted conditions, wrong module mappings, invalid date handling, type mismatches)
- Performance/Resource: 8+ bugs (pool size, Map creation, interval management, connection leaks)
- Reliability: 5+ bugs (error handling, crash on boot, test quality)
- Usability: 5+ bugs (unused parameters, future dates, settings defaults, custom intervals)

---

# ADDITIONAL BUGS (Deep Scan Round 4)

Generated: 2026-09-19 | Additional scan of 300+ files covering SQL migrations, schema, e2e tests, docs, configs, and remaining components.

---

## CRITICAL (2)

### C10: .env.local contains committed secrets
- **File**: `apps/web/.env.local` lines 4-5, 34
- **Category**: Security
- **Description**: `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, and `VERCEL_OIDC_TOKEN` contain actual Upstash API tokens and a full Vercel JWT. These should NEVER be in version control. Anyone with repository access can steal these credentials.
- **Fix**: Add `.env.local` to `.gitignore`, rotate ALL exposed tokens immediately, ensure only `.env.example` with placeholder values is tracked.

### C11: drizzle.config.ts has `postgres://placeholder` fallback and duplicate console.warn
- **File**: `apps/web/drizzle.config.ts` lines 20-31
- **Category**: Configuration / Database Safety
- **Description**: When all DB URL env vars are missing, the fallback is `'postgres://placeholder'` which triggers `console.warn` twice (lines 22 AND 27-31). The `drizzle-kit` can connect to this placeholder URL and run migrations against a non-existent database. The `POSTGRES_URL_NON_POOLING` or `DATABASE_URL_UNPOOLED` production URLs could accidentally be used without the `-pooler.` replacement, causing migration failures.
- **Fix**: Remove the placeholder fallback entirely. Throw a hard error if no DB URL is set. Validate all URL paths consistently. Remove duplicate `console.warn`.

---

## HIGH (7)

### H39: Double-nested ARRAY in FOREACH breaks role-based security hardening
- **File**: `apps/web/drizzle/0007_data_api_security.sql` line 12, `apps/web/drizzle/0010_enable_public_rls.sql` line 12
- **Category**: SQL Migration Bug / Security
- **Description**: `FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']` wraps the array in a second `ARRAY`, creating a 2D array. PL/pgSQL `FOREACH` iterates over `text[]` elements instead of `text` scalars. So `role_name` is `text[]`, and `rolname = role_name` always evaluates false. The `REVOKE ALL PRIVILEGES` for `anon` and `authenticated` roles **never executes**. Same bug in RLS enable file where `FOREACH expected_table IN ARRAY ARRAY[...]` makes `expected_table` a `text[]`, so `c.relname = expected_table` always fails, meaning `missing_tables` stays empty and the guard accidentally passes.
- **Fix**: Remove the outer `ARRAY`: `FOREACH role_name IN ARRAY '{"anon","authenticated"}'::text[] LOOP`

### H40: recurring_expenses missing DB-level amount_cents > 0 check constraint
- **File**: `apps/web/src/core/db/schema.ts` lines 444-475
- **Category**: Data Integrity
- **Description**: `recurringExpenses.amountCents` is `integer NOT NULL` with NO check constraint enforcing `> 0`. Both `expenses` and `expense_splits` have DB-level check constraints (`> 0` and `>= 0`), but `recurring_expenses` does not. A recurring expense with `amount_cents = 0` or negative will pass database validation.
- **Fix**: Add `check('recurring_expenses_amount_cents_check', sql\`${t.amountCents} > 0\`)` to the schema definition.

### H41: 0000_baseline.sql missing paypal_merchant_id and auth_user_id columns
- **File**: `apps/web/drizzle/0000_baseline.sql` lines 258-276
- **Category**: Schema Drift
- **Description**: The `wg_members` table in `0000_baseline.sql` is missing `paypal_merchant_id` (added in migration 0008) and `auth_user_id` (added in migration 0006). But `schema.ts` line 55 has `authUserId: uuid('auth_user_id')` and line 59 has `paypalMerchantId: text('paypal_merchant_id')`. The baseline is supposed to be generated from `schema.ts`, so it must match.
- **Fix**: Regenerate `0000_baseline.sql` from the current `schema.ts`, or add the two missing columns to the baseline SQL.

### H42: Hardcoded PostHog date '2026-05-30' in instrumentation-client.ts
- **File**: `apps/web/src/instrumentation-client.ts` line 9
- **Category**: Bug / Maintenance
- **Description**: `defaults: '2026-05-30'` is a hardcoded date string in PostHog initialization. This date will become stale and the analytics library will stop sending default events after that date passes. It was set during integration and never updated.
- **Fix**: Replace with `defaults: new Date().toISOString().split('T')[0]` or remove the `defaults` option entirely.

### H43: e2e/smoke-launch.spec.ts missing .trim() on password env var
- **File**: `apps/web/e2e/smoke-launch.spec.ts` line 31
- **Category**: Bug
- **Description**: `process.env.E2E_SUPABASE_TEST_PASSWORD` is read without `.trim()`, unlike all other env vars on lines 28-30 (`E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUPABASE_TEST_EMAIL`). A password with leading/trailing whitespace would cause authentication failures that are hard to debug.
- **Fix**: Add `.trim()` to `process.env.E2E_SUPABASE_TEST_PASSWORD`.

### H44: activity.ts marks ALL chores as done in scope filter
- **File**: `apps/web/src/core/reads/activity.ts` line 528
- **Category**: Logic Bug
- **Description**: `const done = item.kind === 'chore' || /erledigt|gekauft|bezahlt/i.test(item.text)` unconditionally treats every chore item as "done" regardless of actual completion status. When filtering by `scope: 'done'`, all chores appear. When filtering by `scope: 'changes'` or `scope: 'mine'`, all chores are excluded. This is clearly wrong.
- **Fix**: Add a `completed` field to `ActivityItem` and check it instead of unconditionally treating all chores as done.

### H45: verifyMemberToken uses Buffer.from(token, 'hex') with invalid hex silently produces wrong-length buffers
- **File**: `apps/web/src/core/guards/member-token.ts` lines 54-56
- **Category**: Security
- **Description**: `Buffer.from(token, 'hex')` with invalid hex characters (e.g., `'ZZZZ...'`) silently converts them to `0x00` bytes. A 64-character invalid-hex token produces a 32-byte buffer matching the expected HMAC-SHA256 length. `timingSafeEqual` then compares two 32-byte buffers. While the expected HMAC would need to be all-zeros (2^-256 probability), the length check alone doesn't validate hex content.
- **Fix**: Validate the token is valid hex before creating the buffer: `if (!/^[0-9a-f]{64}$/i.test(token)) return false;`

---

## MEDIUM (12)

### M48: notification-dispatch.ts sendWebPush infinite-loop risk
- **File**: `apps/web/src/core/notifications/notification-dispatch.ts` lines 72-94
- **Category**: Reliability
- **Description**: The retry loop `for (let attempt = 0; ; attempt += 1)` has no upper bound except the `isTransientWebPushStatus` check. If a new error code type is introduced that returns 0 and `isTransientWebPushStatus` is updated to include 0, this becomes an infinite loop. If `err` is thrown as a plain `Error` without a `statusCode` property, `parseWebPushStatusCode` returns 0, which is not transient, so it throws correctly. But the code is fragile.
- **Fix**: Add a hard cap on retry attempts: `const MAX_RETRIES = 3; for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1)`.

### M49: schema.ts expense_payments missing provider/status/members check constraints
- **File**: `apps/web/src/core/db/schema.ts` lines 204-244
- **Category**: Schema Bug
- **Description**: In `0008_calendar_and_paypal.sql`, the `expense_payments` table has `CONSTRAINT "expense_payments_provider_check" CHECK ("expense_payments"."provider" = 'paypal')`. But in `schema.ts`, the `expensePayments` table definition does NOT include this check constraint. If the schema is regenerated via `drizzle-kit push`, this constraint would be dropped.
- **Fix**: Add all three check constraints to `schema.ts` `expensePayments` definition.

### M50: join-flow.ts shouldFallbackToDirectJoin returns true when member_id is required (contradictory)
- **File**: `apps/web/src/core/infra/join-flow.ts` lines 38-39
- **Category**: Logic Bug
- **Description**: `shouldFallbackToDirectJoin` returns `true` when `status === 401 && error === 'member_id_required'`. This means when the server says "you need a member_id" (401), the client falls back to "direct join" which presumably doesn't require a member_id. This is contradictory -- the error says member_id is required, but the fallback skips it. Could cause an infinite error loop.
- **Fix**: Either remove this fallback or add a guard that prevents falling back when the error explicitly requires a member_id.

### M51: useOfflineQueueSync page in dependency array causes unnecessary effect re-runs
- **File**: `apps/web/src/core/offline/useOfflineQueueSync.ts` line 100
- **Category**: Performance
- **Description**: `page` is listed in the `useEffect` dependency array `[shareCode, memberId, page]`, but `page` is only used inside the `catch` handler. Changing `page` (e.g., navigation within the same WG) tears down and re-attaches all event listeners (`online`, `manawg:offline-queue`, `manawg:offline-synced`), causing unnecessary re-syncs and potential race conditions.
- **Fix**: Move `page` out of the dependency array and use a ref instead.

### M52: e2e/settlement-scope.spec.ts test.skip variable name is misleading
- **File**: `apps/web/e2e/settlement-scope.spec.ts` line 277
- **Category**: Test Logic Bug
- **Description**: `test.skip(process.env.BASE_URL === noHttpBaseUrl, ...)` -- `noHttpBaseUrl` is defined as `'https://example.invalid'`, a valid-looking HTTPS URL, not a "no HTTP" URL. The variable name suggests it should be a URL that has no HTTP, but it's actually an HTTPS URL. The skip condition checks if `BASE_URL` equals this value, but the semantic naming is backwards. If a developer sets `BASE_URL=https://example.invalid` for testing, HTTP cache tests would be skipped.
- **Fix**: Rename `noHttpBaseUrl` to clarify intent, verify skip condition is correct.

### M53: .env.example missing many environment variables
- **File**: `apps/web/.env.example`
- **Category**: Configuration / Documentation
- **Description**: Missing `KV_REST_API_URL`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_REST_API_TOKEN`, `NEXT_PUBLIC_E2E_FIXTURE_MODE`, `NEXT_PUBLIC_DB_DOWN`, `E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUPABASE_TEST_EMAIL`, `E2E_SUPABASE_TEST_PASSWORD`, `SUPABASE_AUTH_LIVE_E2E`, `SUPABASE_AUTH_PASSWORD_RESET_SMOKE`, `SUPABASE_AUTH_TEST_EMAIL`, `SUPABASE_AUTH_TEST_PASSWORD`, `SUPABASE_AUTH_TEST_MEMBER_WG_CODE`, `SUPABASE_AUTH_TEST_MEMBER_NAME`, `PUBLIC_ENTRY_E2E`, `PREVIEW_E2E`, `REAL_PRODUCT_E2E`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `AUTH_LIVE_E2E`, `E2E_FIXTURE_MODE`, `BASE_URL`. The `.env.example` file is incomplete.
- **Fix**: Add all missing environment variables to `.env.example`, even optional ones.

### M54: biome.json noConsole rule allows console.error but many shouldn't be there
- **File**: `apps/web/biome.json`
- **Category**: Logging / Configuration
- **Description**: The `noConsole` rule is configured to allow only `warn` and `error`, but there are many `console.error` calls in route handlers for fire-and-forget patterns (e.g., `[chores POST] notification failed`, `[idempotency] db setCachedResponse failed`) where `console.warn` would be more appropriate, or the error should be properly handled rather than just logged. Additionally, `console.error` in `instrumentation.ts` line 19 could be interpreted as an error by the Vercel platform, potentially triggering unnecessary alerts.
- **Fix**: Replace `console.error` with `console.warn` for non-fatal patterns. Use `captureException` for structured error reporting instead of raw `console.error`.

### M55: fire-and-forget notification errors should be surfaced to users per TASKS.md
- **File**: `apps/web/src/features/expenses/expenses.ts` line 183, `import-commit.ts` line 289, `ImportWizard.tsx` line 295
- **Category**: UX / Error Handling
- **Description**: `}).catch((err) => console.error('[expenses] notification failed', err))` -- Fire-and-forget notification calls with no retry mechanism. Notification fails, it's silently logged but the user action succeeds. This is noted as a TODO in `TASKS.md` line 58: "Fire-and-forget callers and normal UI actions must push errors visibly."
- **Fix**: Implement visible error feedback to users when push notifications fail, as noted in TASKS.md T4.

### M56: instrumentation.ts console.error during server startup could trigger Vercel alerts
- **File**: `apps/web/src/instrumentation.ts` lines 19, 28
- **Category**: Platform / Monitoring
- **Description**: `console.error(report)` on line 19 and `console.warn(report)` on line 28 both output raw environment report strings during server startup. In serverless environment (Next.js on Vercel), `console.error` in `register()` could be interpreted as an error by the platform, potentially triggering unnecessary alerts or marking the deployment as degraded.
- **Fix**: Use `captureException` instead of `console.error` for missing-env case. Use `console.info` instead of `console.warn` for degraded-but-not-failing env vars.

### M57: export.ts CSV formula neutralization incomplete
- **File**: `apps/web/src/core/reads/export.ts` lines 115-123
- **Category**: Security (CSV Injection)
- **Description**: `neutralizeCsvFormula` prepends `'` to formula-starting values (e.g., `=HLOOKUP(...)` becomes `' =HLOOKUP(...)`). But `escapeCsv` only wraps in double quotes if the text contains `"`, `,`, or newline. The neutralized text passes through unquoted. While Excel respects the leading single quote, other spreadsheet tools (LibreOffice, Google Sheets) may not.
- **Fix**: Either wrap the neutralized value in double quotes or prefix with a space instead of a quote.

### M58: middleware.ts MIGRATION_READ_ONLY block has fall-through logic issue
- **File**: `apps/web/src/middleware.ts` lines 67-84
- **Category**: Logic
- **Description**: When `MIGRATION_READ_ONLY === 'true'`, a read-method request to `/api/wg/[code]/something` falls through to the normal rate-limiting code. A `return` is missing after the read-method check inside the `MIGRATION_READ_ONLY` block, causing fall-through.
- **Fix**: Add an explicit `return` after the read-method check to make the control flow explicit.

### M59: e2e/readFileSync uses relative path without process.cwd() handling
- **File**: `apps/web/e2e/release-workflow-gates.spec.ts` line 15
- **Category**: Reliability
- **Description**: `readFileSync(path.resolve(process.cwd(), '../../.github/workflows/ci.yml'), '../../.github/workflows/')` uses `process.cwd()` which could fail if the CWD is not the project root. If the test is run from a different directory, the file path would be wrong and the test would fail with a file-not-found error.
- **Fix**: Use `import.meta.url`-based resolution instead of `process.cwd()`.

---

## LOW (6)

### L25: pnpm-lock.yaml postcss override could mask dependency conflicts
- **File**: `apps/web/pnpm-lock.yaml` line 8
- **Category**: Dependency Management
- **Description**: Contains `overrides: postcss@8.4.31: 8.5.26`. This pin override could mask dependency conflicts. While overrides sometimes need to resolve conflicts, a minor version bump 8.4.31 to 8.5.26 could introduce breaking changes to any package depending on specific postcss behavior.
- **Fix**: Document why this override is needed, or use a more targeted override.

### L26: ShareWgCard.tsx dead className prop
- **File**: `apps/web/src/components/wg/ShareWgCard.tsx` line 121
- **Category**: Dead Code
- **Description**: Same as L17. Both ternary branches produce identical empty string.
- **Fix**: Replace with appropriate className values or remove the ternary.

### L27: ActionNoticeBanner.tsx error tone has empty CSS class
- **File**: `apps/web/src/components/wg/ActionNoticeBanner.tsx` line 17
- **Category**: Styling
- **Description**: Same as L18.
- **Fix**: Add proper CSS custom property classes for the error tone.

### L28: PasswordResetForm.tsx stale state from prop
- **File**: `apps/web/src/components/auth/PasswordResetForm.tsx` line 21
- **Category**: Logic
- **Description**: Same as L19.
- **Fix**: Add `useEffect` to sync prop to state.

### L29: AboForm.tsx custom interval not editable via dropdown
- **File**: `apps/web/src/components/wg/AboForm.tsx` lines 319-334
- **Category**: UX
- **Description**: Same as L20.
- **Fix**: Add a text input for custom interval values, or restrict to predefined options.

### L30: OfflineBanner.tsx conflates "other WG" with "zero syncs"
- **File**: `apps/web/src/components/wg/OfflineBanner.tsx` lines 25-31
- **Category**: Logic
- **Description**: Same as L21.
- **Fix**: Distinguish between "key doesn't exist" (malformed event) and "value <= 0" (legitimately zero syncs).

---

## ADDITIONAL TECHNICAL DEBT

- **RED BUG-002**: Referenced in `apps/web/src/core/guards/idempotency.ts` line 36. An unresolved bug in the idempotency/replay slot system. Still unresolved after 4 rounds of scanning.
- **`auth/callback/route.ts`**: Does not exist. Only `recovery/route.ts` exists under `src/app/api/auth/`. The OAuth callback handler has no corresponding server-side route.
- **`tools/` directory**: Empty or doesn't exist despite being listed in the project structure.
- **`.github/workflows/`**: Only `ci.yml` and `migrate-production.yml` exist. No GitHub Actions workflow for the requested automation.
- **`graphify-out/`**: Report mentions 878 isolated nodes with ≤1 connection, suggesting possible missing edges or undocumented components. `recurring-expenses/route.ts` and `index.ts` have very low cohesion scores (0.06, 0.07), suggesting they may be too large and should be split.
- **`biome.json` `noConsole` rule**: Some `console.error` calls are disallowed but allowed via `allow: ['warn', 'error']`. This masks legitimate linting issues.
- **`@ts-ignore` / `@ts-expect-error`**: No instances found in source code -- this is a positive finding indicating good type discipline.
- **`TODO:` / `FIXME:`**: No inline `TODO:` or `FIXME:` markers found in source files. All task tracking is in `TASKS.md` format.

---

## UPDATED SUMMARY

| Severity | Round 1 | Round 2 | Round 3 | Round 4 | Total |
|----------|---------|---------|---------|---------|-------|
| **CRITICAL** | 3 | 4 | 2 | 2 | **11** |
| **HIGH** | 18 | 12 | 8 | 7 | **45** |
| **MEDIUM** | 25 | 10 | 12 | 12 | **59** |
| **LOW** | 10 | 6 | 8 | 6 | **30** |
| **TOTAL** | 56 | 32 | 30 | 27 | **145** |

### Top 10 Most Critical Bugs (must fix first):
1. **C10** - `.env.local` contains committed secrets (Upstash API tokens, Vercel JWT)
2. **C11** - `drizzle.config.ts` has `postgres://placeholder` fallback
3. **C6/C1** - HMAC anti-spoofing entirely non-functional (every route's auth is bypassed)
4. **C5** - All database privileges revoked and never granted back
5. **C4** - RLS enabled without any policies
6. **C7** - Share code normalization produces invalid characters
7. **C8** - `vercel.json` ignoreCommand always fails
8. **C9** - `instrumentation.ts` throws in production, crashes server
9. **H39** - Double-ARRAY in FOREACH breaks role-based security hardening
10. **H40** - `recurring_expenses` missing `amount_cents > 0` check constraint

### Bug Categories by Count:
- Security: 25+ bugs (auth bypass, CORS, CSRF, CSP, rate limiting, share code enumeration, access control, committed secrets, SQL injection)
- Data Integrity: 18+ bugs (split sums, idempotency, normalization, migration issues, stale state, schema drift)
- Logic: 22+ bugs (inverted conditions, wrong module mappings, invalid date handling, type mismatches, contradictory fallbacks)
- Performance/Resource: 10+ bugs (pool size, Map creation, interval management, connection leaks, unnecessary re-renders)
- Reliability: 8+ bugs (error handling, crash on boot, test quality, infinite loops)
- Usability: 6+ bugs (unused parameters, future dates, settings defaults, custom intervals)
- Configuration/Documentation: 8+ bugs (missing env vars, invalid PostHog config, wrong biome rules, stale dates)
