## 1. Code

- [x] 1.1 Delete the PayPal modules, routes, components, tests and the setup guide.
- [x] 1.2 Remove the `capturing` check and `paypal_payment_pending` from every writer, route and UI message.
- [x] 1.3 Remove PayPal from the CSP, COOP, settings, debt rows and the maintenance cron.

## 2. Data

- [x] 2.1 Drop the PayPal columns from the Drizzle schema and generate migration 0036 with a guard against completed PayPal payments.
- [x] 2.2 Verify the migration on a disposable database.

## 3. Verification

- [x] 3.1 Typecheck, lint, architecture checks, knip, unit tests and a production build pass.
- [x] 3.2 No PayPal reference remains outside applied migrations and archived records.
