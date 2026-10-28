## Why

PayPal settlement never went live: the partner approval is missing, every `PAYPAL_*` value is empty in production, and cash settlement covers the need. The dormant integration still costs a provider client, three API routes, a reconcile job, CSP and popup exceptions, a schema column per member and a "payment in flight" lock in every money write. Removing it makes cash the only settlement path.

## What Changes

- Delete the PayPal client, onboarding, order, capture and return routes, the reconcile job, the settings section, the pay button and their tests.
- Drop the "payment in flight" (`capturing`) check from expense, split, import, recurring, member, WG and account writes, and the `paypal_payment_pending` error with its UI messages.
- Remove the PayPal hosts from the CSP; COOP is always `same-origin`.
- Migration `0036_remove_paypal`: refuse to run while a completed PayPal payment exists, delete open/failed PayPal orders, drop `wg_members.paypal_merchant_id` and the `expense_payments` columns `provider`, `provider_order_id`, `payee_merchant_id`, `expires_at`; payment status is `completed` or `voided`.
- Remove the PayPal environment variables, setup guide and documentation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `expense-settlement`: settlement is by hand only; PayPal requirements are removed.
- `safe-account-deletion`: there is no PayPal recipient identifier left to remove.
- `paypal-profile-free`: retired; its spec is deleted.

## Impact

- `apps/web`: API routes, settings and debt UI, expense/member/WG/account writers, maintenance cron, CSP middleware, schema and migration 0036.
- Production needs migration 0036 applied together with the deploy, because the new code no longer writes the dropped columns.
