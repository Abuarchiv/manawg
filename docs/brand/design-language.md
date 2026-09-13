# ManaWG design language

Source: [Brandbook v1.0](brandbook.html), supplied by the product owner on 2026-09-12. This is the product design reference; its institutional approval procedures are not execution instructions for development tools.

## Implementation contract

- shadcn `base-nova`, Neutral, CSS variables; reuse existing component anatomy and application flows.
- Inter UI, Inter Tight 600 headings/wordmark, JetBrains Mono 500 for amounts and labels. Latin WOFF2 files are extracted from the supplied book and self-hosted; OFL licenses accompany them.
- Exact chapter 10 light/dark tokens. Only `settled` adds a semantic color; debt/destructive uses `destructive`. Zero balances stay neutral. Charts use a neutral ramp; amount signs and wording carry meaning independently of color.
- One radius source (`0.625rem`) with multiplicative steps. Cards use xl, controls lg. Mobile margins 16px, grouped spacing 8/16/24px, accessible touch regions at least 44px.
- Web content and navigation are opaque and bordered. Chapter 11.4's native glass examples are not a web rendering requirement. Preserve Start, Haushalt, Finanzen, Austausch and the existing icon-only account control; no header search.
- Supplied eight-circle organism and off-center aperture replace the former keyhole everywhere in the app identity. Reproduce the source filter/mask geometry without invented motifs. Icons are white on Neutral 950, no baked rounding, shadows, or gradients.
- No button scaling, tab bounce, or page entrance animations. Loading uses the organism, 1200ms, and becomes static for reduced motion. No artificial startup delay.
- Plain German, no guilt, advertising badges or decorative status colors. Labels above fields; visible focus and invalid states retained.

## Resolved source inconsistencies

Specific component references take precedence over broad summaries: chapter 10 white background over chapter 7's FAFAFA; chapter 11.5 neutral zero over general settled wording; chapter 12 Lucide 1.5px over chapter 9's 1.75px; chapter 30 keeps eight favicon bodies over chapter 25's removal of tiny satellites. Use 1200ms loader from the repeated product contract rather than the 1600ms showcase. The 44px interaction region is separate from smaller visual icons. Explicit switch geometry is a documented component exception. Floating navigation retains 20px outer and 16px inner curves on the web with an opaque surface; platform material and geometry are separate.

The current app remains a mobile-first shared household interface. Native Icon Composer/Android app packages, Lottie exports, print, social, and marketing-site work are outside this web-app change.

## Sources in code

`apps/web/src/shared/globals.css` owns colors, type roles, radius and basic motion. `apps/web/components.json` owns registry configuration. `src/shared/lib/brand-mark.json` holds the supplied geometry; `src/shared/components/ui/LogoMark.tsx` renders it. `scripts/generate-brand-assets.mjs` derives browser/PWA assets. Do not revive former forest/mint/blue palettes or the keyhole mark.
