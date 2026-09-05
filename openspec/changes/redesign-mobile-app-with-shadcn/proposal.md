## Why

The user wants ManaWG rebuilt as a coherent phone-only experience using actual shadcn/ui components and Animate UI. Previous proposals incorrectly treated the existing colors, dashboard and five-tab layout as design requirements; this redesign starts from an official shadcn preset and derives the mobile composition from residents' tasks.

The user defines the primary audience as adolescents with routine smartphone/app experience. Design for familiar mobile interactions, quick first and repeat use, and balanced information density. Users still need the facts required for a WG or financial decision, but ordinary phone interactions do not need introductory explanations.

## What Changes

- Replace the app's presentation system with an official, reproducible shadcn preset, including typography, semantic theme tokens, component variants and light/dark states. Proposed reference: Nova, Neutral, Inter, Lucide, default radius.
- Recompose every app surface for phones: public entry, authentication, create/join, home, household work, finances, communication, calendar, search, activity and settings.
- Implement the four destinations (`Start`, `Haushalt`, `Finanzen`, `Austausch`) whose organization the user approved after the image preview. Verify their actual phone behavior with Luna browser reviewers. Real-user validation remains a later product activity, not a claim implied by this approval.
- Define the essential context, primary action and secondary detail for each screen; retain decision-critical facts, recognizable labels and stable control positions. Test first use, interrupted work, failure recovery and return use with young, smartphone-experienced users from the target audience.
- Add real Animate UI components for state feedback and progressive disclosure, sharing the chosen primitive base and shadcn theme. Respect reduced-motion preferences.
- Preserve existing capabilities, accounts, WG membership, financial meaning, permissions, drafts, deep links and integration contracts while changing the visible organization.
- Deliver one representative mobile flow for joint visual review, then migrate complete feature slices with focused Playwright checks. Remove obsolete presentation rules after their consumers are migrated.

## Capabilities

### New Capabilities

- `mobile-app-experience`: A complete phone-only shadcn interface with task-oriented navigation, consistent interaction surfaces, truthful state feedback, functional coverage and accessible animation.

### Modified Capabilities

None. No canonical specifications currently exist under `openspec/specs/`; existing change-local auth and release work retains ownership of its business contracts.

## Impact

- App only: `apps/web/src/app`, shared theme/layout, `components`, feature presentation components, `apps/web/e2e`, UI dependency/configuration files and the lockfile.
- Coordinate the Tailwind 3-to-4 presentation migration with existing React 19/Next.js 15, preserving the project's Node 22/pnpm 9 toolchain. Verify browser requirements before changing compatibility.
- Existing API and domain logic are reused; no database migration or payment-provider change is proposed.
- The existing UX draft remains useful for feature and data-safety requirements. Its requirements to retain the old palette and five primary tabs are superseded for this redesign by the user's explicit direction.

## Non-goals

Marketing-site work, a separate desktop/tablet layout, feature deletion, a native Swift/Kotlin rewrite, new integrations, extra AI features, unrequested backend refactors, production writes and deployment are outside this proposal.

## Planning status

Implementation authorized on 2026-09-05. The user approved the image's organization and the plan while requiring original GitHub component styling. Implementation comes first, then Luna browser review and final technical verification, followed by a new GitHub branch push for the user's next-day review. No deployment/merge or human usability evidence is implied. Execution ownership and controlling clarifications are in `docs/mobile-redesign-orchestration.md`.

## Authorized public-entry follow-up — 2026-09-05

The first implementation slice is limited to the public entry, discovery previews and authentication presentation. It keeps the existing membership lookup, invitation propagation, account choices, recovery and privacy link contracts, while replacing public empty states with explicitly fictional, read-only module examples. Its former public-only petrol styling is superseded by the user's correction: the installed Base Nova / Neutral / Inter / Lucide components and semantic tokens are authoritative, with a documented Motion transition. Connected Chrome review and final controller acceptance remain pending; no browser or hosted-service result is claimed here.
