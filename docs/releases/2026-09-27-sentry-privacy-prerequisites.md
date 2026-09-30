# Sentry disclosure release gate — 2026-09-27

**Status: DPA acceptance, synthetic SDK/project ingestion and existing alert-rule activation are verified. The September 30 privacy disclosure is published; deployed-browser delivery and mailbox receipt remain open.**

Historical September 27 readback (project association and EU ingestion were subsequently verified below): The Sentry organization `manawg` shows the European Union (EU) as its data-storage region and the Developer billing plan. The General/Legal settings show a “Review and Accept” control for the Data Processing Amendment; no acceptance proof was visible, so do not claim an active DPA. Sentry UI project `4512021577334865` is visible, but its association with the app's configured DSN is unknown. Vercel exposes only the presence of the sensitive Sentry environment keys; the API reports `decrypted:false` with no value, and `vercel env run` omits them. Do not inspect, print, or record secret values.

Historical September 27 readback (project association and EU ingestion were subsequently verified below): The official [Sentry pricing page](https://sentry.io/pricing/) lists Developer data retention as a “30-day lookback.” This does not establish here that stored events are deleted after 30 days; do not publish a 30-day deletion claim without authoritative confirmation. The DSN's ingestion host and actual event delivery to the project are also unverified.

Historical September 27 readback (project association and EU ingestion were subsequently verified below): Before publication, confirm whether the app DSN maps to project `4512021577334865` and whether the EU storage setting applies, verify the plan's retention/deletion semantics and DPA acceptance, and verify event delivery. The EU data-storage setting alone does not establish that no other international transfer occurs. This note records factual release checks, not a legal-compliance assessment or sign-off.

## September 28 provider readback

The official [DPA v5.1.0](https://sentry.io/legal/dpa/) says it becomes effective when the customer electronically accepts/agrees/opts in. The [official signing instructions](https://www.sentry.help/en/articles/13965008-how-do-i-sign-your-data-processing-addendum) direct customers to organization Legal & Compliance, limit acceptance to Owner/Billing roles, and identify the audit log as the signing record. A separately signed DocuSign copy is also supported; existing use of Sentry must not be treated as proof of acceptance.

Current `manawg` Legal & Compliance still offers **Review and Accept** for the Data Processing Amendment. Its all-time visible audit history contains 19 rows back to organization creation on September 3, with both pagination buttons disabled and no DPA/terms-acceptance action. No current electronic-acceptance proof was found; an external agreement is not ruled out. No acceptance button was clicked.

The optional **Use of aggregated identifying data** checkbox is already off; it was not changed. In the 30-day issue view, the inspected existing TypeError event belongs to `development`, has no URL, and reports a Node eval/tooling error (`Sentry.flush is not a function`). This is existing development ingestion evidence only, not association of the sensitive Production DSN, current deployed-app delivery, or alarm receipt. No event was sent during this readback.

A cropped local proof is retained at `/Users/abu/.codex/visualizations/2026/09/27/01a0e287-c390-72a2-9fee-df7aa528af4b/sentry-legal-status-20260928.png`. The remaining gate is explicit DPA approval/evidence plus exact configured-app delivery proof, not a code or build failure.

## Earlier September 30 association readback (before authorized acceptance)

Public Production HTML and its 24 same-origin scripts identify the compiled DSN as project `4512021577334865` with EU ingestion. Only comparison booleans were retained; no key or DSN was emitted. This closes the compiled-project association question above. DPA acceptance, current app event delivery, alert receipt and retention/deletion semantics remain open. At that earlier readback the local landing disclosure correction was still unpublished.

## September 30 authorized acceptance and ingestion

The operator explicitly authorized DPA 5.1.0 acceptance and a synthetic error test. The organization UI now states `Version 5.1.0 signed Sep 30, 2026`; the Developer tariff and aggregated identifying-data setting were not changed. Screenshot proof is retained privately.

The actual source initializer and sanitizer sent one synthetic event to the public-compiled Production project. Sentry shows issue `150376348`, event `88368b12a5584a9fb97f75c64bcd897d`, environment `release-audit`, release `0c4ff36-synthetic-verification`, and exception value `[redacted]`. This closes DPA acceptance and synthetic SDK/project ingestion. It does not prove a deployed-browser journey, alarm receipt or event deletion after a fixed number of days. Landing disclosure publication is now confirmed: Production `47d0ff76ebdabe8b5392ea0a6313c71182e949e7`, deployment `dpl_ANedkXQ5EA9he7hvrThK9LaRXJbD`; live `/datenschutz` is dated September 30 and includes Sentry, OCR and historical Upstash retention. This was an independent publication; this audit did not deploy it.

The existing high-priority issue alert history now contains the synthetic `[redacted]` error trigger. No alert rule, recipient or tariff was changed. This proves the existing rule fired; mailbox receipt remains unverified. A separate screenshot records this distinction.

## Separate platform-only readback — September 30

The following independent platform readback preserves the current privacy-setting and historical event observations. Its lack of DSN association proof is specific to that readback; the earlier public-compiled-source association and SDK transport proof above remain separate.

The Legal & Compliance page now displays the EU as the storage region and Data Processing Amendment v5.1.0 as signed on September 30, 2026. The “Use of aggregated identifying data” option is still off.

The `javascript-nextjs` project (`4512021577334865`) received a synthetic release-audit issue. Its UI showed a redacted error and zero users, but included city-level geography. Synthetic release/server labels do not establish that the event came from the deployed ManaWG app or its configured DSN.

In project Security & Privacy, server-side data scrubbing and default scrubbers were enabled; IP-address prevention was off. The independent September 30 platform reviewer enabled **Prevent Storing IP Addresses** and verified it stayed checked after reload; this audit did not make that setting change. Sentry says this applies to new events. The existing synthetic event remains unchanged, and no event was sent after this setting change.

The alert list showed three rules. “Send a notification for high priority issues” had triggered about two hours before this readback, with Email as its action. That is rule-trigger evidence only, not proof of email delivery. “ManaWG Production Health Alarm” had no trigger. No test email was sent.

The `6c507fa0` source tree uses `@sentry/nextjs` 11.0.0, sets `dataCollection.userInfo: false`, and sanitizes events in `beforeSend`. The current [official JavaScript data-collection documentation](https://docs.sentry.io/platforms/javascript/data-management/data-collected/) describes `userInfo: false` as disabling automatic user identity and IP collection; it also warns that HTTP headers, cookies, and query parameters can still carry IP values unless separately restricted. Because the observed issue was synthetic, this readback did not establish a product-code defect and made no app-source change.

Vercel’s live environment readback confirms that Sentry variable names exist, but their values were not read. That platform-only readback did not itself establish the app DSN mapping; the separate public-compiled-source association proof above remains valid. Retention/deletion semantics and an actual alert email receipt remain open release evidence; the “30-day lookback” label is not proof of automatic deletion.
