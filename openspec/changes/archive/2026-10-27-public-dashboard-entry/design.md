## Context

See proposal.md for motivation. `EntryClient` unconditionally redirects to `/neu`. `NeuClient` already preserves create intent and code-based invitation intent through Supabase. The private dashboard welcome card currently sits after statistics and disappears after onboarding. The current service worker caches all successful HTML navigations. The saved main checkout has unrelated uncommitted changes; implementation uses the existing clean linked worktree `/private/tmp/manawg-login-fix-2wRZO2` at b34f079.

## Goals / Non-Goals

**Goals:** Implement the approved public dashboard entry and stateful welcome block with existing components and native links. Keep authentication authoritative and public browsing free of private data.

**Non-Goals:** This entry slice does not activate new Supabase providers, migrate the eight legacy memberships, replace invitation token infrastructure, or deploy production. Those remain explicit work in the broader auth release, not claims made by this slice.

## Decisions

1. Public root plus `/entdecken/[module]` render real app navigation and honest empty states. Reuse `NavItem`, `Panel`, `ModuleCard`, theme tokens, mobile frame, and existing labels. Do not inject a fabricated WG/member into `WgContextProvider` or relax the private `/wg/` boundary. Alternatives rejected: an up-front login wall and fixture-backed fake memberships.
2. A small shared welcome component has explicit create, invitation, and member variants. Member variant receives the actual WG name. Public root loads `/api/wg/mine`; one membership opens its WG, multiple memberships are selectable, no memberships keep creation available, and request failure remains distinct from empty. Guest UI does not read browser-local identity/history.
3. Creation links to existing `/neu?action=create`. Secondary login is explicit. Existing invitation links retain their validated code and safe destination, show a public join entry first, and request authentication only after the join action. Form completion, not login, performs writes. Direct private deep links remain protected. Return links restore public browsing.
4. Public module empty states are first-class guest product views, not test mocks. Cover all current navigation sections and their child links; unsupported module names return not-found. Forms that would save WG data instead lead to the same create/join gate.
5. The service worker caches only an explicit public offline shell and static assets, never arbitrary HTML, API, auth, RSC, or account-dependent pages. Bump its own cache version to evict old cached private documents. Do not clear unrelated caches or drafts.

## Risks / Trade-offs

- Public and private presentation can drift → reuse existing small display/navigation primitives; do not duplicate private business logic.
- Login race or network error could look like no WG → explicit pending/error states and retry; no local identity fallback.
- Invite context lost during navigation → normalized code and safe relative next path survive links; test cancel/reload flows.
- New hosted verification needs deployment approval → ask asynchronously; continue source implementation, but never label untested hosted behavior released.

## Migration Plan

No database migration. Implement in the clean existing worktree, preserve main's dirty files, run source gates and Terra review, then test an authorized preview against real Supabase. Production promotion requires separate explicit authority. Reverting the code restores the former entry but does not change user data.
