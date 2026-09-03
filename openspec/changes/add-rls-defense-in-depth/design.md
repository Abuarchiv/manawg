## Context

See `proposal.md` for motivation. The current release audit reports 26 public app tables in Preview and Production, with no RLS enabled and no client Data API grants, policies, or public executable functions. ManaWG's application routes use server-owned database access and enforce membership in application guards, so the first database hardening step must add a boundary without inventing a client row-access model.

## Goals / Non-Goals

**Goals:**

- Enable RLS for the explicitly audited app-table set in a forward migration.
- Keep the existing server-side route behavior and denied `anon`/`authenticated` access unchanged.
- Make the migration checker assert exact table coverage, ledger order, and absence of new client access.
- Require a Preview rehearsal and direct client-denial evidence before Production application.

**Non-Goals:**

- Do not add RLS policies, Data API grants, public functions, or a new client data-access model.
- Do not refactor route-level membership guards or change application authorization semantics.
- Do not modify existing data, migration history outside the new forward entry, or provider/deployment configuration.

## Decisions

1. **Use an explicit, reviewed table contract.** The release agent derives the table list from the live catalog audit and records it in the migration/checker. This is preferred over a dynamic `DO` block that silently changes scope as tables are added; a new table must force a visible contract update.

2. **Enable RLS without policies or grants.** Supabase documents grants as object access and RLS as row access, and recommends using both controls for exposed objects ([Securing your API](https://supabase.com/docs/guides/api/securing-your-api)). Because client grants are currently denied and the app uses server-owned access, adding policies now would create a new public surface rather than preserve the current boundary.

3. **Keep catalog checks separate from migration application.** The existing migration verifier remains the single gate for exact ledger and schema assertions; it must reject missing/unknown tables and unexpected client access before promotion. A count-only check is rejected because it can miss table substitution or access drift.

4. **Rehearse Preview before Production.** Apply the same migration to Preview, capture catalog and direct Data API denial results, run the application source/fixture gates, and only then allow the release owner to promote. If any check fails, stop without compensating grants or policies.

## Risks / Trade-offs

- [A server-side path uses a role affected by RLS] → Verify the release connection role and run the existing application smoke/fixture checks in Preview before Production; do not assume RLS is bypassed without evidence.
- [A future client feature needs direct table access] → Add a separate reviewed change with least-privilege grants and row policies; do not weaken this migration.
- [The audited table set drifts] → Keep the expected set and ledger assertions exact so drift fails closed.
- [Rollback is needed after application behavior changes] → The release owner may explicitly disable the RLS flags in a controlled rollback migration after preserving evidence; no automatic destructive rollback is included.

## Migration Plan

1. Generate the forward migration through the repository's Supabase migration workflow and review that it contains only RLS enablement for the audited tables.
2. Extend the existing migration checker with exact RLS, table-set, ledger-prefix, grant, policy, and function assertions.
3. Run the checker and application source/fixture gates against Preview; verify anonymous and authenticated Data API requests remain denied.
4. After a successful Preview rehearsal and direct evidence handoff, apply the identical migration to Production under release/database ownership and rerun the catalog checks.
5. If Preview or Production behavior diverges, stop promotion and use an explicitly reviewed rollback migration; never add emergency client grants or permissive policies.
