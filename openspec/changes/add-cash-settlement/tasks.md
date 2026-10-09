## 1. Ledger

- [x] 1.1 Migration widening `expense_payments_provider_check` to `('paypal', 'manual')`; update `schema.ts`.
- [x] 1.2 `features/expenses/manual-payment.ts`: validate and build the ledger row; unit tests.

## 2. API

- [x] 2.1 `POST /api/wg/[code]/payments/manual` with lock, net recomputation, idempotency, audit event; route tests.

## 3. UI

- [x] 3.1 Settlement review dialog: "Bar bezahlt eintragen" for netted debts, with amount confirmation and error texts.
- [x] 3.2 Keep the export columns; the audit event marks the cash payment.

## 4. Verification

- [ ] 4.1 Unit and e2e tests for netted and mutual debts; lint, typecheck, build.
- [ ] 4.2 Preview migration and a hosted check before promotion.
