## Purpose

Defines a reproducible, source-backed simulation for comparing ManaWG growth strategies over multiple horizons while keeping uncertainty, observed evidence, and external-action boundaries explicit.

## ADDED Requirements

### Requirement: Provenance-bearing input snapshot
The system SHALL accept a versioned input snapshot in which every market, channel, funnel, cost, retention, referral, and revenue parameter declares its unit, value or bounded range, evidence class (`observed` or `assumed`), source, observation date, and freshness policy. The system SHALL validate the complete snapshot before simulation and SHALL NOT emit a successful result for invalid or unbounded inputs.

#### Scenario: Valid snapshot is accepted
- **WHEN** every required parameter has a valid range, unit, evidence class, source, observation date, and freshness policy
- **THEN** the system accepts the snapshot and records its content hash in the run result

#### Scenario: Invalid snapshot fails closed
- **WHEN** a required parameter is missing provenance, has incompatible units, or has a minimum greater than its maximum
- **THEN** the system exits non-zero with field-level errors and does not update the last successful result

#### Scenario: Stale evidence remains visible
- **WHEN** a source is older than its declared freshness policy
- **THEN** the result marks that source and dependent conclusions as stale and excludes those conclusions from the ready-for-experiment recommendations

### Requirement: Reproducible long-horizon simulation
The system SHALL model the funnel from channel reach through visit, WG creation, WG activation, retention, referral, operating effort, cash cost, and optional revenue. Default runs SHALL evaluate 30-day, 90-day, 365-day, and 1,095-day horizons using pessimistic, base, and optimistic distributions. A seed, model version, input hash, and strategy definition SHALL fully identify a run.

#### Scenario: Default horizons are evaluated
- **WHEN** an operator starts a run without custom horizons
- **THEN** the result contains outcomes for 30, 90, 365, and 1,095 days

#### Scenario: Seeded replay is deterministic
- **WHEN** the same model version, input snapshot, strategies, iteration count, and seed are run twice
- **THEN** both machine-readable results are byte-for-byte equivalent apart from explicitly excluded runtime metadata

#### Scenario: Uncertainty is reported
- **WHEN** a strategy completes simulation
- **THEN** each headline outcome is reported as at least P10, P50, and P90 values rather than as one guaranteed forecast

### Requirement: Activated-WG objective
The system SHALL use activated and retained WGs as the primary outcome rather than registrations. An activated WG SHALL have at least three joined members and at least two meaningful shared actions within its first seven days. The default validation target SHALL be 20 activated WGs within 30 days, at least 40 percent activation, at least 30 percent day-30 retention, and no more than EUR 5 cash acquisition cost per activated WG.

#### Scenario: Registration alone has no activation value
- **WHEN** a simulated WG is created but fewer than three members join or fewer than two meaningful actions occur within seven days
- **THEN** the WG is excluded from the activated-WG count

#### Scenario: Strategy clears the default target
- **WHEN** a strategy satisfies every default validation threshold at the configured confidence level
- **THEN** the result marks it as eligible for a real-world validation experiment, subject to safety and freshness requirements

#### Scenario: Strategy misses one target
- **WHEN** a strategy misses any configured hard threshold
- **THEN** the result identifies the failed threshold and does not label the strategy validated

### Requirement: Evidence-aware calibration
The system SHALL keep assumed market parameters separate from privacy-safe observed ManaWG aggregates. Calibration SHALL record the measurement window and sample size and SHALL NOT silently replace an assumption with an observation. Raw member identifiers, household identifiers, message content, access tokens, and credentials SHALL be rejected from calibration inputs.

#### Scenario: Aggregate observation calibrates a parameter
- **WHEN** a valid aggregate metric includes its measurement window, sample size, unit, and source
- **THEN** the system uses it according to the declared calibration rule and labels the resulting parameter as observed

#### Scenario: Personal data is rejected
- **WHEN** a calibration input contains a raw identifier, message content, token, or credential field
- **THEN** the system rejects the input before persisting or simulating it

#### Scenario: Sparse evidence widens uncertainty
- **WHEN** an observed aggregate has a sample size below its configured confidence threshold
- **THEN** the system preserves or widens the prior uncertainty range and reports the evidence as low confidence

### Requirement: Multi-objective strategy evaluation
The system SHALL compare declarative strategy definitions using activated WGs, day-30 retention, cash acquisition cost, operator hours, contribution margin, compliance risk, and evidence confidence. Hard constraints SHALL be evaluated before weighted ranking, and changing weights SHALL NOT allow a strategy that violates a hard constraint to win.

#### Scenario: Low-cost but unsafe strategy is rejected
- **WHEN** a strategy has favorable acquisition cost but violates an external-action, privacy, platform-policy, or configured budget constraint
- **THEN** the system rejects it before ranking eligible strategies

#### Scenario: Eligible strategies are ranked transparently
- **WHEN** two or more strategies satisfy all hard constraints
- **THEN** the result includes their component metrics, weights, confidence, final score, and rank

#### Scenario: No strategy is strong enough
- **WHEN** every strategy violates a hard constraint or fails the minimum confidence level
- **THEN** the report states that there is no winner and recommends the smallest evidence gap to test next

### Requirement: Decision-ready outputs
Each successful run SHALL write a machine-readable result and a concise human report. The outputs SHALL include data timestamp, source links, freshness state, model version, input hash, seed, horizons, distribution ranges, assumptions, observed evidence, strategy ranking, sensitivity drivers, budget and time estimates, and explicit limitations. The report SHALL recommend no more than three real-world experiments, each with a target segment, channel, hypothesis, duration, cash and time budget, success threshold, stop condition, and required approval.

#### Scenario: Successful run produces auditable outputs
- **WHEN** a run completes successfully
- **THEN** its JSON and Markdown outputs contain the required evidence, replay, ranking, uncertainty, and experiment fields and are linked from an append-only run index

#### Scenario: Previous evidence is preserved
- **WHEN** a new run completes or fails
- **THEN** prior run artifacts remain unchanged and the run index receives a distinct success or failure record

### Requirement: Bounded unattended execution
The simulator SHALL operate only on declarative data, SHALL enforce configured iteration and runtime limits, and SHALL terminate after one run so an external scheduler can invoke it repeatedly. A failed or interrupted run SHALL leave the previous last-known-good result intact and SHALL return a non-zero status.

#### Scenario: Runtime limit is reached
- **WHEN** the configured runtime limit expires
- **THEN** the system stops further evaluation, records a bounded failure without promoting partial results, and exits non-zero

#### Scenario: Concurrent run is attempted
- **WHEN** another process already holds the run lock
- **THEN** the new process exits non-zero without changing results or the run index

### Requirement: No autonomous external action
The simulator SHALL NOT create accounts, publish or schedule content, send messages, purchase advertising, deploy code, mutate production data, or execute candidate-provided code. Recommendations involving an external action SHALL remain proposals and SHALL identify the approval required before execution.

#### Scenario: Strategy requests an external action
- **WHEN** a strategy contains an account, post, message, ad purchase, deployment, or production-write action
- **THEN** the system treats it only as a simulated cost and outcome assumption and does not invoke the action

#### Scenario: Strategy contains executable content
- **WHEN** a strategy input contains a command, script, callback, or executable module reference
- **THEN** the system rejects the strategy before evaluation
