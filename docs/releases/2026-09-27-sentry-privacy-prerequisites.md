# Sentry disclosure release gate — 2026-09-27

**Status: Do not publish the landing update or app release until the remaining project-specific facts are confirmed and the public disclosure is reviewed.**

The Sentry organization `manawg` shows the European Union (EU) as its data-storage region and the Developer billing plan. The General/Legal settings show a “Review and Accept” control for the Data Processing Amendment; no acceptance proof was visible, so do not claim an active DPA. Sentry UI project `4512021577334865` is visible, but its association with the app's configured DSN is unknown. Vercel exposes only the presence of the sensitive Sentry environment keys; the API reports `decrypted:false` with no value, and `vercel env run` omits them. Do not inspect, print, or record secret values.

The official [Sentry pricing page](https://sentry.io/pricing/) lists Developer data retention as a “30-day lookback.” This does not establish here that stored events are deleted after 30 days; do not publish a 30-day deletion claim without authoritative confirmation. The DSN's ingestion host and actual event delivery to the project are also unverified.

Before publication, confirm whether the app DSN maps to project `4512021577334865` and whether the EU storage setting applies, verify the plan's retention/deletion semantics and DPA acceptance, and verify event delivery. The EU data-storage setting alone does not establish that no other international transfer occurs. This note records factual release checks, not a legal-compliance assessment or sign-off.

## September 28 provider readback

The official [DPA v5.1.0](https://sentry.io/legal/dpa/) says it becomes effective when the customer electronically accepts/agrees/opts in. The [official signing instructions](https://www.sentry.help/en/articles/13965008-how-do-i-sign-your-data-processing-addendum) direct customers to organization Legal & Compliance, limit acceptance to Owner/Billing roles, and identify the audit log as the signing record. A separately signed DocuSign copy is also supported; existing use of Sentry must not be treated as proof of acceptance.

Current `manawg` Legal & Compliance still offers **Review and Accept** for the Data Processing Amendment. Its all-time visible audit history contains 19 rows back to organization creation on September 3, with both pagination buttons disabled and no DPA/terms-acceptance action. No current electronic-acceptance proof was found; an external agreement is not ruled out. No acceptance button was clicked.

The optional **Use of aggregated identifying data** checkbox is already off; it was not changed. In the 30-day issue view, the inspected existing TypeError event belongs to `development`, has no URL, and reports a Node eval/tooling error (`Sentry.flush is not a function`). This is existing development ingestion evidence only, not association of the sensitive Production DSN, current deployed-app delivery, or alarm receipt. No event was sent during this readback.

A cropped local proof is retained at `/Users/abu/.codex/visualizations/2026/09/27/01a0e287-c390-72a2-9fee-df7aa528af4b/sentry-legal-status-20260928.png`. The remaining gate is explicit DPA approval/evidence plus exact configured-app delivery proof, not a code or build failure.
