# Correct the bottom navigation and remove interior glass

**Goal:** Apply the user's six screenshots literally: original shadcn inside the app, Liquid Glass only on the bottom main navigation, a correctly inset rounded active selection, and no unnecessary account-load error for an anonymous visitor.

**Authority:** The user corrected the earlier broad glass scope. The earlier header, section-nav, CTA, auth-tab and dropdown glass adoption is superseded. Do not redesign the homescreen, change palettes, remove existing features, or hide actual authenticated failures in this correction.

## Implementation

- [x] Remove LiquidGlassSurface from PublicApp header, EntryFrame header, WgAppHeader toolbar, SubNav, WgWelcome CTA, CredentialsAuth TabsList and dropdown-menu popup. Restore the respective original component variants/surface classes from before the glass adoption (`171581b`) while preserving subsequent unrelated fixes, Motion and privacy-link removal.
- [x] Keep the material adapter and its accessibility fallbacks only on public/private bottom main navigation. Add 4px inner padding to the link row, keep the shared NavItem on the original `rounded-lg` Base Nova radius, and set the upstream Glass `radius` to the existing `--radius-xl` token equivalent so the selected segment sits inside the outer surface without a new pill shape. Keep 56px minimum link height, four destinations, icons, labels, active-prefix logic, minimum 8px bottom clearance, 480px app frame and safe-area behavior. Reserve 4.5rem plus the safe-area inset so controls do not overlap the final content.
- [x] Diagnose anonymous membership lookup before editing its logic. Apply the audited shared request guard in `getAuthenticatedUser()`: only an `Authorization` header or an exact Supabase auth-token base/chunk cookie invokes SDK validation; no credential returns the existing signed-out response. Cookie presence is only a hint, and authenticated attempts retain the existing validation/error path.
- [x] Update narrowly affected existing regression tests. Public and auth shell counts now cover bottom-only material; the unskipped request-only API test proves anonymous and PKCE-only requests return exact 401 JSON. Its auth-cookie/Bearer 500 expectations are gated behind `E2E_EXPECT_MISSING_SUPABASE=true` and were run with public Supabase variables explicitly empty; no real tokens or accounts were used.
- [x] Run appropriate Node22 lint/typecheck/build, unchanged bundle gate and OpenSpec validation. The new isolated build leaves the controller's live3101 production build untouched; report the new path for preview switch. No push, deployment, schema, credential or production data changes.
- [x] Update OpenSpec/current guidance to bottom-only glass and document the guest lookup guard and its limits. Refresh Graphify after source changes. Independent review and connected-Chrome screenshot comparison remain controller-owned.

**Ownership:** Bruna (Luna/xhigh) owns all source/test/spec changes and local code commit. Guest audit agent is read-only. Controller owns plan, browser acceptance and review. Full report `/tmp/manawg-bottom-glass-correction-report.md`.
