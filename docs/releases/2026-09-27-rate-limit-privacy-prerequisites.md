# Upstash rate-limit analytics publication gate — 2026-09-27

Historical September 27 prerequisite (superseded by the deployment update below): **Status: Do not publish the landing update until the rate-limit analytics cutover and historical-data checks are complete.**

At the September 27 readback, Production used analytics-enabled code. This is historical: the September 30 deployed-SHA check below confirms analytics are disabled. Candidate rate-limit IP counters expire after at most 2 hours and 1 second; member counters use member identifiers. Historical analytics cleanup remains open.

The installed `@upstash/ratelimit` 2.0.8 / `@upstash/core-analytics` 0.0.10 path records the limiter identifier and outcome in hourly analytics buckets without an application-set expiry. The wrapper passes a `retention` value that this core-analytics version does not consume. Therefore the former 24-hour/no-permanent-storage statement was unsupported.

The resource is `upstash-kv-carmine-clock`, Vercel resource `store_4dDvmtJKRDzbsVKL`, installation `icfg_oozp4hyQ4vBam8i2aCGAxjMy`, Upstash database `1ff96aed-6289-44a1-a4e8-8059e85f57eb`. Vercel UI and CLI confirm attachment to `manawg-app` across Production, Preview and Development. The local configured endpoint matches the resource and the readable Production `REDIS_URL`/`KV_URL` hostnames. One ordinary unauthenticated Production health GET returned 200; a bounded before/after health-namespace metadata scan showed one additional counter key and an event-cardinality increase of one. This strongly supports runtime association, but concurrent health traffic prevents unique attribution. The specific Production UPSTASH env record remains Sensitive, has no configuration/resource ID, and cannot be directly compared. No credential values or raw limiter identifiers are recorded here.

The initial incomplete 500-key scan was superseded by a complete scoped `manawg:*:events:*` scan below a 5,000-key cap: **539 unique event-index keys, all TTL=-1; aggregate ZCARD 1,067**. No members, payloads, raw keys or IPs were read or emitted. The inventory used SCAN/TTL/ZCARD only and made no Redis writes/deletions. The ordinary health GET uses the deployed limiter and may itself add normal telemetry; the before/after delta is correlation, not proven causation.

Historical September 27 prerequisite (superseded by the deployment update below): Do not claim historical analytics are gone. Before publication, complete the app cutover and obtain explicit authorization for a narrowly scoped historical-retention cleanup. The resource is shared across environments, so cleanup must not remove active counters or unrelated keys. This note records release facts; it is not a legal-compliance assessment or sign-off.

## September 30 deployment update

Historical source-cutover proof was obtained for Production `435648f7196094a709fa82153b764ea356946d39` (`dpl_5gbHJsAK5BqjieghAwEhsRgkLUSr`). A separate September 30 readback verified deployed `6aa0b666bb4704138e6976629716f8a9eac19c07` (`dpl_37GfugtVpdpbuXJMKyPvvSuyQEyV`): its committed `apps/web/src/core/rate-limit.ts` contains `analytics: false` and routes SDK timeout results through the configured failure policy. This is deployed-SHA/source evidence, not a fresh Redis runtime scan or proof that every historical writer is fenced. The September 30 public landing disclosure described nonexpiring historical Upstash metadata.

The `cca08ac6` source tree constructs its Upstash rate limiters with `analytics: false`. New limiter counters still use raw client-IP keys for IP-scoped limits or member identifiers for member-scoped limits, and expire within their configured sliding windows (the prior audit measured an upper bound of two hours and one second). This is a source-level candidate fact, not proof of Production cutover.

The September 27 read-only Upstash inventory remains the latest data readback available to this task: it found 539 `manawg:*:events:*` index keys without a TTL and aggregate cardinality 1,067. No payloads or IP values were read. No fresh scan or Redis mutation was performed on September 30. Historical analytics may still exist; disabling analytics does not erase old buckets. Any cleanup of the shared Redis resource remains a separate, explicitly authorized operator action.

## Read-only metadata refresh — 2026-09-30

Using the existing TLS `REDIS_URL`/`KV_URL` in the private workspace environment, both confirmed to resolve to the same Upstash database, a bounded `SCAN MATCH manawg:*:events:* COUNT 1000` found **552 unique keys**. All were sorted sets with **TTL -1** and a combined **ZCARD of 1,111**; none disappeared during the metadata read. Compared with September 27, that is **+13 keys** and **+44 members**.

The time-like key suffixes span **2026-08-29 06:00 UTC–2026-09-28 01:00 UTC**. This is only the key-bucket range; sorted-set scores and members were not read, so it does not establish event timestamps or a retention policy. No expiry is configured by these keys. The review-only purge plan has 552 candidates, bounded to numeric bucket suffixes no later than the recorded scan start (`2026-09-30T12:24:23.073Z`) and the matching metadata fingerprint in the private operator report. Owner approval is required before deletion. No deletion or TTL mutation was performed.

## Later operator cleanup — 2026-09-30

The independently recorded operational follow-up in [September 30 release evidence](2026-09-30-release-evidence.md#final-native-delivery-and-operational-follow-up) states that, after explicit owner confirmation in that separate task, the guarded operation deleted exactly 552 reviewed analytics keys containing 1,111 entries. Its separate TLS readback at `2026-09-30T19:18:42.525Z` found zero matching analytics keys. The metadata refresh above describes the pre-cleanup inventory. This merge task performed no Redis scan, deletion or TTL mutation; the separate operator record does not authorize another execution or establish removal from provider logs/backups.
