# preview-verification Specification

## Purpose
Provide a protected, repeatable way to verify an approved Preview deployment with real authentication while preventing untrusted deployment URLs or test code from receiving QA credentials.

## Requirements

### Requirement: Preview targets are trusted before secrets are used

The protected Preview lane SHALL validate the deployment-status payload before injecting any QA credential or automation-bypass secret. The accepted target SHALL be the canonical HTTPS origin `https://<VERCEL_PROJECT_NAME>-<hash>-<VERCEL_TEAM_SLUG>.vercel.app` built from the repository variables, with the URL taken from the Vercel-created Preview deployment status; the lane SHALL reject any other actor, environment, URL shape, or source.

#### Scenario: Approved target passes validation

- **WHEN** a Vercel-created `Preview` deployment-status event supplies a target URL matching the canonical project origin and URL shape
- **THEN** the lane may proceed to load protected Preview tests

#### Scenario: Unapproved target is rejected

- **WHEN** the deployment status supplies an invalid, unrelated, credential-bearing, or otherwise unapproved URL
- **THEN** the lane fails before protected credentials are made available

### Requirement: Preview credentials remain environment-bound

The Preview lane SHALL obtain credentials only from its protected CI environment, SHALL fail when required credentials are missing, and SHALL NOT print credential values or pass them to an unapproved origin. It SHALL execute trusted test code checked out at the repository `main` commit and SHALL require that commit to equal the deployment status payload's source revision before secrets are available; it SHALL never execute an event-supplied ref or fork revision in the secrets-bearing job.

#### Scenario: Missing protected credential

- **WHEN** a required QA credential is absent
- **THEN** the Preview lane fails before authenticated tests start

#### Scenario: Protected credential handling

- **WHEN** a validated Preview target's deployment source revision equals the trusted `main` checkout
- **THEN** the test process can authenticate using the protected QA identity while logs and reports contain no secret values

#### Scenario: Untrusted source revision

- **WHEN** the deployment source revision does not equal the trusted `main` checkout or would require executing an event-supplied ref
- **THEN** the lane fails before protected credentials are made available

### Requirement: Preview verification uses disposable QA activity

The authenticated Preview lane SHALL use a dedicated QA identity and a unique run-tagged data namespace, SHALL exercise at least one authenticated household flow against the deployed application, and SHALL successfully remove all data it creates before the lane passes.

#### Scenario: Authenticated smoke flow

- **WHEN** the validated Preview deployment is reachable and the QA identity authenticates
- **THEN** the lane verifies launch, authenticated household access, and one representative mutation/read flow against the deployed application

#### Scenario: Cleanup after a completed run

- **WHEN** Preview verification creates test data
- **THEN** the lane removes the data before passing and reports the run namespace if cleanup fails

#### Scenario: Cleanup failure

- **WHEN** the lane cannot prove that all data created by the run was removed
- **THEN** the lane fails non-zero and exposes the isolated run namespace for remediation without exposing credentials

### Requirement: Preview evidence identifies the tested deployment

The Preview lane SHALL report the validated deployment origin, deployment identifier, source revision, execution mode, and pass/fail result, and SHALL return a non-zero status for target, source, authentication, flow, or cleanup failures that violate the lane contract.

#### Scenario: Reviewable Preview result

- **WHEN** the protected Preview lane completes
- **THEN** a reviewer can identify the approved origin, deployment identifier, and source revision that were tested and whether the authenticated flow passed without seeing secrets
