## Context

See [proposal.md](proposal.md) for intent and scope. On 2026-09-05 the user approved the image preview's organization and the plan for implementation, explicitly requiring original shadcn GitHub component styling rather than treating the generated image as a pixel specification. Implementation first, Luna browser/technical verification afterward, and a new-branch push are authorized. Human review and release follow later.

Observed baseline: local `main` is `2c7fc58` and nine commits behind the locally available `origin/main`. Existing uncommitted planning documents belong to ongoing work. The web app uses Next.js 15, React 19, Tailwind 3.4, Node 22 and pnpm 9. There is no app `components.json` or Animate UI integration. Global Codex skills provide instructions, not installed application components.

The feature map comes from actual routes and components. Existing presentation often shares files with fetching, mutation, offline and financial logic. The redesign must replace the presentation without casually changing those contracts. The earlier UX draft's visual and navigation restrictions do not constrain this new proposal.

The user identifies adolescents with routine smartphone/app experience as the primary audience. Design for familiar app behavior, fast access and an appropriately compact layout. Smartphone familiarity is the design starting point; first-time understanding of ManaWG's household and financial meaning still needs validation. This audience definition does not add age-gating features or change existing account/payment contracts.

## Goals / Non-Goals

**Goals:**

- An end-to-end mobile design whose component appearance is traceable to one official shadcn preset.
- A clear destination and complete redesigned flow for every existing feature, including secondary screens and uncommon states.
- Reviewable milestones: a real component prototype, a verified foundation, then complete functional slices.
- Intuitive first and repeat use by young, smartphone-experienced residents, assessed separately from visual approval and automated correctness.

**Non-Goals:**

- Reproducing the component showcase's desktop grid, creating a desktop sidebar, or changing product features to fit a template.
- A parallel backend, generic form/page generation framework, new design system library, or blanket dependency upgrades.
- Reopening accepted auth/permission decisions or treating design review as authorization to perform live account/payment operations.

## Decisions

### 1. Use one official visual baseline

Proposed preset: **Nova / Neutral / Inter / Lucide / default radius**, with the official light and dark tokens. This combination was observed in the official shadcn/create configurator during this conversation. Resolve and record its current preset with the CLI during implementation; record the CLI version and lock dependencies. Do not invent or manually decode a preset code.

Use actual registry source, native component variants and documented composition. `className` controls mobile layout and necessary hit areas; it must not recreate the former colors, typography, card treatment or shadows. Allow distinct semantic status colors where the preset supplies them; status also needs text or an icon.

Alternative considered: an individually customized shadcn-inspired theme. Rejected because the user explicitly chose the original source as the visual authority. A different official preset remains possible through the first prototype review, rather than through scattered per-component changes.

### 2. Reorganize destinations around tasks

The user selected candidate A's four persistent bottom destinations for implementation after reviewing the image. Build this coherent structure using original shadcn components. Luna agents will inspect findability and mobile behavior after implementation; this is AI-assisted verification, not completed representative-user testing.

| Destination | Default existing route | Visible local destinations | Purpose |
| --- | --- | --- | --- |
| Start | `/wg/[code]` | Today's items, next useful action, concise personal balance, recent activity | Resume the WG's work |
| Haushalt | `/wg/[code]/einkauf` | Einkauf, Putzen, Vorräte, Termine | Coordinate practical household work |
| Finanzen | `/wg/[code]/ausgaben` | Ausgaben, balances/settlement, Fixkosten, reminders, Import | Understand and record shared costs |
| Austausch | `/wg/[code]/pinnwand` | Pinnwand, Chat | Keep durable information and quick conversation distinct |

In candidate A, account/WG management opens from the shared profile action. Search opens from the shared header. Familiar icons can stay compact when their context makes the action clear and they have accessible names. Use visible labels for unfamiliar or consequential actions, including clear Konto/WG settings entries. Invitations, member management, exports, notifications and offline queue controls remain discoverable in the relevant settings sections. Activity remains reachable from Start. Calendar also has a contextual shortcut from upcoming items on Start.

Primary and route-changing local navigation use real links and current-route state. In-page views can use shadcn Tabs. Do not use a tab widget merely to fake browser navigation. Every existing deep link, prefill query and notification destination continues to resolve. If candidate A is selected, the calendar's parent becomes Haushalt; preserve its URL and change its visible back navigation consistently. No new API endpoint is needed for grouping pages.

Candidate B (direct-task destinations) remains a documented alternative only if later observation demonstrates problems in the selected structure. Do not delay the authorized implementation for another navigation comparison. Existing canonical routes and meaningful local labels preserve access; do not compensate for an unclear hierarchy with scattered duplicate shortcuts or a compulsory tutorial.

After selection, keep primary destination labels, relative order and common action positions stable between empty/populated states and return visits. Data may update, but navigation must not automatically reorder based on usage or daily recommendations. Keep list content stationary while the resident is tapping or reading; when a refresh changes order, preserve context and make the update apparent.

### 3. Make the entire mobile layout follow a small set of rules

- One vertical page flow, with a compact title/context header and a persistent bottom navigation where appropriate. Use a 390x844 reference canvas, also checking 320, 360 and 430 CSS-pixel widths. Reflow on phone rotation; larger screens may center the same phone experience without a separate layout.
- Use the selected preset's type hierarchy and spacing scale. Standard body/form text is readable at normal phone zoom; editable text defaults to at least 16 CSS pixels to avoid automatic input zoom. Interactive hit areas target at least 44x44 CSS pixels while keeping component appearance consistent.
- A short selection or small edit uses the official mobile Drawer. Multi-field work such as expense splitting and import uses a dedicated full-height editor surface composed from the same components, with explicit back/cancel and save/review actions. Do not stack several drawers for one task.
- The keyboard must leave the focused field and continuation action reachable. Respect safe areas, text enlargement, focus order and screen-reader labels. A swipe can supplement a visible control, not replace it.
- Primary bottom navigation can be absent while a focused editor or chat keyboard interaction requires the space, but an explicit return path is always present. Preserve the underlying list position when returning.
- No whole-row checkbox hit target may contain another nested button. Use separate controls for completion, item details and overflow actions.
- Use the original shadcn visual density with practical phone hit areas. Avoid inflating whole rows/cards or adding explanatory text simply to teach routine phone use. Familiar patterns include bottom destinations, direct list actions, short drawers and a persistent chat composer; useful gestures can supplement them.
- Routine add/check/edit actions should be direct. Do not insert a tutorial, extra step or confirmation for every tap. Keep confirmations where the actual financial, destructive or draft-loss consequence requires them; preserve existing safeguards until an equivalent safe recovery behavior is verified.

### 3a. Balance information against the current decision

The unit of simplification is the resident's task. There is no universal ideal number of cards, lines or taps. Original shadcn styling remains the visual baseline, while documented sizes, composition and mobile hit areas are selected to support comprehension.

For each screen in the coverage matrix, record a short content contract: current user question, facts required to answer it, the main action, the visible result and where optional detail lives. Prioritize by relevance and consequence, not by fitting a predetermined card count.

| Task | Essential in the current context | Secondary, explicitly discoverable detail |
| --- | --- | --- |
| Decide what to buy | Item, quantity, completion state and any person/state needed to avoid duplicate work; add/check actions | Historical metadata and rarely used item settings |
| Record a shared expense | Purpose, amount/currency, payer, affected people, allocation and resulting obligation before saving | Optional receipt attachment and recurrence configuration; an active option's effect remains summarized |
| Find today's chore | Task, assignee, due state and clear completion action | Rotation/fairness explanation and schedule editing; the consequence of completing still appears before a consequential write |
| Read a household notice | Main message, author/date and relevant open/resolved status | Comments/history and full long-form content behind an explicit control |

Progressive disclosure is for secondary options. Do not collapse payer, participants or the meaning of a financial action to make a form look shorter. Keep interdependent fields together with an inline consequence summary; split a flow into steps only when the stages are meaningfully separate. Retain enough text to understand the action and use a clearly named control such as `Beleg hinzufügen` or `Wiederholung` to reveal optional material.

Use one visually dominant page-level action where the task has one, while leaving repeated list actions and cancellation visible. A list of things to check is not forced into a single-action rule. Use headings, grouping and whitespace to show relationships, but avoid oversized empty regions that push routine actions away. Present relevant short contextual help where needed rather than relying on memorized onboarding instructions.

Use everyday German consistently. Explain a financial state as `Du bekommst ... zurück` or `Du schuldest ...` when supported by the actual result; a signed number or color alone is insufficient. Keep labels present after typing, explain unfamiliar terms where used, and make errors state what happened and how to continue. Validate the actual wording with residents; do not infer comprehension from an aria-label or familiar component source.

The content-contract review must identify both overload and missing context. If residents ask what an amount refers to, hide fewer facts or improve grouping. If they repeatedly scan irrelevant options, move those options to a clearly labeled secondary surface. Neither response requires inventing a new visual style.

### 4. Give every existing feature a redesigned home

The following is the coverage checklist for design and migration, not authorization to simplify away listed actions. Inspect each route's complete current behavior when implementing its slice.

| Area | Required flow and improvement | Proposed shadcn composition | Existing source anchors |
| --- | --- | --- | --- |
| Public entry and account | Clear create/join intent; configured sign-in; preserved invitation and return target; recovery, WG selection, public discovery and access to unchanged privacy information | Field, Input, Button, Alert, Item, Skeleton | `src/components/entry`, `src/app/neu`, `src/components/auth`, `src/app/auth/reset`, `src/app/entdecken`, `src/app/datenschutz` |
| Start | New WG: useful invite/first-action path. Existing WG: outstanding work and concise balance with real data. No fabricated activity | ItemGroup, Item, Card, Badge, Avatar, Empty | `src/app/wg/[code]/page.tsx`, `src/components/wg/dashboard` |
| Expenses | Add/edit/view amount, payer and split; show per-person consequence before save; preserve receipts, OCR, filters and recurring templates | FieldGroup, Field, InputGroup, Select, ToggleGroup, Item, Alert | `src/features/expenses/components/ausgaben`, `src/app/wg/[code]/ausgaben` |
| Balances and payments | Explain who owes whom; separate recording an existing payment from initiating PayPal; confirm exact supported settlement scope | Item, Badge, AlertDialog, Button | `src/components/wg/DebtSummary.tsx`, `PayPalPaymentButton.tsx` |
| Fixkosten and reminders | Preserve subscriptions, recurrence, pause/edit/remove, reminder delivery states and relevant rights | Item, Switch, Field, Collapsible, AlertDialog | `src/app/wg/[code]/abos`, `mahnungen`, `src/components/wg/Abo*` |
| Import and export | Source selection, member mapping, review, commit/progress and error recovery; preserve export formats and scope | Field, Select, Progress, Item, Alert | `src/features/expenses/components/import`, `src/components/wg/einstellungen/DataTab.tsx` |
| Shopping | Fast add, clear quantity and actor, check/uncheck, edit/delete, explicit reviewed transition into an expense | ItemGroup, InputGroup, Checkbox, Drawer, Button | `src/app/wg/[code]/einkauf`, `src/features/shopping/components` |
| Inventory | Add/edit, consume, stock status, restock and shopping connections remain reachable | Item, Badge, Drawer, Field, AlertDialog | `src/features/inventory/components`, `src/app/wg/[code]/vorraete` |
| Chores | Assignee and due state readable; completion result clear; preserve recurrence, rotation, absences and fairness | Item, Avatar, Badge, Field, Select, Collapsible | `src/features/chores/components`, `src/app/wg/[code]/putzen` |
| Pinnwand | Read/create/edit, attachments, filters, pin/resolve, comments, reactions and taking responsibility as supported | Item/Card, Badge, Avatar, Textarea, Menu, Tabs | `src/features/pinnwand`, `src/app/wg/[code]/pinnwand` |
| Chat | Read/write, typing/reaction/mention behavior; keyboard-safe composer; stable history and live updates | Message, Bubble, MessageScroller, Attachment, InputGroup | `src/features/chat/components`, `src/app/wg/[code]/chat` |
| Calendar | Upcoming agenda first; calendar selection available; preserve event CRUD, subscription and permissions | Calendar, Item, Field, Select, Drawer | `src/features/events/components`, `src/app/wg/[code]/kalender` |
| Search and activity | Results explain type/context and open the correct detail; retry remains visible | InputGroup, Item, Badge, Skeleton, Alert | `src/app/wg/[code]/suche`, `aktivitaet` |
| Settings and offline | Separate account/device from WG settings; preserve members, invite controls, access, notification preferences, exports and pending operations | ItemGroup, Switch, Field, AlertDialog, Alert | `src/components/wg/einstellungen`, `src/app/offline`, `src/core/offline` |

All source anchors above are relative to `apps/web/`. Reference illustrations and prototype data must be clearly labeled examples; production account data is not required to review the design.

### 5. Give Animate UI specific responsibilities

Use the Base UI family consistently with the proposed shadcn base. Select actual Animate UI registry items for checkbox feedback, switch transitions, and expanding optional fields. Keep the official shadcn Drawer as the owner of its opening/dismissal animation. Avoid two animation systems controlling the same transform or lifecycle.

| Interaction | Motion purpose | Completion rule |
| --- | --- | --- |
| Shopping checkbox | Confirm a changed selection without moving the next tap target unexpectedly | Distinguish confirmed save, queued offline change and failure; roll back optimistic state when appropriate |
| Settings switch | Show the new control state | Pending state is not a successful server save |
| Optional receipt/recurrence/split fields | Explain expanding/collapsing content | Keep entered values and keyboard focus coherent |
| Drawer or editor | Make entry and return understandable | Cancellation does not submit; focus returns to the opener |

Use `MotionConfig reducedMotion="user"` for Motion components and retain equivalent reduced-motion behavior for CSS transitions. Do not infer it from the presence of the dependency. Use upstream timings initially; tune only observed mobile usability problems. Keep motion code out of unrelated server-rendered routes.

Do not animate all list entries on every visit, run decorative loops while reading, or move the next touch target immediately after a checkbox action. Test the same task with motion enabled and reduced; keep an effect only when orientation and interaction remain clear. This is a task-quality check, not a claim that library defaults guarantee usability.

Animate UI components are not universally drop-in replacements. Its Base Checkbox, for example, does not support the primitive's `render` prop. Check docs and source of each selected registry item before wiring it to existing forms.

### 6. Implement a real prototype before committing the full composition

The user has started implementation and approved the image's organization. Use the isolated implementation worktree and original registry components directly; a separate throwaway prototype is no longer required. Reuse existing fixture/test support for safe visual verification after implementation. Do not connect validation actions to production services.

The post-implementation Luna review covers six connected views/states: Start with useful content, Einkauf list, add-item drawer, expense editor with inline split review, save result/return, and an offline or failed save. Show light and dark treatment of the same screen. Include new/empty and established/populated content; a sparse demonstration does not establish suitability for a busy WG. This replaces the earlier pre-implementation prototype gate at the user's explicit request.

Separate three kinds of evidence: expert inspection predicts issues; automated checks verify behavior; observation of representative young, smartphone-experienced users establishes first-use/return-use usability evidence. Include first-time and experienced WG roles and the relevant phone platforms. An owner walkthrough is valuable design feedback but does not replace independent first use.

Record first destination choice, unaided completion, wrong turns, task time, missing/excess information, interpretation of consequential actions, recovery and reported ease. Test a return session with equivalent new data and unchanged navigation after an interruption or gap, without a reminder tour. Counterbalance order or use fresh participants when comparing variants; familiarity can otherwise make the second variant seem better.

Acceptance and participant targets are defined in the [research protocol](../../../docs/research/2026-09-05-mobile-usability-validation.md). Report raw outcomes within the defined audience, including relevant phone/WG experience; a small round is directional, not a universal percentage or a promise of perfection. Any payment/privacy-scope misunderstanding and any repeated core-task failure requires a correction and targeted retest before the design is called usability-validated. Research recruitment and observation have not been performed; preparation can continue, but the user-validation status remains pending until real evidence exists.

### 7. Migrate the presentation with stable domain boundaries

Keep existing API clients, guards, split calculations, PWA/offline semantics and mutation contracts. Split presentation from controller logic only where the component replacement requires it. Do not write a universal renderer or duplicate the domain in a second client store.

Upgrade the UI build foundation to Tailwind 4 in the isolated branch, configure shadcn using the resolved preset and actual project aliases, and install only the components needed by the next slice. The root theme must own the new tokens. Temporarily namespace any necessary legacy styles while routes are being converted; legacy colors must not override the new components. Remove the bridge when the last consumer is migrated.

Update generated PWA/browser theme colors to the new theme without unrequested logo/brand asset replacement. Retain current theme preference storage or migrate it explicitly. Audit global CSS affecting headers, navigation, focus and reduced motion; preserve useful behavior without preserving old aesthetics.

## Risks / Trade-offs

- Category names or grouped destinations can be unclear -> compare candidate A with direct-task access before selecting the shell; validate first and repeat use with the defined young audience independently of visual preference.
- Excessive simplification can hide needed facts, while exposing everything can overload -> use per-screen content contracts and test both sparse and busy content; preserve decision-critical information.
- Tailwind 4 changes CSS semantics and browser support -> follow the official upgrade guide and test before adopting it. Its documented baseline is Safari 16.4+, Chrome 111+, Firefox 128+. Treat this as the proposed compatibility floor; do not claim older-phone support or narrow an existing explicit compatibility promise without resolving it.
- Existing global tokens share names such as `--accent` and `--border` with shadcn -> the new namespace/theme is authoritative; audit all consumers and any temporary migration bridge.
- Browser history, payment review or offline writes can regress during visual extraction -> preserve contracts and run the existing focused flow tests for every slice.
- Existing mobile tests encode old labels and structure -> update those assertions deliberately while retaining data/privacy/error assertions. Never remove a failing behavioral check merely to make the redesign pass.
- Current source and ongoing release work diverge -> reconcile the actual base and overlapping files before implementation; preserve all uncommitted work.
- Extra animation/client imports increase load -> check the existing bundle gate and interaction performance; one animation owner per element.

## Migration Plan

1. Reconcile the working base, record the complete feature-to-screen inventory, and use the isolated implementation worktree. Implementation starts from fetched `origin/main` at `8f845cd`.
2. Resolve the official preset and verify the Tailwind/browser compatibility metadata. Implement the approved structure with one owner per file. Do not run tests-first or reopen the image's approved organization.
3. Apply the accepted theme, phone shell, shared primitives and animation policy. Defer test runs to the verification phase as requested; dependency setup and CLI diagnostics are still necessary implementation steps.
4. Convert the first complete expense flow, including cancel/failure, split review and return. Financial semantics remain a dedicated checkpoint.
5. Convert public entry/create/join and Start. Then household, communication, secondary finance and account/settings flows in independently verified slices.
6. Complete remaining secondary states, remove obsolete UI styling, and update the knowledge graph after code changes.
7. Have Luna agents perform mobile browser click-throughs, run the existing focused/full technical gates, fix regressions and preserve screenshots/traces. Report fixture, real-device and live-service evidence separately.
8. Push the new branch for the user's review, without merging/deploying. Representative resident studies and the user's release decision remain later product activities. Rollback uses the previous coherent frontend release; drafts and stored WG/financial data must remain compatible. Never use a destructive reset of shared work as rollback.

## Sources

- [shadcn introduction](https://ui.shadcn.com/docs), [preset configurator](https://ui.shadcn.com/create), [theming](https://ui.shadcn.com/docs/theming).
- [shadcn Item](https://ui.shadcn.com/docs/components/base/item), [current Base Drawer](https://ui.shadcn.com/docs/components/base/drawer). The Base Drawer currently uses Base UI, not Vaul; consult current docs rather than older snippets.
- [Animate UI installation](https://animate-ui.com/docs/installation), [Base Checkbox](https://animate-ui.com/docs/components/base/checkbox), [accessibility](https://animate-ui.com/docs/accessibility).
- [Tailwind compatibility](https://tailwindcss.com/docs/compatibility) and [upgrade guide](https://tailwindcss.com/docs/upgrade-guide).
- [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) and [Recognition and Recall](https://www.nngroup.com/articles/recognition-and-recall/): task-dependent disclosure and visible cues. Their guidance is not a universal tab/card-count formula.
- [W3C: Understandable Controls](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o1-understandable/) and [Clear Content](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/): cognitive-accessibility guidance, supplemental to WCAG, not a certification claim.
- [W3C: Consistent Navigation](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html): repeated navigation retains its relative order.
- Local evidence: `apps/web/package.json`, root/WG layouts, route inventory, feature components and `apps/web/e2e`. Browser observation in this conversation is design context, not proof that local HEAD matches production.

### Public-entry implementation follow-up — 2026-09-05

The authorized first slice keeps `PublicApp({ activeModule?: string })`, existing discovery URLs, membership lookup states, invitation query propagation and all auth/recovery contracts. Start presents one clear headline, one guest sign-in link, a create/invite action and four read-only `Beispiel-WG` previews. Module routes present a clearly fictional active-module example, including secondary routes, without a public settings/reminders/activity catalog. The former public-only petrol exception is superseded; the installed Base Nova / Neutral / Inter / Lucide components and semantic tokens define the surface, with a simple documented Motion opacity transition and immediate reduced-motion behavior. Browser acceptance and hosted authentication evidence remain pending until the correction is verified.
