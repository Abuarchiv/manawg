## Why

ManaWG's core household use case is established, but the interface does not yet consistently explain the next action or its consequences across account entry, expenses, shopping, chores, and settings. The user has authorized implementation of the reviewed product-experience plan with Astra for UI/UX, Luna for remaining implementation, and independent Terra review.

## What Changes

- Make first-use and returning dashboards lead to a useful contextual action.
- Clarify expense recording, manual settlement, shopping handoff, and chore completion without changing the financial model or hiding user data.
- Align account/WG wording and persistent membership leave behavior with Supabase account-backed authorization.
- Make advertised navigation and legal/support destinations truthful using approved existing content only.
- Complete safe local release workflow gating while leaving hosted credentials, human usability research, real devices, provider setup, and production operations explicitly unverified until performed.

## Capabilities

### New Capabilities

- `coherent-household-experience`: Contextual entry, clear actions and financial effects, consistent completion/recovery, and truthful account/WG semantics.

### Modified Capabilities

No archived canonical capabilities are replaced. Existing active auth, RLS, public-entry and Preview verification specifications remain binding.

## Impact

Existing Next.js components and member endpoints, Playwright scenarios, GitHub release workflows, and product/runbook documentation. No new provider, dependency, framework, database redesign, or production operation is authorized by this change.
