## 1. Private storage and authorization

- [x] 1.1 Implement the server-only private storage helper and explicit provider selection; verify bucket validation, key grammar, and unchanged AWS contracts with focused tests.
- [x] 1.2 Add authenticated no-store image reads and the private sign response; verify unauthenticated, foreign-WG, and revoked-member denials without returning image bytes or signed-read tokens.
- [x] 1.3 Accept only trusted protected URLs belonging to the destination WG in all image writes; verify traversal, wrong-origin, and cross-WG rejection tests.

## 2. Client and configuration compatibility

- [x] 2.1 Preserve online/offline PUT behavior including provider upload headers; verify both upload clients and existing image consumers with Playwright.
- [x] 2.2 Update environment diagnostics, documented variables and only required CSP sources; verify lint, typecheck, analytics and AWS/default-provider regression checks.

## 3. Preview and release proof

- [x] 3.1 Provision and read back the private Preview bucket and server-only environment configuration; verify no public grants, exact MIME set and 8 MiB cap.
- [x] 3.2 Deploy the reviewed candidate and prove real upload/render, overwrite rejection, 8 MiB and oversized/MIME boundaries, cross-WG/revocation denials, offline retry and object cleanup.
- [x] 3.3 Complete independent review and applicable build/bundle/fixture gates; update release evidence and Graphify with actual results.
