## Purpose

Defines a general shared-housing market view for ManaWG so student data remains a useful reference segment without becoming the sole market-capacity assumption.

## ADDED Requirements

### Requirement: General WG market capacity

The simulation SHALL evaluate acquisition against a bounded aggregate capacity for general German WGs. It MUST NOT derive that capacity solely by multiplying or dividing a student count, and it SHALL keep the aggregate range's evidence class, source, observation date, and freshness policy visible.

#### Scenario: General capacity is used

- **WHEN** a valid snapshot contains a bounded general-WG capacity
- **THEN** the simulation applies that capacity to all declared WG-audience strategies, regardless of whether a strategy also targets students

#### Scenario: General capacity is assumed

- **WHEN** no current authoritative all-WG capacity is available
- **THEN** the snapshot may use an explicitly assumed bounded range, and the result SHALL label the capacity as assumed rather than presenting it as observed market size

### Requirement: Student data is a reference segment

Student observations SHALL remain available as a named reference segment and may be refreshed independently, but they MUST NOT silently act as the population ceiling for non-student WG residents.

#### Scenario: Student refresh succeeds

- **WHEN** the configured student source yields a verified value
- **THEN** the refresh updates the student reference observation while preserving the general-WG capacity and its provenance

#### Scenario: Non-student audience is simulated

- **WHEN** a strategy targets employed residents, trainees, international residents, or other shared households
- **THEN** its simulation uses the general-WG capacity and reports the audience label without claiming a separately observed segment size

### Requirement: Broad audience is visible

The versioned snapshot and generated report SHALL identify students, employed residents, trainees, international residents, and other shared households as the intended audience categories, while keeping unsupported category-specific rates explicitly assumed or qualitative.

#### Scenario: Report describes the audience

- **WHEN** a general-WG run completes
- **THEN** its machine-readable result and Markdown report identify the broad WG audience and retain all applicable uncertainty and stale-evidence warnings
