## Decision

Use one small `tools/growth-lab/refresh.mjs` command with Node's built-in
`fetch`, `crypto`, and filesystem APIs. A fixed source definition list prevents
user-provided URLs from becoming an unattended network capability. The command
fetches the Destatis body needed for the one supported scalar extraction and
uses `HEAD` for health-only sources, enforces an 8 MiB limit, records SHA-256
hashes, and parses only the known Destatis student-count pattern. Policy and
API documentation sources are health checks only; they do not become invented
performance data.

Refresh writes into the ignored `runs/` directory and never overwrites the
versioned fixture. It uses atomic file writes.
The existing simulator then consumes the dated live snapshot. A new
`sourceRefresh` field is passed through to results and reports so current
reachability is visible without changing ranking semantics.

## Limits

- Current public evidence for WG share and funnel behavior remains stale or
  assumed until a privacy-safe first-party aggregate is supplied.
- HTTP 200 proves retrieval, not freshness, correctness, demand, or marketing
  lift.
- Google Trends API access remains limited; the refresh records documentation
  health rather than pretending to have trend data.
