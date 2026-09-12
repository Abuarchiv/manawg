> Implementation authorized after the whole-app audit and the explicit Start page contract, 2026-09-05. Scope: Start only; preserve all neighboring feature workflows.

## Why

Start currently places a large balance and duplicate navigation ahead of pending work. Repeated shopping, chore and announcement sections obscure the resident's next action. The user approved the proposed Start redesign on 2026-09-05 as the first slice of the app-core redesign.

## What Changes

- Put one relevant next action and two secondary items first, with additional items accessible through the installed Animate UI Collapsible.
- Distinguish personal responsibilities from shared WG information using member IDs.
- Replace the large balance card with a compact financial status; remove module navigation, repeated task sections and the WG score from Start.
- Show a concise WG news/activity section and intentional new, quiet, loading and failed states.
- Preserve the existing four destinations and original shadcn Base Nova styling.

## Capabilities

### New Capabilities

- `start-overview`: Prioritized resident overview with compact financial and WG context.

### Modified Capabilities

None.

## Impact

WG home, dashboard insight selection and additive dashboard response metadata, dashboard fixtures and regression assertions. No schema, financial calculation, authentication, public-entry or dependency changes.
