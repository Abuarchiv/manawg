## Why

An audit of the whole app (October 2026) left a list of known gaps that were neither bugs in one place nor covered by an existing change: sessions that expire silently, a service worker that can hang on a bad connection, chat without pictures, uploads nobody removes, chores that nobody is reminded of after a move-out, imports that collapse identical purchases and cannot be undone, repeating events that only change as a whole, and a few unguarded edges (signing-secret rotation, Preview rate limiting, secondary text contrast).

## What Changes

- Sessions: one banner for an expired session on every screen; a sign-in redirect from a WG page keeps the requested page; Supabase cookies are `Secure` on HTTPS and `SameSite=Lax`.
- Service worker: a navigation that the network does not answer in 8 s falls back to the offline page; a refreshed offline page brings its chunks; the offline shell is fetched again after sign-out; the unused Apple site association route is removed; the PayPal return without a trusted origin renders a page instead of JSON.
- Chat: a picture can be attached and sent alone (`purpose: chat` for uploads).
- Maintenance: pictures that no row references after 14 days are removed from the private bucket.
- Chores: a due chore without assignee is announced to the whole WG.
- Import: identical rows inside one file are all imported; an import can be undone until any of its shares is settled.
- Start page: the invitation card stays while the WG has only one active member.
- Fixed costs: the extra cents of an even split rotate between members.
- Events: one date of a series can be removed or changed on its own (`EXDATE`, `POST /events/[id]/occurrence`); a device outside Berlin sees a notice about time zones.
- Operations: `MEMBER_SESSION_SECRET_PREVIOUS` for rotation, Preview does not pass traffic when a configured limiter fails, light-mode secondary text reaches 4.5:1 on muted surfaces, two indexes for the cron scans.

## Capabilities

### New Capabilities

- `household-gaps`: the behaviours above.

## Impact

`src/core/auth`, `src/core/infra/api-client.ts`, `public/sw.js`, chat composer, `core/db/orphan-uploads.ts`, maintenance and chore-reminder crons, import commit and undo, events (`recurrence-rule.ts`, occurrence route and drawer), `core/infra/signing-secrets.ts`, `core/rate-limit.ts`, `globals.css`. One migration (`0021_cron_scan_indexes`: two indexes, no data change).
