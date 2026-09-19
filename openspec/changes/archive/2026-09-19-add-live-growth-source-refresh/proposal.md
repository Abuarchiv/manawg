# Add live growth source refresh

## Why

The ManaWG Growth Lab currently simulates a versioned snapshot correctly, but
the recurring loop can only compare against that snapshot. Its source links are
not proof that the linked public information was reachable today.

## Goal

Add one explicit, dependency-free refresh command that fetches only an
allowlisted set of public HTTPS sources, extracts the one supported scalar
market observation, records source health and hashes, and writes a new dated
input snapshot for the one-shot simulator.

## Non-goals

- No scraping beyond the small allowlisted extraction needed for the fixture.
- No account access, authentication, posting, messaging, ads, deployment, or
  production writes.
- No mutation of the versioned baseline snapshot.
- No claim that a reachable source makes assumed funnel or marketing metrics
  observed.

## Acceptance

- A successful refresh produces a dated live input and source-status artifact.
- A failed fetch or extraction exits non-zero and produces no live input.
- The simulator can consume the live input and report its source-refresh state.
- The recurring OpenClaw loop refreshes before simulating.
