## Purpose

Protect the app's exposed database surface with an additional Row Level Security boundary while keeping the existing server-owned access model and client denial behavior unchanged.

## ADDED Requirements

### Requirement: App tables have a defense-in-depth RLS boundary

The system SHALL have Row Level Security enabled on every audited app table in the exposed public schema in both Preview and Production. Enabling this boundary MUST NOT by itself expose rows or grant a client role access.

#### Scenario: Catalog audit finds complete RLS coverage

- **WHEN** the release checker inspects the audited app-table set in Preview or Production
- **THEN** every expected table reports RLS enabled and no expected table is missing from the audit

#### Scenario: A new app table cannot bypass the boundary silently

- **WHEN** the migration checker runs after a schema change
- **THEN** it fails if an expected table is absent from the RLS contract or if an unexpected app table is introduced without an explicit review update

### Requirement: Client database access remains denied until explicitly designed

The system SHALL keep `anon` and `authenticated` client access to app tables denied unless a later reviewed change adds the required grants and row policies. This RLS change MUST NOT add policies, grants, executable public functions, or a Data API exposure.

#### Scenario: Anonymous direct access remains denied

- **WHEN** an unauthenticated client queries an app table through the Supabase Data API after the migration
- **THEN** the request remains denied and no app row is returned

#### Scenario: Authenticated non-member direct access remains denied

- **WHEN** an authenticated Supabase client queries an app table without a reviewed row policy
- **THEN** the request remains denied and no app row is returned

### Requirement: Database migration evidence is exact and reviewable

The release process SHALL verify the migration ledger order, the complete RLS table set, and the unchanged client grants/policies before promoting the migration. Preview rehearsal evidence SHALL be retained before Production application.

#### Scenario: Preview rehearsal is required before promotion

- **WHEN** the RLS migration is proposed for Production
- **THEN** Preview has a successful migration/check run plus catalog and client-denial evidence, or promotion is blocked

#### Scenario: Drift or unexpected access fails closed

- **WHEN** the checker finds missing RLS, unexpected grants/policies/functions, or migration-ledger drift
- **THEN** the release gate fails without applying unrelated schema or access changes
