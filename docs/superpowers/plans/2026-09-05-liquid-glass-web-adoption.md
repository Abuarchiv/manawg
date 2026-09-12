# Liquid Glass web adoption in the current ManaWG update

> Superseded by [the bottom-only screenshot correction](./2026-09-05-bottom-glass-screenshot-correction.md): this plan's broad header, section-navigation, CTA, auth-tab and dropdown composition is retained only in history. The current implementation keeps the adapter on the two bottom main navigations.

**Goal:** Implement an existing Liquid-Glass web material across shared ManaWG navigation and appropriate controls now, following Apple's published iOS27 design guidance while preserving the original neutral shadcn components and existing behavior.

**Authority:** The user explicitly selected "Jetzt in ManaWG einbauen" and requested readiness for "ios27/28". iOS27 is a verified Apple preview; no verified iOS28 design/API contract is available. Do not invent or claim iOS28 compatibility. The central material adapter is the update point when real guidance changes. No separate future-version infrastructure is needed.

**Architecture:** One small reusable material wrapper around existing semantic components. Use the inspected MIT `simple-liquid-glass@4.1.0` core (no runtime dependencies), not a new component library or hand-written glass renderer. Existing shadcn/BaseUI primitives keep roles, focus, labels, routing, forms, motion and neutral theme. Material appearance follows the upstream preset; no new palette, font, shader, gradient recipe or pointer effect is authored.

**Source selection:** The [upstream project](https://github.com/lucaperullo/simple-liquid-glass) and published npm tarball were inspected; the dependency is pinned exactly to `4.1.0`. Import `{ LiquidGlass }` from `simple-liquid-glass`, use static `mode="preset"`, deterministic `effectMode="blur"` and `mobileFallback="css-only"`. The upstream blur preset is intentional: it keeps server/client markup stable and gives this mobile-first update one readable web fallback across engines. Do not use `/interactive`, autoTextColor, forced descendant text colors, liquid animation, WebGL, canvas capture or pointer tracking. This is web material inspired by Apple, never native UIKit/SwiftUI Liquid Glass.

## Required scope

| Surface | Implementation |
| --- | --- |
| Public and private bottom navigation | One floating shared material surface around each existing set of four links; keep labels/order/active state and safe-area clearance. Preserve480px frame and320px fit. |
| Public/auth header controls and WG header toolbar | Group existing navigation/account/search controls in the material; page headings and explanatory content stay outside. |
| Shared local section navigation | Material grouping in `SubNav`; avoid wrapping it inside an already-glass toolbar. |
| Public create/join action | Existing real CTA can use the material with an existing original neutral Button variant; preserve its prominence, actual link and invitation code. |
| Existing email/SMS tab selector | Material on the existing TabsList/control group; preserve original panel/form state and the recently verified Motion behavior. |
| Shared dropdown/menu popup surfaces | Apply material without changing BaseUI positioning, ref, keyboard navigation, focus, scrolling or action semantics. Nested menus must not produce visually stacked glass. |
| Data and form content | Keep existing original Card/Item/Input/form/table/message surfaces. Long dialog/drawer form bodies remain readable original surfaces; do not add glass to all content cards. Existing destructive/financial controls retain their semantic cues and confirmations. |

The source of truth for the relevant files is `PublicApp.tsx`, `EntryFrame.tsx`, `WgWelcome.tsx`, `components/app/WgAppHeader.tsx`, `components/wg/SubNav.tsx`, `app/wg/[code]/layout.tsx`, `components/auth/CredentialsAuth.tsx` and `components/ui/dropdown-menu.tsx`. Inspect every caller before changing shared props. Do not refactor routing/auth/domain logic. Modify only the original wrapper composition needed for the requested material; do not replace BaseUI control implementations.

## Acceptance and constraints

- [x] Inspect the upstream package and existing source; implement the smallest material adapter and exact listed surfaces. Preserve geometry, semantic root props/ref forwarding and SSR-visible usable content.
- [x] Underlying content must be visible through enhanced glass while text/icons remain readable in light and dark. Verify library defaults rather than inventing an alternative palette. Use original semantic opaque fallback if browser support or accessibility mode cannot deliver readable material.
- [x] No nested decorative glass, duplicated shadows, fake clickable wrappers, swallowed events, focus loss, clip/scroll regressions, or hydration exceptions. Fixed navigation clears keyboard/safe areas as before; glass doesn't animate or reorder targets.
- [x] Provide an opaque semantic fallback for unsupported backdrop-filter, forced colors, prefers-contrast:more and prefers-reduced-transparency where exposed by the browser. Do not claim Safari automatically honors an unimplemented media query. Retain reduced-motion behavior; static upstream core needs no invented motion effects.
- [x] Preserve all membership/error/retry branches, invite/create/next URLs, offline/data behavior, disabled/busy auth controls and all existing permissions. Public Datenschutz links remain removed.
- [x] Add focused regression checks using existing Playwright structure for glass surface presence, links, fallback and no content-card takeover. Do not launch automated browsers: controller uses the connected Chrome Extension only. API/static checks and test listing are allowed.
- [x] Run Node22 lint, typecheck, isolated production build and unchanged bundle budget checker against that build. Keep budgets120kB shared/55kB route unchanged. Avoid active localhost3101 build; clean only own generated artifacts. No deployment, push, merge, credentials or production writes.
- [x] Update existing OpenSpec artifacts and record package provenance/browser limitations. Do not write that iOS27/28 or real Safari have been tested when they have not.
- [x] Controller: verify public routes/auth in Chrome at320/390/430 and both themes, actual glass material and fallback, content readability, focus and invitation paths; inspect private shell on isolated existing fixture mode if feasible without real accounts. Independent review of shared control changes and final graph refresh before completion.

**Ownership:** Bruna (Luna/xhigh) owns code, lockfile, focused test/spec changes and local implementation commit. Controller owns architecture, browser acceptance and review. No implementation subagents. Full report: `/tmp/manawg-liquid-glass-implementation-report.md`.


## Final implementation and acceptance — 2026-09-05

Commits: `b969562` adds the shared web material, `a9aedac` adds minimum bottom clearance, `0ac29db` constrains the adapter and restores the filled primary action. Bruna used gpt-5.6-luna xhigh. Independent gpt-5.6-terra xhigh review passed after all reported issues were addressed.

The native HTML-only adapter fixes its upstream configuration after forwarded props, bridges `LiquidGlassHandle.element` to Base UI's DOM ref, and uses the source's deterministic blur mode. The initial automatic SVG mode caused a real SSR/client hydration mismatch and was replaced. No Chromium SVG refraction path, interactive package entry, app-authored palette or iOS-version detection was added. The public primary create/join button retains its original filled variant inside the material frame.

### Controller browser evidence

Connected Chrome Extension against the final production build on localhost3101:

- Root plus all eleven public discover pages passed24 route/theme/width checks (320px dark,430px light). Material counts are3 on root/activity/settings and4 on the other module routes. No horizontal overflow, measured Item clipping or glass inside example articles. Floating navigation retains at least8px bottom clearance.
- Final390px screenshots confirm readable neutral material, preserved original content cards and a visibly dominant primary action.
- Invitation ABCD2345 survives public entry → Haushalt → join into `/neu?code=ABCD2345`; the return link retains the code. Public Datenschutz links remain absent.
- Auth shows2 intended material surfaces (header controls and tab selector). A synthetic email remained visibly present after email → SMS → email; arrow-key focus and Enter activation work through the material. Test text was cleared; no auth/SMS request was submitted.
- Increased contrast, reduced transparency and forced colors each produce a gradient-free opaque first material layer. The source's computed inline backdrop-filter can remain present behind that opaque layer; no claim is made that it is disabled or that its GPU cost was measured.
- Fresh public/auth loads of the deterministic build produced no hydration, minified React, missing-method or ref-type errors in the inspected browser logs. The earlier auto-mode error is not present in the final build.

### Gates and precise limits

Node22 lint, feature boundaries, typecheck, analytics, isolated production build and original bundle checker passed. Shared first-load gzip is101.5kB against120kB; route budgets remain55kB. Focused Playwright assertions were updated and reviewed, but the browser runner was not executed because verification is restricted to the connected Chrome Extension. Company and worktree Graphify graphs were refreshed; optional SQL-parser and unrelated social-auth parse warnings were not changed.

The old preview process disappeared during the task. The controller verified there was no listener and started its own loopback-only Next production preview from `.next-e2e-liquid-glass-final-fix`, using the existing fixture flags and empty database variables. It serves the final tested artifact at `http://localhost:3101/`; no production account/data configuration was introduced.

Private WG header/navigation/dropdown integration passed source/ref review and compilation. Direct private fixture-browser access remained blocked by the pre-existing membership-confirmation failure, so private dropdown keyboard behavior and populated WG screens are NOT claimed as live-tested. The public account lookup still returns500 because local Supabase public configuration is absent; this was not changed by the material work.

This is an Apple-inspired web glass treatment. No real iPhone/Safari test or native UIKit/SwiftUI implementation was performed, and no iOS28 compatibility is claimed. The shared adapter provides one place for future verified platform changes. No push, merge or deployment was performed.
