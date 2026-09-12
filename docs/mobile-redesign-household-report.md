# Household source handoff

Status: Household source slice complete at the requested finalization boundary. Existing OpenCode changes are preserved. No verification gate has run in this wave.

## Source changed in this resumed run

- `apps/web/src/app/wg/[code]/einkauf/page.tsx`
- `apps/web/src/app/wg/[code]/putzen/page.tsx`
- `apps/web/src/app/wg/[code]/vorraete/page.tsx`
- `apps/web/src/features/shopping/components/ShoppingItemRow.tsx`
- `apps/web/src/features/inventory/components/InventoryList.tsx`
- `apps/web/src/features/inventory/components/InventoryItemRow.tsx`
- `apps/web/src/features/inventory/components/InventoryAddModal.tsx`
- `apps/web/src/features/inventory/components/QuickRestockSheet.tsx`
- `apps/web/src/features/chores/components/ChoreForm.tsx`
- `apps/web/src/features/chores/components/ChoreRow.tsx`
- `apps/web/src/features/chores/components/AbsencePanel.tsx`
- `apps/web/src/features/chores/components/FairnessPanel.tsx`
- `apps/web/src/features/chores/components/HealthStrip.tsx`
- `apps/web/src/features/events/components/CalendarMonth.tsx`
- `apps/web/src/features/events/components/CalendarUpcomingList.tsx`
- `apps/web/src/features/events/components/EventFormFields.tsx`
- `apps/web/src/features/events/components/EventCreateModal.tsx`
- `apps/web/src/features/events/components/EventEditModal.tsx`
- `apps/web/src/app/wg/[code]/kalender/page.tsx`

Existing OpenCode changes to shopping/chores `ListSkeleton.tsx` and `PutzenHeader.tsx` remain in place; they were not rewritten in this resumed run. Existing route error boundaries still delegate to Foundation's shared boundary.

## Implemented presentation and parity

- Shopping: compact labeled name/quantity entry; mounted real Animate UI checkbox with an expanded touch area; chronological row order independent of completion status; actual creator/buyer labels, including absent buyer handling; owner-only individual delete entry point; explicit bulk-delete confirmation; one-item `ausgaben?desc=...` handoff in the item drawer. Existing request, offline queue, draft, error and prefill handling stays connected. The expense link performs no financial write.
- Inventory: visible add and restock actions instead of floating controls; grouped stock list, quantity controls with room for names, low-stock shopping-list link, retained consume/increment/delete handlers; actual Drawer editor and restock sheet; explicit discard choice for unsaved inventory edits; existing quantity/unit/category/threshold limits. The server's consume-to-shopping behavior is unchanged.
- Chores: completed the page's partial migration to Item/Empty/Alert and connected the Drawer form; retained title prefill, highlights, absence links, recurrence choices, active-member selection, assignments, takeover, swap request and deletion handlers. Completion uses an AlertDialog before the existing write; the confirmation window is 60 seconds. The UI now reads next due date and assignee from the existing completion response instead of constructing a temporary approximation. No rotation or recurrence helper changed.
- Absences/fairness: visible field labels, existing date conversion and save/remove flows, restored-input/deep-link expansion, actual Animate UI collapsible presentation, actual counts/member scores and a clearly labeled next-assignee suggestion. The fairness/domain algorithms are unchanged.
- Calendar components: retained existing calendar date construction and keyboard controller; replaced date cells and selected-day event actions with Button/Card/Item. Agenda merges existing event and chore occurrences chronologically; existing time formatter, ICS download, recurrence badge, event edit and chore deep links remain. No Calendar dependency or misleading shadcn Calendar wrapper was added.
- CalendarMonth parse repair: removed the abandoned legacy `days.map` render block that preceded the retained Card/grid return, leaving one complete render tree.
- Event editors: actual Drawer/Field/Input/NativeSelect/Checkbox/Textarea controls; retained create templates, recurrence choices, raw existing recurrence editing, API payloads and local-to-ISO conversion. Create keeps its in-memory draft when closed; edit asks before discarding changes; series deletion keeps an explicit confirmation. Date input rendering now handles all-day end dates in the same local format as start dates.
- Calendar route: visible page now uses semantic shadcn Card/Field/Input/Button/Alert/Badge/Tabs primitives, keeps the existing agenda/month state and date/keyboard controller, adds Household local navigation, returns to Household through the Einkauf context, preserves calendar feed creation/copy/open/rotate/revoke instructions and confirmations, and passes the existing `actionError` into the edit drawer.

## Concrete work still open

1. Run the deferred integration verification after all owners finish. Source edits alone are not evidence of a passing typecheck, accessible focus restoration, keyboard safety, motion behavior or feature parity.

## Unchanged supported capability boundaries

- Shopping's current item PATCH supports bought/unbought only. Editing an existing item's name or quantity was not supported and no backend mutation was invented. Editable shopping create/offline drafts remain connected.
- The previous chore UI did not provide general title/quantity editing; the existing API has schedule/assignee fields but no title update. This migration preserves its existing controls rather than adding new writes or claiming an unsupported editor.
- Inventory and calendar retain their existing network-only mutation behavior. This work does not introduce a new offline protocol for them.
- The existing chore create/offline draft pipeline does not carry `recurrenceType` through every stored draft/queued-create path. This pre-existing domain/queue limitation was not changed by the presentation migration and needs separate ownership if it is to be addressed.

## Dependencies and verification

Uses the installed Base Nova/Neutral components, Inter theme, Lucide icons and Animate UI primitives described in `docs/mobile-redesign-components.md`. The shadcn skill guided component composition and semantic tokens. No shared UI, global CSS, dependencies, API/domain helpers or stored data formats were edited.

Focused verification run: `pnpm exec biome check` over the 30 Household route/component files passes with no diagnostics. Biome's formatter was also run with `--write` only over the same Household scope. pnpm emitted the existing warning that the `pnpm` field in `package.json` no longer reads `pnpm.overrides`; no shared config was changed.

NOT run: tests, typecheck, build, browser, graph updates, commits, push or deployment. No commands remain running. No new agents or paid OpenCode sessions were started.
