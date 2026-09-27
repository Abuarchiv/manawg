# Sentry disclosure release gate — 2026-09-27

**Status: Do not publish the landing update or app release until the remaining project-specific facts are confirmed and the public disclosure is reviewed.**

The Sentry organization `manawg` shows the European Union (EU) as its data-storage region and the Developer billing plan. The General/Legal settings show a “Review and Accept” control for the Data Processing Amendment; no acceptance proof was visible, so do not claim an active DPA. Sentry UI project `4512021577334865` is visible, but its association with the app's configured DSN is unknown. Vercel exposes only the presence of the sensitive Sentry environment keys; the API reports `decrypted:false` with no value, and `vercel env run` omits them. Do not inspect, print, or record secret values.

The official [Sentry pricing page](https://sentry.io/pricing/) lists Developer data retention as a “30-day lookback.” This does not establish here that stored events are deleted after 30 days; do not publish a 30-day deletion claim without authoritative confirmation. The DSN's ingestion host and actual event delivery to the project are also unverified.

Before publication, confirm whether the app DSN maps to project `4512021577334865` and whether the EU storage setting applies, verify the plan's retention/deletion semantics and DPA acceptance, and verify event delivery. The EU data-storage setting alone does not establish that no other international transfer occurs. This note records factual release checks, not a legal-compliance assessment or sign-off.
