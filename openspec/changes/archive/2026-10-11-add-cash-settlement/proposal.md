## Why

The "Saldo" card shows netted debts, but "Ausgleichen" can only mark original splits as settled. When the net debt exists only as a netting of several expenses (A owes B 20, B owes C 20 shows "A owes C 20"; or A owes B 50 and B owes A 30 shows "A owes B 20"), no direct split fits, the server answers `no_direct_splits`, and per-split "Bezahlt" fails with `split_already_offset`. The debt can then only be cleared with a PayPal payment, and only when the payee connected PayPal. Roommates who settle in cash have no way to clear the balance.

## What Changes

- Add a manual (cash) payment record to the existing `expense_payments` ledger: a completed payment from one member to another for an exact amount, with provider `manual`.
- Offer "Bar bezahlt eintragen" in the settlement dialog whenever the net debt cannot be cleared through direct splits, and as a second option next to direct settlement.
- The balance engine already subtracts completed payments, so balances, the Saldo card and reminders reflect the cash payment without further changes.
- Either party of the debt may record it; the dialog shows the reviewed amount and the server rejects a stale amount.
- The audit feed records the payment as a cash payment.

## Capabilities

### New Capabilities

- `expense-settlement`: Clearing a netted debt without PayPal.

## Impact

`expense_payments` (provider check, migration), a new route `POST /api/wg/[code]/payments/manual`, the settlement review dialog. No new dependency. The migration must go through the Preview-then-Production workflow; it is authored here and not applied.
