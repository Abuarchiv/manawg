## Context

See `proposal.md` for motivation and `specs/growth-simulation/spec.md` for the
behavioral contract. The repository is a Node 22/pnpm monorepo with no existing
growth simulator. The app worktree is intentionally dirty, so the change must
add an isolated tool and must not refactor application code, analytics, or the
database.

Current public evidence is mixed: Destatis provides a current student count,
while the available WG-living share is from an older Social Survey. Platform
APIs and terms also differ materially, so each input needs explicit provenance
and freshness rather than a single global "market size" number.

## Goals / Non-Goals

**Goals:**

- Provide one deterministic Node CLI that validates snapshots, simulates
  declarative strategies, ranks them, and emits JSON plus Markdown.
- Keep assumptions, observed aggregate metrics, freshness, and confidence
  visible in every run.
- Make unattended execution bounded, repeatable, append-only, and safe to run
  from the existing 15-minute automation.
- Keep the first implementation dependency-free and calibratable from aggregate
  ManaWG metrics.

**Non-Goals:**

- No web scraping, account creation, posting, messaging, ad buying, deployment,
  production writes, or execution of strategy-provided code.
- No causal claim that a simulation proves demand or marketing lift.
- No new analytics vendor, experiment platform, database table, or UI surface.

## Decisions

1. **Repository-local Node tool, no new dependency.** Put the simulator and
   schemas under `tools/growth-lab/` and expose one root package script. Node's
   built-in filesystem, crypto, URL, and `fetch` APIs cover the requirements;
   adding a Monte Carlo or analytics package would increase install and review
   surface without improving the first model.

2. **Snapshot-first inputs.** A versioned JSON snapshot is the only simulation
   input. Every parameter uses `{unit, min, mode, max, evidence, source,
   observedAt, freshnessDays}`. A separate optional refresh step may collect
   allowlisted public GET sources later; simulation never silently fetches or
   replaces inputs. This makes replay possible when live pages change.

3. **Triangular distributions and seeded PRNG.** Ranges use pessimistic/mode/
   optimistic values and a small deterministic PRNG seeded from the CLI. Each
   iteration advances a funnel model: reach -> visits -> WGs -> joined members
   -> activated WGs -> retained WGs -> referrals, while accumulating hours,
   cash costs, and revenue. Triangular sampling is understandable and avoids a
   statistical dependency; the model version is included in the hash identity.

4. **Fail-closed validation and atomic promotion.** Validate the entire input,
   strategy action vocabulary, units, bounded ranges, freshness, and aggregate
   calibration fields before opening the run lock. Write a temporary result and
   report, fsync/rename them, then append one index record. `last-success.json`
   is replaced only after all artifacts pass validation; failures leave it
   unchanged.

5. **Hard gates before ranking.** Compute the configured thresholds and safety
   flags first. Only eligible strategies receive a weighted score. The report
   includes component metrics, weights, sensitivity drivers, and up to three
   approval-gated experiments. This prevents a cheap but prohibited channel from
   winning on a weighted average.

6. **Privacy-safe calibration boundary.** Calibration accepts aggregate values
   only, with a measurement window and sample size. Reject keys resembling
   identifiers, message content, tokens, credentials, commands, callbacks, or
   modules before persistence. Observations update a labeled prior and widen
   uncertainty when samples are sparse; they do not mutate the source snapshot.

7. **Scheduler contract is one-shot.** The CLI performs one bounded run and
   exits. OpenClaw `/loop` remains the scheduler and `/goal` remains the
   durable session objective; neither is embedded into the repository tool.

## Risks / Trade-offs

- [Stale or sparse market evidence] -> Mark dependent outputs stale/low
  confidence and exclude them from ready-to-run recommendations.
- [Model optimism or false precision] -> Use seeded P10/P50/P90 ranges, expose
  assumptions, and label all results as simulation rather than observed demand.
- [Concurrent automation runs] -> Use a repository-local lock with a bounded
  stale-lock recovery rule and never promote partial output.
- [Simple funnel model misses platform dynamics] -> Include sensitivity output
  and require a real controlled experiment before treating any strategy as
  validated.
- [Generated artifacts pollute Git] -> Keep reports and locks ignored while
  retaining versioned schemas, fixtures, and an append-only logical run index.

## Migration Plan

No production migration. Add the tool, a conservative example snapshot, and a
minimal self-check. Run it locally, then point the existing isolated automation
at the one-shot command. Rollback is deleting/disabling the new package script
and ignoring/removing generated run output; the ManaWG app and database are not
affected.

## Open Questions

- The first observed aggregate calibration window can be selected once ManaWG
  has a privacy-safe analytics export; this does not change the simulator
  contract.
