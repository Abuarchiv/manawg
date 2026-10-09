## Context

`expense_payments` records PayPal orders and is the only ledger the balance engine reads besides splits. `computeNetBalances` and `computeBalances` subtract every completed payment from the debt between its two members, whatever created it. Direct settlement (`settle` route, `settle-batch`) flips `expense_splits.settled_at`; it can only express whole splits and is blocked when a split exceeds the net.

## Goals / Non-Goals

**Goals:** let two members clear an exact netted amount in cash; keep one source of truth for balances; make stale or repeated submissions safe.

**Non-Goals:** no bank integration, no partial settling of single splits, no change to PayPal flows, no new identity or notification model.

## Decisions

1. Reuse `expense_payments` with `provider = 'manual'`, `status = 'completed'`, `completed_at = now()`, `payee_merchant_id = 'manual'`, and a synthetic unique `provider_order_id` (`manual:<uuid>`). The provider check constraint changes to `in ('paypal', 'manual')`. This keeps every reader of completed payments correct without a second ledger.
2. One route, `POST /api/wg/[code]/payments/manual`, with `{ fromMemberId, toMemberId, currency, expectedNetCents }`, where `expectedNetCents` is the net debt the person reviewed. The server recomputes the net debt inside `withExpensePaymentLock`, rejects when `expectedNetCents` differs from the current net (`409 settlement_changed`), when a PayPal payment is capturing (`409 paypal_payment_pending`), or when the caller is neither party (`403 not_party_to_debt`). Both members must be active in the WG.
3. The amount is always the full net debt of that pair at the time of the review, so a cash payment cannot leave a hidden remainder. Partial cash payments are out of scope.
4. An idempotency key makes a double tap safe; the stored response is replayed.
5. The dialog offers cash whenever the netted debt exists, and explains that nothing is transferred by ManaWG. After success it reloads expenses and payments.
6. The export keeps its columns; a cash payment appears there like any completed payment. The audit event `expense.debt.settled.manual` tells it apart.

## Risks / Trade-offs

- A debtor can mark their own debt paid in cash. This matches the existing honor model for split settling and is audited (`expense.debt.settled.manual`).
- A mistaken entry cannot be undone by the UI. Removal is by an admin only through the database, as with other ledger rows; an "undo" can follow if needed.
- The migration touches a table the PayPal flow uses; it only widens a check constraint.
