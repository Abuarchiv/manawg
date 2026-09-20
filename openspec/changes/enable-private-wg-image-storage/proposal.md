## Why

The Preview cannot upload receipt or announcement images because the AWS backend is not configured. Supabase is already connected, but publishing household images in a public bucket would violate the application's membership boundary.

## What Changes

- Add an explicitly selected Supabase private-storage backend using the existing SDK; retain the existing AWS backend.
- Preserve the upload response and PUT contract while returning a protected application URL for stored private images.
- Authorize every private image read against current WG membership and stream the image with private, no-store caching instead of exposing a reusable public URL.
- Enforce the existing 8 MiB and exact image MIME limits in the private bucket as well as the application; prevent cross-WG image references and key traversal.
- Verify upload, render, denial, revocation, limits, and cleanup against the real Preview before closing the release gate.

## Capabilities

### New Capabilities

- `private-wg-image-storage`: immutable WG-scoped uploads and authenticated private image reads, including provider selection and existing-client compatibility.

### Modified Capabilities

None. Existing account authentication, membership, and public-table RLS requirements remain unchanged.

## Impact

Upload sign/read routes, storage helper, image URL validation and its write callers, online/offline upload clients, CSP, environment diagnostics, and focused tests. Uses the existing Supabase SDK and Preview project; no database migration, public bucket, new dependency, or Production deployment.
