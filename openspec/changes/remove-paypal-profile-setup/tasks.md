## 1. Remove profile setup
- [x] 1.1 Remove PayPal profile UI, state and requests while preserving other controls.
- [x] 1.2 Verify the profile in the browser and run focused regression, type, lint and build checks.
- [x] 1.3 Independently review the change and update the graph.

## 2. Complete the requested payment journey
- [x] 2.1 Confirm product journey and official provider contract; owner delegates account/payment choices to PayPal.
- [x] 2.2 Implement and test provider referral, signed attempt binding, readiness and safe URLs.
- [x] 2.3 Implement and test connection persistence, remove manual ID setter and gate new orders.
- [x] 2.4 Implement and browser-test account connection/return and confirmed payment without typed PayPal data.
- [x] 2.5 Complete final type/lint/build/payment checks, independent review, graph and deployment documentation.

## Verification evidence — 2026-09-27

- `pnpm --filter @manawg/web typecheck`: passed on Node 22.23.2.
- `pnpm exec biome check apps/web/src/components/wg/einstellungen/ProfileTab.tsx apps/web/e2e/paypal-profile-free.spec.ts`: passed.
- Focused fixture Playwright test: 1 passed (32.4 s), 320px viewport, light/dark interaction and no PayPal member GET. The first invocation lacked fixture environment flags and was corrected before this successful run.
- `pnpm --filter @manawg/web build` with explicit fixture flags and `.next-paypal-profile-build`: passed. Generated edits in `next-env.d.ts` and `tsconfig.json` were inspected and restored.
- Independent Astra review: no actionable findings in profile removal and test.
- `graphify update .`: passed, 4,803 nodes / 13,096 edges. SQL AST extraction unavailable because optional `tree_sitter_sql` is missing; no SQL changed.
- `openspec validate remove-paypal-profile-setup --strict` and `git diff --check`: passed.

## Final implementation verification — 2026-09-27

- Node 22.23.2 full unit suite: 138 passed, zero failed/skipped.
- Full typecheck and lint: passed; Biome checked 538 files and feature boundaries passed.
- Final optimized Next build in explicit fixture mode: passed, including connect and generic return routes.
- Browser fixture suite: 7 cases passed; additional untrusted action-host case passed separately (8 distinct cases total). Includes account connection, cancellation, transient retries, readiness/unavailable display, debtor/recipient guidance, and simulated SDK cancelled/failed/completed capture. It performs no real payment.
- Light/dark 320px screenshots inspected: no manual PayPal field, readable consent explanation and connect button, no clipping.
- Independent UI review finding fixed and re-reviewed without further findings. Backend legacy-ID and provider-404 findings fixed; stable customer tracking and per-attempt nonce accepted. Final environment hash isolation assertion passes.
- graphify AST update passed: 4,874 nodes / 13,279 edges / 304 communities. Optional SQL grammar remains unavailable; no SQL changed.
- Generated next-env.d.ts change inspected and restored; tsconfig.json unchanged.
- Production and Preview environment NAME listings confirmed no PayPal configuration. Real PayPal login/payment and deployment remain unverified; see docs/paypal-setup.md for exact provider prerequisites.

This implementation is local and isolated. No real payment, provider permission grant, production data change or deployment was performed.
