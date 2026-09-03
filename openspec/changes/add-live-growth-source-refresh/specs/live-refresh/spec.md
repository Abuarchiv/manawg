## ADDED Requirements

### Requirement: Allowlisted public refresh
The refresh command SHALL fetch only the fixed HTTPS source URLs declared by the
fixture and SHALL record URL, HTTP status, fetch timestamp, response hash, and
bounded response size for every source. Health-only sources MAY use `HEAD`; in
that case the hash SHALL cover the response metadata rather than an absent body.

#### Scenario: Sources are reachable
- **WHEN** every allowlisted source returns a successful response within the
  timeout
- **THEN** the command writes a dated source-status artifact and a new input
  snapshot without changing the baseline input

#### Scenario: Source fails closed
- **WHEN** a source is unreachable, returns a non-success status, exceeds the
  response-size limit, or cannot be parsed when extraction is required
- **THEN** the command exits non-zero and does not write a live input snapshot

### Requirement: Verifiable extraction
The refresh command SHALL update only explicitly configured observations and
SHALL preserve their original publication/observation date, source URL, unit,
and bounded uncertainty range. A fetch timestamp SHALL NOT be presented as the
observation date.

#### Scenario: Destatis student count is found
- **WHEN** the configured Destatis page contains its declared student-count
  pattern
- **THEN** `market.students.mode` is updated, evidence remains observed, and
  the publication date remains attached to the parameter

#### Scenario: No supported value is found
- **WHEN** the configured extraction pattern is absent or ambiguous
- **THEN** refresh fails without silently inventing or copying a value

### Requirement: Snapshot and scheduler handoff
The refresh SHALL write `live-input-YYYY-MM-DD.json` and the simulator SHALL
expose the recorded source-refresh state in its machine-readable and Markdown
outputs. The recurring scheduler SHALL run refresh before simulation and use the
same dated live input.

#### Scenario: Loop uses current input
- **WHEN** the recurring job runs successfully
- **THEN** the simulation data timestamp is the refresh date and the report lists
  the live source checks

#### Scenario: Baseline remains reproducible
- **WHEN** refresh runs repeatedly or fails
- **THEN** the versioned baseline snapshot and previous simulator last-success
  result remain unchanged
