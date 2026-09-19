# ManaWG mobile redesign: shared component contract

Foundation publishes the shared UI contract for the parallel feature workers.
All imports below are relative to `apps/web/src` and use the `@/*` alias.

## Visual baseline

`apps/web/components.json` is the source of truth for generated components:

- shadcn style: `base-nova` (Nova)
- primitive base: Base UI
- theme/base color: Neutral
- icons: Lucide (`lucide-react`)
- radius: default
- Tailwind: v4 (`tailwindConfig: null`)
- CSS variables: `src/shared/globals.css`
- class merger: `@/shared/lib/cn`

The current CLI preset resolution is `b2fA` with `font: geist` and
`fontHeading: inherit`; the app-level font override now uses the requested
Inter font in `src/app/layout.tsx`. New feature code must use
semantic shadcn tokens (`bg-background`, `text-foreground`, `bg-card`,
`text-muted-foreground`, `border-border`, `bg-primary`, and related tokens),
not legacy Vercel/blue/beige classes.

## Import paths and APIs

Use the exact component path `@/components/ui/<name>`.

| Import | Exports |
| --- | --- |
| `@/components/ui/button` | `Button`, `buttonVariants` |
| `@/components/ui/input` | `Input` |
| `@/components/ui/textarea` | `Textarea` |
| `@/components/ui/label` | `Label` |
| `@/components/ui/field` | `FieldSet`, `FieldLegend`, `FieldGroup`, `Field`, `FieldContent`, `FieldLabel`, `FieldTitle`, `FieldDescription`, `FieldSeparator`, `FieldError` |
| `@/components/ui/input-group` | `InputGroup`, `InputGroupAddon`, `InputGroupButton`, `InputGroupText`, `InputGroupInput`, `InputGroupTextarea` |
| `@/components/ui/card` | `Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardDescription`, `CardContent`, `CardAction` |
| `@/components/ui/item` | `ItemGroup`, `ItemSeparator`, `Item`, `ItemMedia`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`, `ItemHeader`, `ItemFooter` |
| `@/components/ui/badge` | `Badge`, `badgeVariants` |
| `@/components/ui/avatar` | `Avatar`, `AvatarImage`, `AvatarFallback` |
| `@/components/ui/separator` | `Separator` |
| `@/components/ui/tabs` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `tabsListVariants` |
| `@/components/ui/native-select` | `NativeSelect`, `NativeSelectOptGroup`, `NativeSelectOption` |
| `@/components/ui/toggle-group` | `ToggleGroup`, `ToggleGroupItem` |
| `@/components/ui/toggle` | `Toggle`, `toggleVariants` |
| `@/components/ui/checkbox` | `Checkbox` |
| `@/components/ui/drawer` | `Drawer`, `DrawerPortal`, `DrawerOverlay`, `DrawerSwipeHandle`, `DrawerTrigger`, `DrawerClose`, `DrawerContent`, `DrawerHeader`, `DrawerFooter`, `DrawerTitle`, `DrawerDescription` |
| `@/components/ui/dialog` | `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`, `DialogOverlay`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription` |
| `@/components/ui/alert-dialog` | `AlertDialog`, `AlertDialogTrigger`, `AlertDialogPortal`, `AlertDialogOverlay`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogMedia`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` |
| `@/components/ui/alert` | `Alert`, `AlertTitle`, `AlertDescription`, `AlertAction` |
| `@/components/ui/empty` | `Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent` |
| `@/components/ui/skeleton` | `Skeleton` |
| `@/components/ui/spinner` | `Spinner` |
| `@/components/ui/progress` | `Progress`, `ProgressTrack`, `ProgressIndicator`, `ProgressLabel`, `ProgressValue` |
| `@/components/ui/collapsible` | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` |
| `@/components/ui/dropdown-menu` | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuPortal`, `DropdownMenuGroup`, `DropdownMenuSub`, `DropdownMenuRadioGroup`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuShortcut` |
| `@/components/ui/message` | `MessageGroup`, `Message`, `MessageAvatar`, `MessageContent`, `MessageFooter`, `MessageHeader` |
| `@/components/ui/bubble` | `BubbleGroup`, `Bubble`, `BubbleContent`, `BubbleReactions` |
| `@/components/ui/message-scroller` | `MessageScrollerProvider`, `MessageScroller`, `MessageScrollerViewport`, `MessageScrollerContent`, `MessageScrollerItem`, `MessageScrollerButton`, `useMessageScroller`, `useMessageScrollerScrollable`, `useMessageScrollerVisibility` |
| `@/components/ui/attachment` | `Attachment`, `AttachmentGroup`, `AttachmentMedia`, `AttachmentContent`, `AttachmentTitle`, `AttachmentDescription`, `AttachmentActions`, `AttachmentAction`, `AttachmentTrigger` |
| `@/components/ui/marker` | `Marker`, `MarkerIcon`, `MarkerContent`, `markerVariants` |

Existing shared WG feedback components keep their public props and behavior,
but now compose the generated primitives:

- `@/components/wg/BackLink`: `BackLink({ href, label })`
- `@/components/wg/LoadErrorBanner`: `LoadErrorBanner({ message, onRetry, busy, retryLabel })`
- `@/components/wg/ActionNoticeBanner`: `ActionNoticeBanner({ notice })`, with
  `ActionNoticeTone = "error" | "warning" | "success"`
- `@/components/wg/ImageUploader`: unchanged upload/offline props and behavior;
  its controls and feedback use `Button`, `Alert`, and `Spinner`

## Base UI composition rules

Base UI uses `render`, not Radix `asChild`, when replacing a primitive's
element. The `Button` is a Base UI button, so links use:

```tsx
<Button render={<a href="/wg/ABC" />} nativeButton={false}>
  WG öffnen
</Button>
```

For form layouts use `FieldGroup` and `Field`. `InputGroup` must contain
`InputGroupInput` or `InputGroupTextarea`, not a raw `Input` or `Textarea`:

```tsx
<FieldGroup>
  <Field>
    <FieldLabel htmlFor="title">Titel</FieldLabel>
    <Input id="title" />
  </Field>
  <Field>
    <FieldLabel htmlFor="message">Nachricht</FieldLabel>
    <InputGroup>
      <InputGroupInput id="message" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label="Senden">Senden</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </Field>
</FieldGroup>
```

Base-specific value shapes matter:

- `Select` requires an `items` prop. Its `SelectItem`s belong inside
  `SelectGroup`; use `{ value: null }` for the placeholder item.
- `ToggleGroup` uses `multiple`, and a single selection is represented as an
  array (`defaultValue={["equal"]}`), not Radix's `type="single"` string.
- `Dialog`, `Drawer`, and `AlertDialog` content must include their title
  component. Use `className="sr-only"` only when the title is intentionally
  visually hidden.
- `Avatar` must include `AvatarFallback`.
- `TabsTrigger` belongs inside `TabsList`; grouped menu/select items belong in
  their corresponding group.
- Buttons have no loading prop. Compose `Spinner`, `disabled`, and the visible
  pending label.

## Messaging composition

`MessageScrollerProvider` owns scroll anchoring and follows the required
nesting order:

```tsx
<MessageScrollerProvider>
  <MessageScroller>
    <MessageScrollerViewport>
      <MessageScrollerContent>
        <MessageScrollerItem scrollAnchor>
          <MessageGroup>
            <Message align="start">
              <MessageAvatar>AB</MessageAvatar>
              <MessageContent>
                <BubbleGroup>
                  <Bubble variant="secondary">
                    <BubbleContent>Hallo zusammen</BubbleContent>
                  </Bubble>
                </BubbleGroup>
              </MessageContent>
            </Message>
          </MessageGroup>
        </MessageScrollerItem>
      </MessageScrollerContent>
    </MessageScrollerViewport>
    <MessageScrollerButton direction="end" />
  </MessageScroller>
</MessageScrollerProvider>
```

`BubbleContent` supports Base UI's `render` prop for an interactive content
surface. `AttachmentGroup` is the horizontal attachment list; use
`Attachment` with `state="idle" | "uploading" | "processing" | "error" | "done"`
and use `Marker` for system notes/dividers. The feature worker owns transport,
drafts, reactions and permissions; these primitives own presentation only.

## Animate UI Base components

Animate UI is installed from the explicit `@animate-ui` registry and uses the
Base UI family. These are the stable consumer paths:

- `@/components/animate-ui/components/base/checkbox`: animated `Checkbox`
  and `CheckboxProps`; props include the Base checkbox props plus `variant`
  (`default` | `accent`) and `size` (`sm` | `default` | `lg`). It renders the
  animated indicator and intentionally omits Base UI's `render` prop.
- `@/components/animate-ui/components/base/switch`: animated `Switch` and
  `SwitchProps`; it adds `pressedWidth`, `startIcon`, `endIcon`, and `thumbIcon`
  to the Base switch props.
- `@/components/animate-ui/primitives/base/collapsible`: `Collapsible`,
  `CollapsibleTrigger`, `CollapsiblePanel`, `useCollapsible` and related types.
  `CollapsiblePanel` adds `keepRendered` and Motion `transition` props.

Use the animated checkbox for shopping completion and the animated switch for
settings transitions. Use the animated collapsible panel for optional fields.
The official shadcn versions remain available at `@/components/ui/checkbox` and
`@/components/ui/collapsible` when no motion is needed.

All Animate UI motion is wrapped by the shared theme provider with
`MotionConfig reducedMotion="user"`; do not add a second motion configuration
or animate the same lifecycle from two owners.

## Foundation exceptions and outstanding work

- `@/lib/get-strict-context`, `@/hooks/use-controlled-state`,
  `@base-ui-components/react`, `@shadcn/react`, and `motion` are generated
  support dependencies of the Animate UI and messaging registry items. Feature
  workers should not import these support paths directly unless the component
  contract above exposes the need.
- `@/components/ui/ConfirmDialog` and `Toast` are legacy compatibility surfaces
  still used by active feature code. Do not add new consumers; migrate existing
  callers only in their owning feature slice.
- The final cleanup of old global presentation aliases remains Foundation work;
  Inter typography is active. No feature page, domain/API route, auth guard, draft,
  offline queue, or payment logic is changed by this contract.
- Verification (tests, typecheck, build, browser, and graph update) is
  deliberately not run during the implementation wave.
