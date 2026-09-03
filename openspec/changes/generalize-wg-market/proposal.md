## Why

The current Growth Lab uses students as its only market-size anchor, which narrows ManaWG's opportunity and can make the SEO result look student-specific. ManaWG serves shared households generally, so the simulation needs a clearly separated all-WG market model while retaining students as one evidence-backed segment.

## What Changes

- Replace the student-only capacity calculation with a bounded general-WG market capacity.
- Keep students as a named segment and add non-student segments such as employed residents, trainees, international residents, and other shared households.
- Preserve per-parameter provenance, uncertainty ranges, stale-data warnings, seeded replay, and existing safety gates.
- Make channel and strategy labels describe the broader WG audience rather than students by default.
- Keep unsupported all-WG market-size values explicitly assumed until an authoritative current source or privacy-safe aggregate is available.

## Capabilities

### New Capabilities

- `general-wg-market`: Defines segment-aware, provenance-bearing market inputs and general-WG capacity calculations for the Growth Lab.

### Modified Capabilities

None. The existing growth-simulation contract has not been archived as a repository-level spec, so this change expresses the new market contract as a capability-level addition.

## Impact

The change is limited to `tools/growth-lab/` inputs, the dependency-free simulator and self-check, and this OpenSpec change. It does not change the ManaWG web app, database, analytics, public accounts, marketing activity, or production data. No new dependency or external write is required.
