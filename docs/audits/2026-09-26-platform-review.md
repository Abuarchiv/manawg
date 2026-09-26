# ManaWG platform review — 2026-09-26

Source checked: `origin/main` at `36c5b55e099aef36658c4a43342ae5ab36a152a9`. The older local `main` checkout has unrelated uncommitted work and was not edited.

## Verified

- Vercel Production for `app.manawg.com` is Ready on the same source SHA. `/api/health` returned HTTP 200 with database `ok`, no missing required configuration, and no degraded features. Public pages send CSP with a nonce, HSTS, frame denial, `nosniff`, and a restricted Permissions Policy.
- The isolated local build used Node 22 and pnpm 9. Lint, typecheck, 159 unit tests, Next.js build, bundle budget, analytics privacy check, and production dependency audit passed. Fixture E2E: 492 passed, 41 skipped, 0 failed. These are local checks; hosted authentication and database writes were not exercised.
- A real PayPal accounting race was reproduced on the original source: an expense could be deleted during external capture, then the payment was recorded as completed. The local fix guards debt-changing writes and deletion while the payment is `capturing`, keeps payer membership available for recovery, and rechecks membership under the capture lock. A regression test failed with `DELETE 200` before the fix and passed with `409` afterward. A second test observed `200 COMPLETED` after membership loss before the fix and `403` without a PayPal call afterward.
- The standalone security-boundary script had an outdated text assertion about read-only Origin handling. That assertion was removed; the runnable `csrf-origin.spec.ts` covers the intended write protection. The script now passes.

## Open gates and limits

- [Main CI run 36256779790](https://github.com/Abuarchiv/manawg-app/actions/runs/36256779790) never started its failed jobs. GitHub's check annotation says: “The job was not started because recent account payments have failed or your spending limit needs to be increased.” Fixture and Preview jobs were skipped. This is an account billing gate, not a demonstrated code failure.
- `main` has no required branch protection. Dependabot alerts, code scanning, and secret scanning are disabled. Enabling paid or access-changing settings needs a separate account decision.
- Production still runs `36c5b55`; the local PayPal fix is not deployed. No real PostgreSQL concurrency or live PayPal charge was executed. A real Supabase signup/reset and authenticated multi-WG flow remain unverified.
- Warm TTFB samples from this environment were 281–388 ms on public routes. Speed Insights had only older, sparse LCP samples (2.86 s for the start page, 3.67 s for a WG route) and none in the last 24 hours. They do not establish current optimal performance or a specific bottleneck.
