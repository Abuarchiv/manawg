# Shared presentation implementation report

Date: 2026-09-05. Worktree: `/Users/abu/Company/manawg-app-mobile-redesign`.

The seven assigned presentation files are implemented. They had no existing
source diff when this resumed slice began. Other workers' partial changes were
preserved. Only the seven files below and this report were edited in this slice.

## Changed files

Paths below are relative to `apps/web/src`.

| File | Implementation |
| --- | --- |
| `shared/components/install-prompt.tsx` | Official `Card` header/description/action/footer composition and `Button`; bounded phone width and scrollable height; neutral logo tokens. |
| `shared/components/install-button.tsx` | Official `Button`, controlled `Dialog`, labeled header/footer and numbered `ItemGroup`/`Item`/`Badge` instructions for each existing platform. Replaces the handwritten portal and focus trap. |
| `components/ui/ConfirmDialog.tsx` | Controlled official `Dialog` with title, description, footer and primary/destructive `Button` variants; explicit initial cancel focus and focus return. |
| `components/ui/DeleteConfirmButton.tsx` | Official `Button` and `Spinner`; existing two-click confirmation hook and timeout retained. |
| `components/ui/EmptyState.tsx` | Full official `Empty` composition with media, title, description and optional actionable content. |
| `components/ui/Toast.tsx` | Official `Alert`/`AlertDescription` and dismiss `Button`, inside the phone frame above bottom navigation. Existing notification store is retained. |
| `components/ui/styles.ts` | All eight string exports retained. Button bridges reuse official `buttonVariants`; remaining field/list/error/empty strings use semantic tokens. |

## Preserved contracts

- All exported component signatures, default labels, callbacks and compatibility
  string names remain available. No lowercase primitives, dependencies, global
  CSS, feature pages, controller/domain/API code or stored data were changed.
- `ConfirmDialog`: cancel, Escape and background dismissal call `onClose`;
  confirmation still calls `onConfirm` followed by `onClose` without awaiting a
  mutation. Cancel receives initial focus. Base UI owns trapping and restoration
  to the prior focused element. Long content scrolls within the safe viewport.
- `DeleteConfirmButton`: the first click arms the same ID; a second click before
  the existing timeout invokes the callback. Pending disables the control and
  shows a spinner. Both supplied accessible labels and the visible `OK` label
  remain unchanged. The existing timeout hook was not edited.
- `EmptyState`: the caller's icon, headline, description and optional CTA/icon
  remain intact. CTA buttons remain non-submit buttons.
- `Toast`: the same `success`, `error` and `info` methods, IDs, insertion order,
  haptic strengths, four-second automatic removal and manual dismissal remain.
  Error alerts and polite success/info announcements retain their roles.
- PWA: the existing event subscription, native prompt invocation, installed
  checks, user-agent branches, accepted/dismissed/unavailable handling and
  platform instructions remain. The prompt retains the 14-day dismissal key,
  delayed/scroll visibility and focused-input suppression. `pwa-register.tsx`
  and the installation/dismissal helpers were read-only.
- The installation fallback explicitly focuses its close button and returns
  focus to the installation button. Base UI handles Escape, outside dismissal
  and modal focus. The passive install card sits below modal overlays.

## Deliberate compatibility decisions

- `ConfirmDialog` uses official `Dialog`, rather than `AlertDialog`, because
  the installed Base UI `AlertDialog` disables outside-pointer dismissal. The
  existing wrapper supports that cancel path; retaining it takes precedence.
  Destructive wording remains caller-supplied and the action uses the official
  destructive variant.
- Toasts use the existing store with installed `Alert` primitives. No new toast
  provider or dependency was introduced. The old decorative countdown bar was
  removed; the actual four-second timer is unchanged.
- The string-only `styles.ts` API remains a migration bridge. It cannot render
  components without changing existing callers; new screens should use the
  actual primitives.

## Remaining shared cleanup and verification

No assigned source implementation remains unfinished. Final global CSS cleanup
is still reserved for the later coordinated transfer after feature consumers
stabilize. Do not remove compatibility exports based on this snapshot alone.

Last read-only consumer snapshot, while other owners were still editing:

- `styles.ts`: event create/edit/forms/upcoming list, `AnnouncementCard`,
  `AboForm`, `AboModalShell`, and the Abos/Pinnwand/Kalender routes.
- `ConfirmDialog`: event edit, Abos and calendar-subscription confirmation.
- `DeleteConfirmButton`: `AnnouncementCard`.
- `Toast`: Einkauf, Putzen, `ChatView` and the WG layout.
- `InstallPrompt`: root layout. `InstallButton` and `EmptyState` exports remain
  available even where concurrent owners have replaced their callers.

Source and diffs were read to check the changes. Tests, typecheck, lint, build,
browser/device checks and graph updates were **not run**. No commits or pushes.
Runtime parity is not claimed as verified. Later integration checks must cover
nested modal focus/Escape/return, PWA platform paths and suppression, repeated
delete clicks/pending states, toast timing/announcements, and 320px/enlarged-text
layout. Existing global visual rules may still affect these surfaces until the
coordinated global cleanup.

## Foundation lint pass

The focused Foundation Biome pass was run after the source changes. It covered
55 current changed or untracked files under the assigned UI, Animate UI, shared,
hooks, lib, layout, configuration and OpenCode paths. Mechanical formatting and
import fixes were applied with Biome's write mode, then the remaining issues
were fixed manually:

- Animate UI SVGs now have meaningful titles and self-closing empty primitives.
- The generated shared Label keeps one targeted
  lint/a11y/noLabelWithoutControl rationale because callers provide
  htmlFor or nested controls.
- Field error rendering uses strict equality and stable message keys.
- The controlled-state helper uses unknown[] instead of any.
- Installation steps use semantic list items and the live prompt uses a
  labeled section.

Result: pnpm exec biome check completed cleanly for the focused 55-file
Foundation set. No tests, typecheck, build, browser, graph update, commit or
push was run in this lint pass.
## Terra P1 repair

- `Field` now accepts explicit `undefined` for its optional description id and omits `aria-describedby` when absent, preserving the DOM contract.
- The Animate UI Base Checkbox, Collapsible and Switch integrations omit undefined optional props before forwarding them to Base UI/Motion, preserving controlled/uncontrolled behavior and indeterminate/motion behavior.
- No `tsconfig` relaxation or error-hiding cast was introduced. Technical gates remain pending after this repair.

## Terra Activity follow-up

- `components/wg/BackLink.tsx` now renders the shared back control as a direct `next/link` styled with the official `buttonVariants`/`cn` bridge. This restores an accessible link in the built DOM while retaining the public props, href, visible arrow, `Zurück zu ${label}` accessible name, 44px target and existing navigation semantics.
- No tests, typecheck, build, browser checks, graph update, commit or push were run, per task scope.
