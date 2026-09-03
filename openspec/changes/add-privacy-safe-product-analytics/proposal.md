## Why

ManaWG needs activation and retention evidence, while its public copy currently promises no tracking despite loading Vercel Analytics. Product analytics must be explicit, minimal, and privacy-safe.

## What Changes

- Replace duplicate web analytics with one PostHog EU integration.
- Capture anonymous page views plus successful WG creation and joining only.
- Disable autocapture, person profiles, cookies, and session replay.
- Document the processing and keep the app functional when analytics is unconfigured or blocked.

## Capabilities

### New Capabilities
- `privacy-safe-product-analytics`: Anonymous product metrics with an honest public disclosure.

### Modified Capabilities

None.

## Impact

The web app gains one client dependency, one initialization file, two explicit activation events, updated public copy, and a privacy page. No database, identity, payment, Paperclip, deployment, or production-data change is included.
