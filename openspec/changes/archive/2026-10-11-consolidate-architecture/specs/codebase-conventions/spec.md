## Purpose

Keep the ManaWG codebase cheap to change for a small team by enforcing its structural rules in CI
instead of in reviews.

## ADDED Requirements

### Requirement: Layered imports

The repository SHALL reject imports that cross layers in the wrong direction: `core` SHALL import
only `core` and `shared`; a feature SHALL import only `core`, `shared` and itself; only `app` and
`composition` SHALL combine features.

#### Scenario: Core imports a feature
- **WHEN** a file under `src/core/` imports from `src/features/`
- **THEN** the architecture check SHALL fail with the offending file and specifier

### Requirement: Size budgets

Source files SHALL stay within the configured line budget, and files over budget SHALL be listed
in an allowlist that the check rejects growing.

#### Scenario: A new file exceeds the budget
- **WHEN** a non-allowlisted source file exceeds the budget
- **THEN** the architecture check SHALL fail

### Requirement: Unit tests import real modules

Unit tests SHALL load application modules through the shared test loader and SHALL NOT evaluate
source text through `vm`, `transpileModule` or text extraction.

#### Scenario: A test uses vm
- **WHEN** a test file references `node:vm` or `transpileModule`
- **THEN** the architecture check SHALL fail

### Requirement: Single idempotency primitive

WG mutations that accept an `Idempotency-Key` SHALL apply it through `withIdempotentWrite`.

#### Scenario: Route claims a slot directly
- **WHEN** a route handler calls `claimResponseSlot` or `lockClaimedResponse` directly
- **THEN** the architecture check SHALL fail

### Requirement: Fixture mode is isolated

Production modules SHALL NOT branch on E2E fixture mode outside the fixture seam.

#### Scenario: A guard checks fixture mode
- **WHEN** a module outside the fixture seam references `isE2EDbDownMode`
- **THEN** the architecture check SHALL fail
