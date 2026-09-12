# Communication source handoff

Date: 2026-09-05. Worktree: `/Users/abu/Company/manawg-app-mobile-redesign`.
Branch: `codex/mobile-shadcn-redesign-20260905`.

Source implementation and scoped lint repair finished for the assigned communication slice. This is an implementation handoff, not a verified release. Existing OpenCode changes were continued and retained. No dependencies, shared UI, global CSS, transport/domain helpers, API routes or other workers' paths were edited by this owner.

## Changed paths

All source paths below are relative to `apps/web/src/`.

- `app/wg/[code]/chat/loading.tsx`
- `app/wg/[code]/chat/page.tsx`
- `app/wg/[code]/pinnwand/page.tsx`
- `features/chat/components/ChatComposer.tsx`
- `features/chat/components/ChatView.tsx`
- `features/chat/components/MessageBubble.tsx`
- `features/chat/components/MessageList.tsx`
- `features/chat/components/ReactionPicker.tsx`
- `features/pinnwand/components/AnnouncementCard.tsx`
- `features/pinnwand/components/AnnouncementSkeleton.tsx`
- `features/pinnwand/components/EmptyState.tsx`
- `features/pinnwand/components/MyOpenAnnouncements.tsx`
- `features/pinnwand/components/PinnwandComposer.tsx`
- `features/pinnwand/components/PinnwandFilterBar.tsx`
- `features/pinnwand/components/PinnwandHeader.tsx`

Retained the partial OpenCode migration in `features/chat/components/MentionAutocomplete.tsx`, `SystemMessage.tsx` and `TypingIndicator.tsx`. Both route `error.tsx` files retain their existing boundary IDs/reset behavior and consume the separately redesigned shared `WgRouteErrorBoundary`; no duplicate error surface was added.

## Feature coverage

- Visible real-link Pinnwand/Chat navigation under Austausch, with the chat back link returning to Pinnwand. Existing route URLs, query prefills, source/conversion links and announcement hash targets remain.
- Pinnwand uses original Card, Avatar, Badge, Attachment, DropdownMenu, AlertDialog, Field/InputGroup, ToggleGroup, Empty and Skeleton components. Full long-form text remains expandable; image attachments open in full size. Author/time, kind, pin, status and all responsible members remain visible.
- Pin/remove controls reflect author/admin permission; status controls reflect author/taker permission. Server authorization is unchanged. Delete confirmation remains explicit, and pending operations and failures remain visible.
- All seen/take/ok reactions remain available; secondary reactions and shopping/chore/expense prefills remain in the menu. Responsibility, completion/reopen, unpin and thank-you actions remain available to the appropriate users.
- All comments remain accessible through an Animate UI collapsible. Create/edit/delete uses the existing controller, optimistic reconciliation and rollback. Pending temporary comments cannot be edited. Confirmed responses retain known author metadata when the API only returns the stored comment fields.
- The existing announcement draft key, queue-edit recovery, attachment upload/offline path and create-error behavior remain. Closing preserves the selected kind. Quick templates no longer replace a meaningful draft. Reply/comment-edit drafts use additional household/member/post-scoped keys through the existing draft storage functions.
- Chat uses generated MessageScroller, Message, Bubble/BubbleReactions, Attachment and Marker primitives. Every message has a stable ID and is a direct scroller-content child. Explicit auto-follow and prepend preservation replace the incomplete day-level wrapper wiring; the existing pagination/cursor/merge functions and read sentinel remain.
- Older-history failures have an explicit retry and suspend automatic retry while failed. Edits and delete dialogs close only on confirmed success. Send/reaction controls expose pending/failure and guard duplicate taps. Draft input is retained after a rejected save.
- Chat text/reply targets and edit drafts persist under household/member-scoped keys. The existing mention filtering, insertion, keyboard navigation, Unicode name matching and active-member choices remain. Input handles IME composition without premature send.
- Chat sizes its own route frame from the visual viewport and existing navigation height to keep the composer reachable when the keyboard opens. This does not alter the shared shell or message scrolling controller.
- Real Animate UI collapsibles are used for optional attachments, advanced filters and comments. Hidden, retained panels are inert. The existing Foundation reduced-motion configuration is reused.

## Concrete limits and verification still open

- The existing `chat-channel.ts` is polling-only, at 8 seconds while visible. It does not produce typing events and no realtime client is shipped. The interface describes polling honestly; the existing empty typing source remains. No simulated typing or realtime claim was added.
- Existing chat can display image messages but its send composer does not provide image upload. No new upload transport was invented.
- The announcement PATCH API supports kind/pin/status, not editing an existing post's body. Existing post-body editing was not invented. Comment editing, post creation/drafts and existing status actions are retained.
- No shared-component requests remain for the implementation used here. All imports use the components already published by Foundation.
- The new draft keys use the existing best-effort local draft store. Chat warns if persistence fails; cross-route survival for additional comment/edit drafts still depends on browser storage being available.
- Scoped Biome formatting/import repair was run for the 22 Communication files with `pnpm exec biome check --write --unsafe`, followed by `pnpm exec biome check`; the final scoped check passed with no diagnostics. The `pnpm.overrides` warning is outside this scope.
- Technical and device verification remains open: typecheck/build; Base UI/Animate UI runtime composition; chat prepend/live-follow/read markers; actual iOS/Android keyboard and safe-area behavior at small widths; permission states; drafts across navigation; failed/queued saves; attachment opening and long content. These are explicit follow-up gates, not completed results.
- Tests, typecheck, build, browser, graph, commits, push and deployment were NOT run in this source wave. No live data, invitations or payments were touched. No owner command remains running.

No further source work or polishing is in progress from this owner. Handoff is ready for the orchestrator's integration and verification wave.
