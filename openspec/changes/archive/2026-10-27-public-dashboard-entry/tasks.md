## 1. Approved entry implementation

- [x] 1.1 Add a real-browser public-entry regression and record its expected failure against the existing hosted app before changing runtime code.
- [x] 1.2 Implement public dashboard/module routes and contextual create/join/welcome states; verify Node 22 typecheck, scoped lint, and build.
- [x] 1.3 Preserve explicit create/join intent and protect private HTML/cache boundaries; verify focused regression coverage and Terra review.

## 2. Integration verification

- [x] 2.1 Moved to docs/release-checklist.md (Offene Hosted-Nachweise); hosted proof is an owner action.
- [x] 2.2 Resolve Terra review findings, update Graphify, and report exact source/hosted verification results without claiming broader auth migration or production release.

Source implementation and independent review are complete in `/private/tmp/manawg-login-fix-2wRZO2`; hosted GREEN (2.1) is not complete. No merge, commit, push, deployment or production mutation was performed. Final evidence is in that worktree's `.superpowers/sdd/2026-09-03-public-dashboard-entry/` reports. Preview authorization remains pending.
