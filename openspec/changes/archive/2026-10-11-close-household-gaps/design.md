## Decisions

- **Exceptions live in the rule.** Removed dates are `EXDATE=` parts of the existing `recurrence` text, so the expansion used by the browser, the feed and the reminders honours them without a new table or migration. Removed dates still count toward `COUNT`, as in RFC 5545. Changing one date removes it and inserts a single event in the same transaction.
- **Import undo deletes the import record.** The expenses and the `expense_imports` row go in one transaction under the payment lock; refused when any share other than the payer's own is settled or a PayPal capture is running. The audit event keeps the source and the count.
- **Duplicates by occurrence number.** The first row with a key keeps the legacy key, later ones get `|#n`, so the unique index still stops a concurrent duplicate import.
- **Orphan sweep is bucket-driven.** A run lists a few WGs' folders (rotating by hour), keeps everything referenced by any row (deleted chat included) or already queued, and removes the rest older than 14 days.
- **Time zones stay device-local for display.** Making every view Berlin-pinned would change the month grid, agenda and all-day rules together; the notice names the difference instead.
- **Contrast fix touches the token.** `--muted-foreground` moves from `0.556` to `0.52` in light mode (documented in the design language).
