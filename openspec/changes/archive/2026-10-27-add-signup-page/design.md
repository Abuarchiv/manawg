## Context

`/neu` renders the sign-in form for signed-out visitors and the create/join flow for signed-in ones. Registration reused the sign-in form through a secondary button, so registration had no URL, no copy of its own, and no confirmation step beyond a single alert.

## Goals / Non-Goals

**Goals:**

- A linkable `/registrieren` page that behaves like a normal registration screen.
- The same account methods as sign-in (Google, e-mail/password, phone/SMS when enabled) with registration wording.
- No loss of the create/join intent when a visitor moves between the two pages or confirms by e-mail.
- Honest, account-neutral feedback; a way out when the confirmation mail is missing.

**Non-Goals:**

- No new identity store, no database change, no dependency, no provider configuration change.
- No separate "forgot password" page; the existing reset request on `/neu` stays.
- No profile/name collection at registration; the display name is still chosen when creating or joining a WG.

## Decisions

1. New route `/registrieren` (German product wording, matching `/neu`). The server component redirects signed-in visitors to `/neu` with the same intent, so a session never meets a registration form. The check reuses `getAuthenticatedUserFromCookies` and fails open to the form on transient errors.
2. The post-authentication target is always `/neu` plus a validated intent query. A new `src/core/auth/auth-intent.ts` rebuilds that query from `code`, `action` and `next` only, drops `/neu` and `/registrieren` as `next` targets, and never forwards unknown parameters. It is shared by both pages so the links between them cannot drift.
3. Registration and sign-in stay separate forms. The e-mail sign-up form asks for the password twice (minimum 8 characters, same limit as reset), marks the field invalid with `aria-invalid`, and never puts credentials in the URL or drafts.
4. Supabase returns an obfuscated success for an already registered address. The "check your inbox" state therefore speaks conditionally and offers both resend and a link to sign-in/reset. Resend uses `auth.resend({ type: 'signup' })` with a client-side 60 s cooldown; server rate limits stay authoritative and surface the existing rate-limit copy.
5. The sign-in form shows a resend action only for the `email_not_confirmed` failure, using the already typed address.

## Risks / Trade-offs

- A visitor who bookmarked the old combined flow still gets a working sign-in page; only the secondary button moved.
- Phone/SMS creates accounts implicitly, so the registration page offers it only when the provider is enabled, like sign-in.
- Supabase may send the confirmation mail from a template that still points at the callback with `next`; that callback is unchanged and already allowlisted.
