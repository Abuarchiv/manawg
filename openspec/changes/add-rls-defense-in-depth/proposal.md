## Why

The ManaWG server-side guards and denied Data API grants currently keep the app's public tables out of the client access path, but both Supabase projects report RLS disabled on all 26 app tables. Enabling RLS as a defense-in-depth boundary reduces the impact of an accidental future grant or exposure without inventing policies for the app's server-owned access model.

## What Changes

- Add a forward migration that enables RLS on the audited public app tables only.
- Keep `anon` and `authenticated` Data API grants, policies, and executable functions unchanged; this change does not expose tables or add permissive policies.
- Extend the migration checker with exact catalog assertions for RLS state and migration-ledger ordering.
- Rehearse the migration on Preview and verify that direct client access remains denied before production application.

## Capabilities

### New Capabilities

- `rls-defense-in-depth`: Defense-in-depth RLS state and catalog verification for server-owned Supabase tables.

### Modified Capabilities

None. The app's user-visible API and membership authorization behavior remain unchanged.

## Impact

The change affects Supabase migration SQL, the repository's database migration verifier, and Preview/Production migration gates. It does not add dependencies, change application routes, grant Data API access, create policies, or modify existing data. The migration must be applied and verified under the separate release/database ownership boundary.
