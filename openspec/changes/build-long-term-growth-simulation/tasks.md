## 1. Tooling and input contract

- [x] 1.1 Add the dependency-free `tools/growth-lab/` Node CLI skeleton, root `growth:simulate` script, and ignored generated-output paths; verify `pnpm growth:simulate -- --help` exits zero.
- [x] 1.2 Add the versioned snapshot schema and conservative ManaWG fixture covering market, channel, funnel, cost, retention, referral, revenue, objective thresholds, and declarative strategies; verify the fixture contains provenance for every required parameter.
- [x] 1.3 Implement fail-closed snapshot/strategy validation for bounded units, provenance, freshness metadata, safe aggregate calibration fields, and the allowed action vocabulary; verify malformed, stale, unbounded, and executable-content inputs exit non-zero with field-level errors.

## 2. Deterministic simulation and evaluation

- [x] 2.1 Implement the seeded triangular sampler and funnel simulation for 30, 90, 365, and 1,095 days across pessimistic, base, and optimistic assumptions; verify two identical seeded runs produce equivalent machine-readable outcomes.
- [x] 2.2 Implement activated-WG and day-30-retention calculations, operating hours, cash cost, optional revenue, and P10/P50/P90 aggregation; verify registrations without three members and two seven-day actions are excluded.
- [x] 2.3 Implement hard safety/budget/confidence gates followed by transparent weighted ranking and sensitivity analysis; verify an unsafe low-cost strategy cannot rank as eligible and no-winner output identifies the smallest evidence gap.

## 3. Evidence, persistence, and reporting

- [x] 3.1 Implement privacy-safe aggregate calibration that preserves assumed versus observed labels, records measurement window/sample size, and widens sparse evidence; verify identifier, message, token, credential, command, callback, and module fields are rejected before persistence.
- [x] 3.2 Implement bounded one-shot execution with iteration/runtime limits, a concurrent-run lock, atomic artifact promotion, last-known-good preservation, and an append-only run index; verify interrupted, invalid, timed-out, and concurrent runs leave the previous successful result intact.
- [x] 3.3 Implement JSON and concise Markdown reports containing timestamps, source links, freshness, model/input identity, seed, horizons, ranges, ranking, limitations, and at most three approval-gated experiments; verify a successful fixture run writes and links both outputs.

## 4. Verification and handoff

- [x] 4.1 Add the smallest runnable self-check for validation, deterministic replay, activation math, hard gates, and atomic result behavior; verify it passes with Node 22 without adding a test framework.
- [x] 4.2 Run the simulator against the fixture, inspect the generated report, and run the repository's applicable lint/type/build checks without touching existing application changes; verify the final OpenSpec status and task checklist are complete.
