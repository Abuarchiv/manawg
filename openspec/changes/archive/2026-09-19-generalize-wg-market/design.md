## Context

See `proposal.md` and `specs/general-wg-market/spec.md`. The current simulator already stores an assumed `market.maxActiveWgs` range and an observed student-count reference, but its capacity calculation also divides the general WG ceiling by the student count. Current public evidence does not justify treating that student count as the total WG population.

## Goals / Non-Goals

**Goals:**

- Use the existing bounded `market.maxActiveWgs` parameter as the aggregate general-WG ceiling.
- Keep the student refresh and historical WG-share evidence visible as reference data and evidence gaps.
- Make the broad audience explicit in the snapshot and report without inventing quantitative segment sizes.
- Preserve deterministic replay, source refresh, hard gates, and the no-external-action boundary.

**Non-Goals:**

- No new market-size claim for all German WGs without a current authoritative source.
- No demographic profiling, identity data, production analytics, or application changes.
- No new dependency or separate segment-specific funnel model.

## Decisions

1. **Reuse the aggregate ceiling.** Treat `market.maxActiveWgs` as the general-WG capacity and remove the student-count denominator from the capacity calculation. Adding a second speculative aggregate parameter would duplicate uncertainty without improving evidence.

2. **Keep students as a benchmark.** Retain `market.students` and the existing refresh because it is a useful observed anchor, but do not let it constrain non-student WGs. Removing it would discard verified source data and make the refresh less useful.

3. **Use descriptive audience categories.** Add a small non-numeric audience list to the snapshot and surface it in the report. Numeric category shares remain out of scope until supported by authoritative data or privacy-safe aggregate observations.

4. **Broaden labels only.** Update channel wording and report metadata to avoid student-only framing. Strategy mechanics remain unchanged so the comparison stays attributable to the market-scope correction.

## Risks / Trade-offs

- [The assumed general-WG ceiling may be optimistic or conservative] -> Keep its bounded range, assumption label, sensitivity output, and evidence gap visible.
- [A single aggregate capacity hides segment differences] -> Surface categories now and defer quantitative segment funnels until evidence exists.
- [Historical student WG-share evidence may confuse readers] -> Label it as a stale reference and exclude it from capacity calculations.

## Migration Plan

Update the versioned fixture and simulator, run the self-check and repository gates, then let the existing refresh-to-simulate loop consume the new snapshot. Rollback is reverting this isolated change; no production migration is needed.
