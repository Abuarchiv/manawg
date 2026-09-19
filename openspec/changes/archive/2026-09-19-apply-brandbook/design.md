## Context
Existing Next.js 15/React app uses Tailwind 4 and shadcn base-nova Neutral. Legacy aliases, assets and motion still contain prior identities.

## Goals / Non-Goals
Apply the supplied brandbook using current components and retain all product behavior. Native applications, publication and marketing are non-goals.

## Decisions
Use the exact chapter 10 tokens and detailed chapter references where summaries disagree, as recorded in docs/brand/design-language.md. Extract and self-host source fonts. Keep one shared mark geometry for React and static assets. Preserve financial calculations and adjust presentation only.

## Workflow and ownership
1. Root: source audit, assets, durable contract and integrated verification.
2. Theme worker: global styles and root font metadata; completion is valid tokens, aliases and typecheck.
3. Component worker: chrome and controls; completion is preserved semantics and brandbook presentation.
4. Independent review: inspect integrated diff against source, then root resolves findings and runs gates.
Dependencies: source audit -> independent implementation branches -> integrated review -> lint/typecheck/build/browser checks -> graph refresh and handoff. Shared status lives in tasks.md. No overlapping writers.

## Risks
Small-brand-mark readability, legacy aliases, narrow viewport overflow and cached PWA assets require direct checks. Local fixtures do not establish production service health or persistence.
