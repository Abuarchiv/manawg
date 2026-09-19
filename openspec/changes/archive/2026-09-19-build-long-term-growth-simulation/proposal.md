## Why

ManaWG needs a repeatable way to compare low-cost growth strategies over months and years without presenting speculative registrations or revenue as facts. A bounded simulation can combine fresh, source-backed market inputs with actual product metrics as they become available, expose uncertainty, and turn the strongest hypotheses into small real-world experiments.

## What Changes

- Add a repository-local growth simulation that models acquisition, household activation, retention, referral, operating effort, cost, and optional revenue across 30-day, 90-day, one-year, and three-year horizons.
- Define an activated WG as at least three joined members plus two meaningful shared actions within seven days, with continued household activity tracked at 30 days.
- Use dated, provenance-bearing input snapshots so a run can use current public data while remaining reproducible later.
- Compare pessimistic, base, and optimistic assumptions with seeded probabilistic runs and report ranges rather than false precision.
- Rank strategies against explicit goals and guardrails, including activation, retention, cash acquisition cost, operator time, compliance risk, and data confidence.
- Calibrate future runs from privacy-safe aggregate ManaWG metrics when available, while keeping assumed and observed values visibly separate.
- Produce machine-readable results and a concise decision report with recommended experiments, stop conditions, stale-data warnings, and evidence links.
- Support repeatable unattended runs without creating accounts, publishing content, messaging users, buying ads, deploying, or changing production data.

## Capabilities

### New Capabilities

- `growth-simulation`: Defines source-backed inputs, reproducible long-horizon simulation, strategy evaluation, calibration, reporting, and unattended-run safety boundaries.

### Modified Capabilities

None.

## Impact

The change is limited to a repository-local growth-lab command, its versioned non-secret input schema and fixtures, generated ignored reports, a minimal runnable check, and operating documentation. It does not change the ManaWG web application, database schema, production analytics, public content, platform accounts, deployment, or marketing activity. The implementation should reuse the installed Node.js runtime and standard library unless research proves an existing installed dependency is materially better.
