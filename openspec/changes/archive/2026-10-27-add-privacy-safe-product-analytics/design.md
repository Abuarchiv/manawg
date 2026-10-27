## Context

The root layout already loads Vercel Analytics and Speed Insights while metadata says "ohne Tracking". Paperclip has no PostHog plugin. The smallest coherent change is to keep Speed Insights for performance, replace Vercel Analytics with PostHog, and send only activation evidence.

## Decisions

1. Initialize `posthog-js` through Next.js `instrumentation-client.ts`, only when the public project key exists.
2. Use the EU host, cookieless mode, memory-only persistence, anonymous-only profiles, disabled autocapture, and disabled session replay.
3. Capture `wg_created` and `wg_joined` after their existing API requests succeed. Do not attach names, email, WG code, WG id, member id, message text, financial data, or URLs supplied by users.
4. Remove Vercel Analytics to avoid duplicate pageview collection. Keep Speed Insights because it measures application performance rather than the product funnel.
5. Add an accurate German privacy page and replace absolute "ohne Tracking" claims.

## Verification

Validate OpenSpec, typecheck, lint, build, and use a focused static check to prove forbidden sensitive properties are absent from analytics calls. Live ingestion requires the EU project key and is not claimed until the account is created and an event appears in PostHog.
