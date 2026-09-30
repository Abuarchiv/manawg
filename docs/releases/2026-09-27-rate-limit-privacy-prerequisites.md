# Upstash rate-limit analytics publication gate — 2026-09-27

Historical September 27 prerequisite (superseded by the deployment update below): **Status: Do not publish the landing update until the rate-limit analytics cutover and historical-data checks are complete.**

At the September 27 readback, Production used analytics-enabled code. This is historical: the September 30 deployed-SHA check below confirms analytics are disabled. Candidate rate-limit IP counters expire after at most 2 hours and 1 second; member counters use member identifiers. Historical analytics cleanup remains open.

The installed `@upstash/ratelimit` 2.0.8 / `@upstash/core-analytics` 0.0.10 path records the limiter identifier and outcome in hourly analytics buckets without an application-set expiry. The wrapper passes a `retention` value that this core-analytics version does not consume. Therefore the former 24-hour/no-permanent-storage statement was unsupported.

The resource is `upstash-kv-carmine-clock`, Vercel resource `store_4dDvmtJKRDzbsVKL`, installation `icfg_oozp4hyQ4vBam8i2aCGAxjMy`, Upstash database `1ff96aed-6289-44a1-a4e8-8059e85f57eb`. Vercel UI and CLI confirm attachment to `manawg-app` across Production, Preview and Development. The local configured endpoint matches the resource and the readable Production `REDIS_URL`/`KV_URL` hostnames. One ordinary unauthenticated Production health GET returned 200; a bounded before/after health-namespace metadata scan showed one additional counter key and an event-cardinality increase of one. This strongly supports runtime association, but concurrent health traffic prevents unique attribution. The specific Production UPSTASH env record remains Sensitive, has no configuration/resource ID, and cannot be directly compared. No credential values or raw limiter identifiers are recorded here.

The initial incomplete 500-key scan was superseded by a complete scoped `manawg:*:events:*` scan below a 5,000-key cap: **539 unique event-index keys, all TTL=-1; aggregate ZCARD 1,067**. No members, payloads, raw keys or IPs were read or emitted. The inventory used SCAN/TTL/ZCARD only and made no Redis writes/deletions. The ordinary health GET uses the deployed limiter and may itself add normal telemetry; the before/after delta is correlation, not proven causation.

Historical September 27 prerequisite (superseded by the deployment update below): Do not claim historical analytics are gone. Before publication, complete the app cutover and obtain explicit authorization for a narrowly scoped historical-retention cleanup. The resource is shared across environments, so cleanup must not remove active counters or unrelated keys. This note records release facts; it is not a legal-compliance assessment or sign-off.

## September 30 deployment update

Historical source-cutover proof was obtained for Production `435648f7196094a709fa82153b764ea356946d39` (`dpl_5gbHJsAK5BqjieghAwEhsRgkLUSr`). Latest September 30 Production is separately published `6aa0b666bb4704138e6976629716f8a9eac19c07` (`dpl_37GfugtVpdpbuXJMKyPvvSuyQEyV`). Its committed `apps/web/src/core/rate-limit.ts` contains `analytics: false` and routes SDK timeout results through the configured failure policy. The earlier statement that Production still runs analytics-enabled code is historical and superseded. This is deployed-SHA/source evidence, not a fresh Redis runtime scan. The 539-key historical inventory remains unchanged evidence; no historical cleanup has been authorized or performed.

The current `6aa0b666` rate-limit source also retains `analytics: false`; this is exact deployed-SHA/source evidence, not a new Redis runtime inventory or proof that every historical writer is fenced. Live September 30 landing disclosure now describes nonexpiring historical Upstash metadata. No historical data was deleted.

Current status: analytics-disabled source is verified for deployed `6aa0b666`; historical metadata cleanup remains unperformed. The accurate September 30 public disclosure is now published. This source readback does not establish that every old writer is fenced or that stored historical data has expired.
