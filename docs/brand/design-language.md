# ManaWG design language

The design contract for the app. Follow it for UI, typography, icons, motion and wording.

## Implementation contract

- shadcn `base-nova`, Neutral, CSS variables; reuse existing component anatomy and application flows.
- Inter for UI, Inter Tight 600 for headings and the wordmark, JetBrains Mono 500 for amounts and labels. The Latin WOFF2 subsets are self-hosted in `apps/web/src/shared/fonts/`, with their OFL licenses next to them.
- Light and dark tokens are the shadcn Neutral set. Only `settled` adds a semantic color; debt and destructive use `destructive`. Zero balances stay neutral. Charts use a neutral ramp; amount signs and wording carry meaning independently of color.
- One radius source (`0.625rem`) with multiplicative steps. Cards use xl, controls lg. Mobile margins 16px, grouped spacing 8/16/24px, accessible touch regions at least 44px.
- Content and navigation are opaque and bordered. Navigation: Start, Haushalt, Finanzen, Austausch and the icon-only account control; no header search.
- The mark is eight circles merged by a blur and threshold filter, with an off-center aperture. Icons are white on Neutral 950, with no baked rounding, shadows or gradients.
- No tab bounce or page entrance animations. Loading uses the mark, 1200ms, and is static for reduced motion. No artificial startup delay.
- Plain German, no guilt, advertising badges or decorative status colors. Labels above fields; visible focus and invalid states.
- Text on destructive tints uses `--destructive-text` (derived from `destructive`, at least 4.5:1 contrast in light and dark), never the raw `destructive` fill. The armed confirm step of a destructive action uses the `destructive-solid` button variant.
- Pending labels are present tense with an ellipsis character: "Speichert…", "Löscht…", "Lädt…".

## Motion exceptions

- Subpage navigation may use a 120 ms opacity-only fade. Reduced-motion preferences skip it; sliding, bounce and startup delay stay disallowed.
- Shared buttons and tappable list or card surfaces may scale to 0.97 for an 80 ms pressed state. Reduced-motion preferences disable the scale; 44 px touch targets remain required.

## Navigation chrome

The bottom navigation is one component (`AppBottomNav`) with an opaque, bordered bar: no translucent background, no backdrop blur. The active item is a raised `.glass-pill` (solid in reduced-transparency and contrast modes, outlined in forced colors). The Start header is sticky and gains a hairline once content scrolls under it, driven by `animation-timeline: scroll()` with no JavaScript and no motion under reduced motion. Native selects opt into `appearance: base-select` where supported; older browsers keep the system control.

## Member avatar color

The color of member avatars is intentional. `memberTint(name)` in `src/components/wg/MemberAvatar.tsx` picks one of eight oklch hues from the member's name and mixes it with `--background`/`--foreground`, so every avatar of a person (members, chat, Pinnwand, balances) matches in light and dark, with initials contrast of at least 5.9:1. This is the only decorative color; do not neutralize avatars back to `bg-muted`, and do not reuse the hues for status or other surfaces.

## Responsive control contract

- Component sizes belong to the shared primitives, not a phone-only global override. Button variants use visible 24/32/36/40px minimum heights and grow when text wraps. Their hit regions extend to 44px without enlarging the painted box; adjacent grouped controls reserve their own width to avoid overlapping hits.
- Native inputs, selects and single-line input groups use 44px actual height and 16px text on phones and tablets. Native controls cannot reliably use pseudo-elements to extend their hit area, so the 44px touch floor wins over a smaller visual size. Do not use zoom, transforms or clipped focus rings to simulate smaller fields.
- On phones, primary add actions may be icon-only plus buttons. Every such action keeps its accessible name.
- Tablet Home uses balanced columns; phone Home remains a single column. Forms retain internal scrolling and reachable actions on short viewports.

## Secondary text contrast

The stock light `--muted-foreground` (`oklch(0.556 0 0)`) reaches 4.74:1 on white but only 4.35:1 on `--muted` surfaces, below the 4.5:1 AA minimum for body-size text. Light mode uses `oklch(0.52 0 0)` instead (5.0:1 on muted, 5.9:1 on white); dark mode already passes and is unchanged. `--ring` keeps its original lightness so focus stays distinguishable from the resting border.

## Icons and favicon

Lucide icons with a 1.5px stroke. The 44px interaction region is separate from the smaller visual icon. The favicon keeps all eight bodies of the mark.

## English copy

English copy follows the same persona as German: it states, it does not demand, and it never blames. No exclamation marks, emojis, slang or office jargon. The app reminds, it does not chase.

- Address the reader as "you", descriptively rather than as a command. Sentence case everywhere, including buttons.
- British spelling with -ise (organise, cancelled, colour). Curly quotes.
- Pending labels use the present tense with an ellipsis: "Saving…", "Loading…".
- Amounts and dates use `en-GB`: `€24.80`, `+€42.30`, the Intl minus, 24-hour time, `3 Mar` and `3 March 2026`.
- Reference sentence: "€24.80 to Lena, open since 3 March." Never "You owe Lina money!", "Great job, team", "Task overdue" or "Pay up".
- "ManaWG" is never translated and never takes an article. "WG" in prose is "flat"; onboarding explains it once as "WG (shared flat)".
- The rule of one German everyday noun per concept becomes one everyday English noun from the [English glossary](glossary-en.md).

## Sources in code

`apps/web/src/shared/globals.css` owns colors, type roles, radius and basic motion. `apps/web/components.json` owns the shadcn registry configuration. `src/shared/lib/brand-mark.json` holds the mark geometry; `src/components/ui/LogoMark.tsx` renders it. `scripts/generate-brand-assets.mjs` derives the browser and PWA icons from it (`node scripts/generate-brand-assets.mjs`).
