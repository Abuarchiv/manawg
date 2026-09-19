## Decisions

Use the existing Start route and fetch lifecycle. Compose original Card, Item, Badge, Button, Empty and Skeleton components; retain Animate UI Collapsible for additional pending items with a zero-duration reduced-motion override. No new packages or design tokens.

Order: compact Start greeting; Heute wichtig (or new-WG entry); compact Dein Saldo; Neu in deiner WG with one announcement preview and up to three activity items. Bottom navigation remains authoritative. No duplicate module cards or WG score.

Add assignedMemberId to generated dashboard chore metadata (the selector tolerates older candidates without it) and optional ID to the latest announcement for compatibility with existing fixtures. Return the already-read chore candidates without pre-truncating away personal responsibilities. Rank all relevant candidates centrally, show ownership and destination-specific action labels, and keep balances exclusively in the compact balance section.

Retain polling, stale data, retry, invitations and all existing deep links. Filter announcement previews already represented in pending work; historical activity is limited and visually secondary.

## Validation

Run lint, typecheck, production fixture build, page-free Playwright model checks and request-only API checks for ranking and response contracts, and connected Chrome checks of the rendered Start and destination links. Update existing browser regression assertions for the changed composition. Respect the user's Chrome Extension-only browser-control preference; do not launch a separate automated browser. Verify 320px/390px, light/dark and reduced-motion when supported by the connected browser.

## Integration decisions

- A due recurring item retains the existing expense-review deep link; its action is labelled `Buchung prüfen` because that destination opens a prefilled review form. It never saves or pays from Start.
- A new-WG setup banner only replaces the overview when no pending candidates exist.
- The shared LoadErrorBanner uses the original Alert grid so a long Start error does not squeeze its message beside the retry button. Its callbacks, labels and busy behavior remain unchanged.

## User correction: header and optional hints

Approved 2026-09-05 after screenshot review: one shared Start header with WG name, greeting, matching ghost chat/account controls; no repeated Start title. Optional welcome uses original shadcn Card with dismiss action and localStorage scoped by stable WG/member ID. Hidden by default until its stored preference is read, preventing reload flashes. If storage is blocked, dismissal lasts for the mounted view only. Shopping and invitations remain in their normal destinations. Push prompt becomes an inline original Card/Button composition; permission, resubscribe and existing permanent dismissal contracts remain unchanged.
