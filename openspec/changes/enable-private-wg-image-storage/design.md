## Context

See proposal.md. The current signer is AWS-specific and returns a public URL. Supabase and its SDK are already present. Preview has no storage bucket; new storage must be private. Existing image consumers accept absolute URLs, while the image validator currently trusts configured AWS origins.

## Goals / Non-Goals

**Goals:** preserve upload/client contracts, enforce current membership on reads, configure Preview without a second storage account, and prove provider limits and cleanup.

**Non-Goals:** migrate existing AWS images, change database schema or account signup, publish Production, introduce a provider framework, or loosen public-table RLS.

## Decisions

- Add a small server-only Supabase storage helper and a protected read route. Use the installed SDK; explicitly select the provider with IMAGE_STORAGE_PROVIDER=supabase, a fixed private bucket variable, and a server-only service-role key. AWS remains the default.
- Preserve presignedUrl/publicUrl/maxFileSize. The publicUrl field contains a trusted absolute application read URL carrying a strictly parsed WG-scoped object key, not a public object URL. Optional uploadHeaders support the SDK's no-cache PUT contract in both online and offline clients.
- Stream/download object content through the authenticated application route, with private/no-store headers and MIME restrictions. A signed-GET redirect was rejected because cached bearer URLs can outlive membership or token expiry. Verify the full supported size through the deployed route.
- Validate key grammar and destination WG in every image write caller. Derive origin from trusted deployment configuration; never trust arbitrary forwarded host headers. Use VERCEL_URL for Preview and configured stable app origin for Production.
- Validate private bucket settings before signing: public=false, fileSizeLimit=8388608 and exactly the permitted image MIME set. Do not add general anonymous/authenticated bucket policies. The storage-side cap remains authoritative for direct PUTs.

## Risks / Trade-offs

- Proxying image reads adds application bandwidth and memory pressure: stream the response and verify an 8 MiB deployed download; fail the release gate if platform limits prevent it.
- Supabase upload authorizations last two hours: immutable keys, upsert=false, provider limits and existing rate limits bound use; revoked members cannot read through the application.
- Existing public AWS objects remain public: no silent migration or public fallback is part of this change.
- Preview origins vary by deployment: use the trusted current Preview origin for synthetic tests; Production uses the stable configured origin.

## Migration Plan

Implement and review the additive path, provision an empty private Preview bucket, configure server-only Preview variables, deploy a fixed candidate and execute real upload/render/denial/limit/cleanup checks. Roll back provider selection to AWS if needed; preserve the authenticated read path for any stored private references. No Production mutation is included.
