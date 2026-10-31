# playwright-test-strategy Specification

## Purpose
Provide one predictable browser-verification contract that separates deterministic fixture coverage from checks requiring a deployed application and real services.

## Requirements

### Requirement: Playwright is the canonical browser verification runner

The project SHALL expose `pnpm --filter @manawg/web test:e2e:fixtures` as the supported deterministic browser verification entry point. Unit and route contracts SHALL remain a separate lane using Node's built-in test runner; no additional unit-test framework is required.

#### Scenario: Standard application test command

- **WHEN** a contributor runs `pnpm --filter @manawg/web test:e2e:fixtures`
- **THEN** the Playwright suite starts and its exit status represents the suite result

#### Scenario: Unit and route verification

- **WHEN** a contributor runs `pnpm test` from the repository root
- **THEN** the Node unit and route suite starts and its exit status represents that suite, independently of the browser lane

#### Scenario: Obsolete runner is absent from the supported workflow

- **WHEN** the repository is installed from its lockfile and the supported test commands are inspected
- **THEN** no obsolete unit-test runner command or dependency is required to run application verification

### Requirement: Fixture verification is isolated from real databases

The fixture lane SHALL run deterministically without connecting to a real application database, production service, or production credential, and SHALL return a non-zero status when a fixture scenario fails.

#### Scenario: Fixture mode uses its declared boundary

- **WHEN** the fixture suite runs in CI
- **THEN** the application uses its deterministic fixture boundary and does not require a live database connection

#### Scenario: Fixture failure blocks the lane

- **WHEN** any fixture scenario fails
- **THEN** the fixture command exits non-zero and CI marks the lane as failed

### Requirement: Supported application flows have browser coverage

The fixture suite SHALL exercise the supported launch and household flows needed to detect regressions in the dashboard, chores, expenses, calendar, shopping, and notice-board areas.

#### Scenario: Core flow regression

- **WHEN** a change breaks one of the supported launch or household flows
- **THEN** the corresponding Playwright scenario fails before the fixture lane is accepted

### Requirement: Verification evidence identifies its execution mode

Each CI verification lane SHALL make its execution mode and base origin discoverable in its logs or test report, without exposing credentials or bypass secrets.

#### Scenario: Fixture evidence is distinguishable

- **WHEN** a reviewer inspects a completed fixture lane
- **THEN** the evidence identifies it as fixture-mode verification and does not present it as proof of a deployed backend
