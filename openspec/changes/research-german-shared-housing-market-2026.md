# German shared-housing/WG market research beyond students

**Research snapshot:** 3 September 2026 (Europe/Berlin)
**Scope:** Germany; general shared housing/WGs beyond a student-only market; low-cost acquisition constraints.
**Status:** Research only. No production code, account, listing, campaign, or external-service change was made.

## Executive conclusion

Germany has a large, measurable population of people living alone and substantial housing-cost pressure, but there is no clean official “WG market” series. Destatis counts people in a WG with separate household management as separate households. Therefore, official household and population statistics are **context ceilings and cohort anchors**, not WG total addressable market (TAM).

For a bounded simulation, model at least two non-student cohorts separately: (1) working-age movers/room-seekers and (2) older adults for whom shared living is an unvalidated product hypothesis. Use current survey/platform evidence only as directional priors for channel ranking and unmet need. Do not turn any survey percentage into a conversion rate or multiply unrelated samples together.

The lowest-risk acquisition baseline is owned/referral distribution plus small, human-run partnerships with organizations that already reach relevant movers or housing communities. Keep paid ads, cold outreach, scraping, bulk messaging, and contact-data reuse out of the baseline.

## Official population, household, and housing anchors

| Signal | Current value | Appropriate use | Exact caveat | Primary source and date |
|---|---:|---|---|---|
| Total population, 2025 | 83,467,117 | National context ceiling | From 2022 onward the series is based on the population projection using the 2022 Census; category and comparability changes apply. | [Destatis: Population by age groups](https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Bevoelkerungsstand/Tabellen/liste-altersgruppen-basis-2022.html), page status 16 June 2026 |
| Population aged 20–40, 2025 | 20,175,298 | Broad working-age/mover context | This is an age band, not a WG-seeker, non-student, employment, or mobility measure. | Same Destatis table, page status 16 June 2026 |
| Private main-residence households, 2025 | 41.126 million | Household denominator | First results of the 2025 Microcensus; only main-residence households. The Microcensus methodology has breaks versus earlier periods. | [Destatis: Households by size, 2025](https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Haushalte-Familien/Tabellen/1-1-privathaushalte-haushaltsmitglieder.html), page status 13 April 2026 |
| One-person households, 2025 | 17.327 million; 42.1% of households; 20.9% of household members | Upper bound for people who might consider a different housing arrangement | Living alone does not imply wanting or being able to join a WG. | Same Destatis household table, page status 13 April 2026 |
| People living alone, ages 25–45, 2025 | 4.903 million | Primary broad working-age reference ceiling for a non-student hypothesis | “Alone” is not student status, employment status, or WG intent; the table distinguishes people without a partner from people in one-person households. Apply any non-student filter only with local evidence. | [Destatis: Alone by age and sex](https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Haushalte-Familien/Tabellen/4-1-alleinstehende.html), page status 13 April 2026 |
| People living alone, ages 65–85 and 85+, 2025 | 4.842 million and 1.485 million respectively; 6.327 million combined | Separate older-adult pilot ceiling | This is a demographic reference only. It does not establish demand for intergenerational or senior WGs, care compatibility, or safeguarding suitability. | Same Destatis alone-by-age table, page status 13 April 2026 |
| Apartments in the housing stock, end 2025 | 43.9516 million (reported as 44.0 million in the press release) | Housing-stock context | Stock is theoretical availability, not vacancy, affordability, room availability, or WG suitability. The housing-stock continuation uses the 2022 Census and differs methodologically from the Microcensus housing add-on. | [Destatis: Housing stock table](https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Wohnen/Tabellen/liste-wohnungsbestand.html), current through 2025; and [Destatis press release](https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/07/PD26_250_31231.html?nn=206104), 16 July 2026 |
| Apartments in multi-family buildings, end 2025 | 23.6 million; 54.9% of residential-building stock | Physical supply context for shared housing | A multi-family apartment is not necessarily shareable, available, or legally sublettable. | [Destatis housing-stock press release](https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/07/PD26_250_31231.html?nn=206104), 16 July 2026 |
| People in overcrowded housing, 2025 | 11.7% overall; 16.9% in cities; 9.6% in suburbs/small cities; 5.5% rural | Need/pressure sensitivity flag | EU-SILC overcrowding is a rooms-based statistical definition, not WG demand. For a one-person household, the threshold is fewer than two rooms. | [Destatis: Overcrowded housing, 2025](https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/05/PD26_N030_63.html), 11 May 2026 |
| Housing-cost overburden, 2025 | 11.2% of the population; 35.0% of people at risk of poverty | Affordability-pressure sensitivity flag | Overburden means housing costs above 40% of disposable income; this includes renters and owners and is not a lead or conversion probability. EU-SILC/Microcensus methodology creates breaks in some historical comparisons. | [Destatis: Housing-cost share and overburden](https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Wohnen/Tabellen/eurostat-anteil-ueberbelastung-wohnkosten-mz-silc.html), current table status 9 April 2026 |
| Existing net cold rent, 2022 | One-person households €7.53/m² vs. households with 2+ persons €7.09/m² | Structural affordability context | Zensus existing-contract rents include old contracts; they are not current asking rents, WG-room prices, or acquisition costs. | [Destatis: Zensus 2022 rent comparison](https://www.destatis.de/DE/Presse/Pressemitteilungen/2025/04/PD25_N016_12.html), 9 April 2025 |

### The official WG measurement caveat

Destatis explicitly says that people in a WG who manage separately are counted as separate households: [Destatis household/family methodology page](https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Haushalte-Familien/_inhalt.html), current page checked 3 September 2026. The survey participation guidance makes the same point: [Destatis survey guidance](https://erhebungsportal.estatistik.de/Erhebungsportal/informationen/teilnahme-so-gehts-3600), current page checked 3 September 2026.

This means the 17.327 million one-person-household figure can include people in independently managed WGs, while a group that economically manages together may be counted as one multi-person household. “One-person household,” “3+ adults without children,” and “WG member” must not be treated as interchangeable model fields.

Destatis’ 2025 Microcensus began as a 1% representative annual survey of private households and communal accommodation, including housing topics: [Mikrozensus 2026 started](https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/01/PD26_029_122.html), 26 January 2026. This is a methodology/source refresh, not a 2026 WG result.

## Current surveys and first-party market signals

These sources are primary reports from the commissioning platform, company, or survey publisher. They are useful directional evidence, not official WG prevalence or validated acquisition performance.

### Housing search channels: Bitkom, 2025

[Bitkom, “Zwischen Klick und Klingel – wie die Deutschen heute ein neues Zuhause suchen”](https://www.bitkom.org/Presse/Presseinformation/Zwischen-Klick-und-Klingel-neues-Zuhause-suchen), published 31 October 2025.

- Telephone survey of 1,003 people aged 16+; 402 had searched for a house or apartment during the preceding five years; fieldwork calendar weeks 33–38 of 2025.
- Among those searchers, reported channel use was: friends/acquaintances 97%, digital channels 87%, online portals 81%, housing-company websites 19%, social-media posts 12%, newsletters 10%, cooperatives 9%, newspapers 7%, notice boards 7%, employers 5%, and AI chatbots 2%.
- **Caveats:** five-year recall; “house or apartment,” not specifically a WG room or shared-living service; channel use is not reach, cost per acquisition, conversion, retention, or causal lift. The percentages can overlap.
- **Simulation use:** rank organic/referral and portal-adjacent experiments ahead of social or AI experiments; do not use these percentages as funnel multipliers.

### Young-professional/relocation signal: HousingAnywhere, 2025

[HousingAnywhere, “Umfrage unter jungen Wohngemeinschaften: Die Hälfte möchte lieber alleine wohnen”](https://housinganywhere.com/de/wohnungsgemeinschaften-in-europa), published 30 July 2025.

- June 2025 survey of 3,190 platform users aged 18–34; 63% already had housing and 37% were searching; more than 450 respondents were interested in Germany.
- In the Germany subset, 47.5% reported living in a WG and, among those, 55.8% preferred living alone. The age-band results range from 39% to roughly 52% reporting a WG and from 52.4% to 61.3% preferring to live alone.
- **Caveats:** self-selected platform users; age 18–34; platform audience includes students and young professionals; the Germany subset is not a population-representative sample; “where they search/most recently rented” is not necessarily residence; the report does not measure German WG prevalence or product conversion.
- **Simulation use:** directional prior for younger movers, relocation friction, and dissatisfaction with current WG arrangements only. Do not use it to size the entire German market or to infer older-adult demand.

### Affordability and housing sentiment: Ipsos, 2025

[Ipsos Housing Monitor 2025](https://www.ipsos.com/de-de/zu-wenig-bezahlbarer-wohnraum-und-kaum-chancen-auf-eigentum-so-beurteilen-die-deutschen), published 3 March 2025; fieldwork 22 November–6 December 2024.

- Global Advisor online survey of 22,279 people in 30 countries, including about 1,000 people in Germany aged 16–74; the Germany sample was weighted to its demographic profile and is described as representative for the studied age group.
- In Germany, 65% named high rents as the greatest housing challenge; 15% said there were enough affordable units in their region; 81% did not expect enough affordable housing in coming years; 75% of under-35s said housing would be harder for them than for their parents.
- **Caveats:** perceptions and expectations, not observed WG demand, willingness to share, or acquisition performance; online sample; Germany sample is about 1,000 and excludes people outside the studied age range.
- **Simulation use:** affordability is a pressure variable or scenario label, never a direct audience multiplier.

### Rental-market pressure: ImmoScout24, Q4 2025

[ImmoScout24 WohnBarometer, “Mietnachfrage geht zurück”](https://www.immobilienscout24.de/unternehmen/news-medien/news/default-title/mietnachfrage-geht-zurueck/), published 9 January 2026; Q4 2025 data.

- Rental-apartment demand contacts fell quarter over quarter by 16% in metropolitan areas, 23% in city districts, 17% in metro surroundings, and 20% in rural areas; year over year they fell 14%, 12%, 12%, and 10% respectively, while remaining above Q4 2019.
- Contacts from households with net income up to €2,000 fell 7% year over year; the €2,001–4,000 group fell 2%; higher-income contacts rose by up to 6%.
- Germany-wide asking rents were €8.89/m² for existing stock and €13.11/m² for new-build stock; both were up 3.7% year over year.
- **Caveats:** more than 8.5 million ImmoScout24 listings over five years and machine-learning reference objects; asking prices and portal contacts, not completed transactions, WG-room prices, or unique people. Portal composition and demand are platform-specific.
- **Simulation use:** use geography, price pressure, and demand direction as sensitivity flags; do not treat portal contacts as qualified leads.

## Platform and legal constraints for low-cost acquisition

This is an operational research guardrail, not legal advice. The law and platform terms can change; a real campaign should receive current legal review.

| Surface / rule | Current constraint | Bounded acquisition implication | Source and date |
|---|---|---|---|
| WG-Gesucht | AGB page says status October 2025. Noncommercial/private use is free for registration and two listings; a third active offer makes a private account professional. Professional/commercial users, including co-living, property-management, commercial furnished housing, companies, brokers, and platforms, are paid users. | Do not assume a free account is a scalable commercial acquisition channel. If using the platform, keep activity human-operated, authorized, truthful, and within the applicable account type; model any paid placement as a separate costed scenario. | [WG-Gesucht AGB](https://www.wg-gesucht.de/agb.html), status October 2025; checked 3 September 2026 |
| WG-Gesucht content/data | AGB prohibit brokerage-fee listings and direct/indirect promotion of other products/services; portal data may not be used for mass email/spam; impairing actions are prohibited; reproducing offers requires prior consent. | No scraping, copying listings, contact harvesting, bulk messages, or automated growth loop. A listing should be a manually authorized experiment with a capped number of posts and a measured landing-page handoff. | [WG-Gesucht AGB](https://www.wg-gesucht.de/agb.html), status October 2025; checked 3 September 2026 |
| Kleinanzeigen | Terms permit at most one private and one commercial/freelance account. Content must be truthful and in the proper category; business-like use has provider-identification/legal-information duties. | Use a commercial profile and proper legal information when applicable; do not create account farms or disguise commercial acquisition as private activity. | [Kleinanzeigen Nutzungsbedingungen](https://themen.kleinanzeigen.de/nutzungsbedingungen/?locale=de-DE), current page checked 3 September 2026; version date not shown on the rendered page |
| Kleinanzeigen automation/data | Terms prohibit unsolicited email/SMS advertising and chain letters, copying/redistributing ads without consent, crawlers/spiders/scrapers or automated access without written consent, collecting/using user email addresses or phone numbers without prior consent, access-control circumvention, and excessive load. | Baseline must be manual and low-volume. No scraping, contact-list construction, automated messaging, or cross-post copying. | [Kleinanzeigen Nutzungsbedingungen](https://themen.kleinanzeigen.de/nutzungsbedingungen/?locale=de-DE), current page checked 3 September 2026; [Kleinanzeigen privacy policy](https://themen.kleinanzeigen.de/datenschutzerklaerung/), current page checked 3 September 2026 |
| Reddit | Reddit’s Data API terms require an appropriate agreement for commercial use or research beyond permitted access/rate limits; prohibited conduct includes excessive/abusive use, spam, harassment, and unapproved selling or revenue derivation. The User Agreement prohibits unauthorized data collection/scraping. | Treat Reddit as a community channel only with human participation and community-rule compliance. No scraping or automated lead extraction in the low-cost baseline; API use requires a separately verified permission path. | [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms), last revised 20 July 2026; [Reddit User Agreement](https://redditinc.com/policies/user-agreement), current page checked 3 September 2026 |
| Unsolicited electronic advertising | UWG §7 prohibits unreasonable nuisance. Consumer phone advertising requires prior express consent; electronic advertising such as email/messages and automated calls generally requires prior express consent, with narrow existing-customer conditions. Messages must identify the sender and provide a valid opt-out address. | Exclude cold email/SMS/automated DMs from the baseline. Use explicit opt-in, clear sender identity, and an auditable opt-out for any consent-based communication. | [UWG §7](https://www.gesetze-im-internet.de/uwg_2004/__7.html), consolidated text checked 3 September 2026 |
| Personal-data reuse and direct marketing | GDPR Art. 5 requires lawfulness/transparency, purpose limitation, data minimization, and storage limitation; Art. 6 requires a legal basis; Art. 14 adds information duties when data was not collected from the person; Art. 21 requires stopping direct marketing after objection. | Do not build a WG lead list from platform profiles or public contact details. Collect only data needed for an opted-in handoff, document purpose and legal basis, and stop on objection. | [GDPR, Arts. 5, 6, 14, 21](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=de), consolidated EU text checked 3 September 2026 |
| Protected attributes and housing selection | AGG §19 addresses discrimination in mass transactions and housing, with exceptions for socially stable residential structures and close/trust relationships. The applicability of an individual WG/roommate selection is fact-specific. | Do not target or rank acquisition/matching on protected or sensitive attributes. Get legal review before applying demographic eligibility rules or housing-selection logic. | [AGG §19](https://www.gesetze-im-internet.de/agg/__19.html), consolidated text checked 3 September 2026 |
| Tenant subletting / supply eligibility | BGB §553 gives a tenant with a legitimate interest a possible claim to permission to let part of a dwelling to a third party, subject to exceptions such as important reason, overcrowding, or unreasonable burden; a reasonable rent increase may be possible. | Add a landlord-permission/eligible-supply gate. Do not count every tenant or every spare room as legally available WG supply. | [BGB §553](https://www.gesetze-im-internet.juris.de/bgb/__553.html), consolidated text checked 3 September 2026 |
| Paid platform advertising | DSA Art. 26 requires platforms displaying ads to identify the ad, advertiser or beneficiary, payer where different, and the main targeting parameters; profiling ads using special-category data is prohibited. | Keep paid ads out of the baseline. If later tested, require explicit advertiser identity, targeting documentation, consent/data-protection review, and a separate approved budget. | [Digital Services Act, Art. 26](https://eur-lex.europa.eu/eli/reg/2022/2065/oj?eliuri=eli%3Areg%3A2022%3A2065%3Aoj&locale=de), consolidated EU text checked 3 September 2026 |

## Recommended bounded simulation inputs

### Use as observed anchors, not demand estimates

The following values can be loaded as dated external anchors:

```yaml
market:
  geography: DE
  snapshot_date: 2026-09-03
  reference_year: 2025
  population_total: 83467117
  population_age_20_40: 20175298
  private_main_residence_households: 41126000
  one_person_households: 17327000
  one_person_household_share: 0.421
  alone_age_25_45: 4903000
  alone_age_65_85: 4842000
  alone_age_85_plus: 1485000
  housing_stock_apartments: 43951600

signals:
  bitkom_channel_use:
    friends_or_acquaintances: 0.97
    digital_channels: 0.87
    online_portals: 0.81
    social_posts: 0.12
    newsletters: 0.10
    employers: 0.05
  housinganywhere_platform_18_34:
    wg_share_in_germany_subset: 0.475
    prefer_alone_given_wg: 0.558
  immoscout24_q4_2025:
    existing_stock_asking_rent_eur_per_m2: 8.89
    new_build_asking_rent_eur_per_m2: 13.11
```

The anchors have different populations, definitions, and dates. Keep their provenance as metadata in the simulator; never blend them into one “WG conversion” number.

### Use only as explicit, replaceable hypotheses

| Model input | Starting bound | Why this is bounded | Replacement rule |
|---|---:|---|---|
| Young non-student mover/WG-fit rate applied to the 25–45-alone ceiling | 0.5%–5.0% | A deliberately wide scenario assumption; no cited source measures WG intent for this exact cohort. | Replace with ManaWG opt-in, qualified-lead, and activation evidence after a small pilot. |
| Older shared-living fit rate applied to the 65+ alone ceiling | 0.1%–1.0% | Product-market fit for older-adult shared living is especially unvalidated by the sources above. | Keep as a separate pilot; replace only with observed demand and safeguarding review. |
| Lead-to-activation, 30-day retention, referral rate, and host-eligibility rate | **Unknown; do not import an external prior** | The available sources do not measure this product funnel. | Initialize from local, consented first-party pilot data; if the simulator requires a default, fail closed at zero rather than presenting an invented forecast. |
| Acquisition channel mix | Organic/referral first; human partnerships second; paid disabled | Bitkom supports channel ranking, not performance. Platform terms and law constrain automation/data reuse. | Promote a channel only after an instrumented, compliant test produces local cost and activation evidence. |
| Baseline time horizon | 90 days; one city or tightly bounded cohort | Limits extrapolation while product fit and supply eligibility are unknown. | Treat 1-year/3-year outputs as sensitivity scenarios, never as a sourced forecast. |
| Baseline media spend | €0 paid media; track operator time separately | Consistent with a low-cost, owned/referral test and avoids unapproved advertising spend. | Add paid scenarios only after explicit budget, platform, DSA, UWG, GDPR, and targeting review. |

### Do not model these shortcuts

- Do not calculate WG TAM as `17.327 million one-person households × 47.5%`. Those figures come from different definitions and samples; the HousingAnywhere number is a self-selected 18–34 platform subset.
- Do not equate `3+ adults without children` in EU-SILC with WGs. It includes any economically shared household arrangement, not necessarily a WG.
- Do not use one-person share, overcrowding, poverty risk, foreign-nationality status, or age as a conversion probability or as an unrestricted targeting rule.
- Do not infer that a spare room is legally available without the relevant landlord/subletting check.
- Do not use portal reach, search contacts, or reported channel use as unique people, qualified leads, CAC, or retention.

## Recommendation

Use a 90-day Germany simulation with two explicit cohorts: **working-age movers, with non-student status treated as a local filter (25–45 alone ceiling)** and a separately labelled **older shared-living pilot (65+ alone)**. Use the official figures only to cap the cohort, start with the fit-rate bounds above as clearly marked hypotheses, and leave funnel rates unknown until first-party pilot evidence exists.

For low-cost acquisition, prioritize an owned referral loop and human partnerships (for example, employers, housing cooperatives, relocation/community organizations, or other organizations with a legitimate audience relationship). This recommendation is an inference from Bitkom’s high friend/acquaintance and portal usage plus the platform/legal constraints; it is not a claim that any partner or channel has been contacted. Exclude scraping, copied listings, contact harvesting, bulk/cold messaging, automated DMs, and paid acquisition from the baseline.

## Source register and freshness

- Official statistics and methods: Destatis pages linked above; relevant pages report 2025 data with page statuses in April–July 2026. Access/snapshot date for this note: **3 September 2026**.
- First-party survey/market reports: Bitkom (31 October 2025), HousingAnywhere (30 July 2025), Ipsos (3 March 2025; fieldwork November–December 2024), and ImmoScout24 (9 January 2026; Q4 2025 data).
- Platform terms: WG-Gesucht status October 2025; Reddit Data API terms last revised 20 July 2026; Kleinanzeigen rendered page did not show a version date. All checked **3 September 2026**.
- Legal texts: consolidated EU/German law pages checked **3 September 2026**. This note is not legal advice and does not establish whether a particular future campaign, matching rule, listing, or message is lawful.
