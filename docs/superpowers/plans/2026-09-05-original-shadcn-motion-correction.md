# Restore original shadcn styling and use Motion

**Goal:** Correct the public entry/auth slice to the original installed shadcn Base Nova / Neutral / Inter / Lucide design and use documented Motion/Animate UI behavior. The user explicitly rejected the custom petrol theme and authorized this correction.

**Scope:** Correct the presentation added in `a364104`; preserve useful compact public content, fictional previews, all route/auth/membership/invitation contracts and the phone layout. No further product redesign, feature invention, palette choice, dependency upgrade, merge, push or deployment.

**Authority:** Original shadcn components and the selected preset define colors, typography and component shapes. `className` is for layout and necessary accessibility only. The previous public-only petrol exception in the earlier plan and OpenSpec is revoked by the user; mark it superseded in those documents rather than treating it as current policy.

## Implementation and acceptance

- [x] Read the installed `shadcn`, `frontend-ui-registries`, and `motion` skills; inspect installed components and official documentation. Prefer the existing pinned CLI/package version for inspection; registry/source queries are read-only before changes.
- [x] Remove every public-accent variable, hardcoded color, logo recoloring, custom navigation color override, custom card ring/background/shadow/radius treatment, fabricated checkbox/avatar styling and bespoke typography introduced by the public-entry follow-up. Delete `public-entry.css` if only its responsive layout remains and express that layout with existing Tailwind classes. Do not alter the underlying shadcn tokens or shared original component source.
- [x] Compose original Card/Header/Title/Description/Content, Item/ItemGroup/ItemMedia, Badge, Avatar, Button and other already-installed primitives as appropriate. Use native variants. Keep short example labels/content readable at320px; preserve the static fictional examples and real navigation. No fake write actions.
- [x] Add actual Motion behavior from documented original patterns: a simple route-content opacity transition using existing `motion/react`, with no invented springs/staggers/visual effects, and original Animate UI interaction where it naturally replaces an existing interaction (prefer an official Base UI animated Tabs component for the existing auth tabs if compatible, or reuse an existing appropriate primitive). Do not add an interaction solely to showcase animation. Do not claim a dependency import is an animation. Reduced-motion users get immediate content/state updates, no hidden content or motion delays.
- [x] Read callers before shared changes, keep the bottom navigation stable and links usable during transitions. Preserve mounted auth form state across ordinary rerenders. No auth/backend edits or live account actions.
- [x] Update the focused public-entry regression expectations where needed, including no custom accent leakage and reduced-motion rendering. Use existing tests; no extra framework. Browser execution only through connected Chrome Extension by controller, no Playwright browser launches.
- [x] Run Node22 lint, typecheck, isolated production build, unchanged bundle checker against that build, and OpenSpec validation. Avoid the active localhost3101 dev build; clean only generated artifacts from your checks. Report exact results and update documents to restore original preset as authority.
- [x] Independent read-only review must explicitly compare the result against original component composition and reject custom visual overrides. Controller checks mobile320/390/430, light/dark, actual animation and reduced motion, invitation links, auth controls and final neutral appearance. Graphify refresh after source changes. No completion claim before verification.

**Ownership:** Bruna owns implementation/test/OpenSpec corrections and local code commit. Controller owns planning, browser acceptance and review. No implementation subdelegation.


## Accepted implementation and evidence

Code commits: `2f69cf7` restores original composition, `066199b` adds auth-panel Motion and removes explicit logo colors, `a2f981c` shortens two fictional notice-title literals. The previous petrol exception is revoked. No dependencies, original shadcn component source, global preset tokens, private WG UI, or backend/auth logic were changed. A diff of `src/components/ui` and `src/shared/globals.css` against original baseline `a8016bc` is empty.

Original Card/Item/Badge/Avatar/Button variants supply appearance. Responsive grouping, minimum touch areas and text wrapping are layout/accessibility adjustments. The existing Base UI TabsContent uses its supported `render` prop with `motion.div`; no new Tabs library or interaction was introduced. Existing Animate UI components remain in place. Motion uses its standard opacity pattern without custom transition curves.

Sources consulted: [shadcn Card](https://ui.shadcn.com/docs/components/base/card), [Item](https://ui.shadcn.com/docs/components/base/item), [Tabs](https://ui.shadcn.com/docs/components/base/tabs), [Motion animation](https://motion.dev/docs/react-animation), [useReducedMotion](https://motion.dev/docs/react-use-reduced-motion), and [Animate UI Base Tabs](https://animate-ui.com/docs/components/base/tabs). CLI inspection confirmed Base Nova/Neutral/Lucide; RootLayout's explicit Inter configuration was retained instead of applying the CLI's unresolved font fallback.

### Connected-Chrome acceptance

- Normal public navigation produced observed opacity samples `0`, `0.294753`, `0.456486`, through `0.838114`, then `1`. Reduced-motion navigation yielded `1` in every sampled state.
- Normal email-to-SMS transition produced observed panel opacity `0.957811` through `1`. With reduced motion configured before client navigation into auth, all eight SMS-panel samples were `1`.
- A synthetic email remained visibly present after email → SMS → email. No auth or SMS request was submitted; the test text was cleared and the preview returned to public entry.
- Root and all eleven discover pages were checked at 320px and 430px: no horizontal overflow or measured Item text clipping. The intended dark theme was rechecked after initialization wherever a hydration race initially showed light. All twelve 320px dark and twelve 430px light states then passed. Final 390px screenshots confirmed original neutral surfaces and readable notice copy after the two-literal shortening.
- Invitation `ABCD2345` survived public entry → Haushalt → join into `/neu?code=ABCD2345`; the preview return link also retained the code.
- Product-source searches for public-accent variables, the removed CSS import, and bespoke consumer card/typography overrides return no matches.
- Independent gpt-5.6-terra xhigh review passed after removal of the two explicit LogoMark color props; scoped auth-render review and final copy-only review also passed. Bruna implementation used gpt-5.6-luna xhigh.

### Technical checks and limits

Node22 root/web lint, feature boundaries, typecheck, analytics, OpenSpec and isolated production build passed after the auth/logo correction. The unchanged bundle checker passed against that isolated build: shared gzip 101.5 kB / 120 kB; all route budgets passed. The final two-literal copy fix passed focused Biome and diff checks; no redundant full build was run for those literals. Focused Playwright files were updated/reviewed but no Playwright browser runner was launched; browser verification used only the connected Chrome Extension.

Company and worktree Graphify graphs were refreshed. Optional SQL-parser warnings and the unrelated social-auth checkout parse warning were not repaired. The existing local `/api/wg/mine` 500 remains visible and outside this presentation correction. Successful real account access or hosted authentication is not claimed. No merge, push or deployment was performed.
