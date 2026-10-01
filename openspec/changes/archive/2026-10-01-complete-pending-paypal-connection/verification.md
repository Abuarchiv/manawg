## Local verification (2026-09-30)
- Node 22 / pnpm 9: focused onboarding helper, actual connect handler and order regressions: 23 passed, zero skipped.
- Scoped Biome: 7 changed source/test files passed. Both application and unit TypeScript projects passed.
- Fresh isolated fixture build and Chromium/WebKit: 24 passed, zero skipped, retries disabled. Settings verified at 320px light/dark; existing load-error cases also cover 360px and keyboard retry.
- OpenSpec strict validation passed; graphify AST update completed. The existing optional SQL parser remains unavailable; no schema changes were made.
- Independent Sol/high review passed: 19 helper/connect tests and eight actual middleware origin/write-route assertions; no security, callback-nonce, tracking, CAS/payment lock or UI-scope findings.

## Fixture boundary
The exact 1990db83 baseline reproduced three of six WebKit failures with a service worker active. Blocking the worker only in the temporary baseline API-fixture context changed the same six cases to all passing. Therefore the two changed API-double specs explicitly block service workers so page.route cannot be bypassed. Runtime PWA/service-worker behavior and dedicated PWA tests remain unchanged.

These are local provider doubles, not real PayPal, hosted or production proof. Root real Sandbox verification remains a separate run with the actual service worker. Private command logs and screenshots are retained under ~/.local/share/manawg-recovery/paypal-completion-20260930 with directory mode 700 and file mode 600; no provider credentials or merchant identifiers are stored in repository artifacts.
