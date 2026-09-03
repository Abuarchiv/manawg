# Growth simulation research snapshot

**Collected:** 2026-09-02
**Use:** input provenance and policy boundaries for the ManaWG simulator.

These sources constrain assumptions; they do not establish causal acquisition,
conversion, retention, or revenue forecasts. Cross-period arithmetic is marked
as a scenario, not observed TAM.

| Area | Evidence and implementation consequence | Source |
| --- | --- | --- |
| Germany student population | Destatis reports 2,876,900 students for winter semester 2025/26. | https://www.destatis.de/DE/Presse/Pressemitteilungen/2025/11/PD25_426_21.html |
| WG prevalence | The official Social Survey reports 27.9% living in WGs for its survey period. Combining this with the newer student count is only a stale, cross-period scenario. | https://www.studierendenwerke.de/fileadmin/user_upload/SE22_Hauptbericht_barrierefrei.pdf |
| Public refresh | Destatis provides free GENESIS REST/JSON and CSV access suitable for dated snapshots. | https://www.destatis.de/EN/Service/OpenData/api-webservice.html |
| First-party SEO | Search Console exposes authorized search analytics; Trends API access is limited alpha. Do not treat either as universal demand. | https://developers.google.com/webmaster-tools/v1/searchanalytics/query ; https://developers.google.com/search/apis/trends |
| Reddit | Free API access is rate-limited and commercial use may require an agreement; spam and scraping are prohibited. | https://redditinc.com/policies/data-api-terms |
| Instagram | Publishing and insights require authorized Professional accounts; app review and API limits apply. | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing |
| TikTok | Research Tools exclude commercial marketing use; unaudited posting is private-only and limited. | https://developers.tiktok.com/docs/en/content-sharing-guidelines |
| YouTube | Current API quotas include 10,000 units/day, with endpoint-specific costs and limits. | https://developers.google.com/youtube/v3/getting-started |
| Existing analytics | `@vercel/analytics` 2.0.1 is already installed; Hobby limits are 50,000 events/month and one-month reporting, without custom events/UTM reporting. It covers top-funnel pageviews, not activated WGs. | https://vercel.com/docs/analytics/limits-and-pricing |
| Outreach compliance | German UWG §7 generally requires prior express consent for unsolicited electronic advertising. | https://www.gesetze-im-internet.de/uwg_2004/__7.html |

## Operating boundary

The lab may model account-based or paid channels as assumptions and costs, but
it must not create accounts, scrape, automate DMs/comments/likes/follows,
bulk-post, buy ads, or contact people. A real experiment needs separate
approval, a human-owned account, platform-compliant execution, and measured
first-party outcomes.
