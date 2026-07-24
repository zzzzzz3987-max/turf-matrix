# TURF MATRIX Weekly Review Workflow

## Purpose

Publish a verifiable weekly review on note after the Saturday and Sunday race releases.
All comparisons must use the immutable values saved at publication time. Results must
come from official JV-Link records. Do not rewrite published scores after the result.

## Ownership

Codex is responsible for:

1. Fetching finalized results, payouts, weather, and going through JV-Link.
2. Joining results to the Saturday and Sunday publication snapshots.
3. Validating race and horse identity before aggregation.
4. Generating the weekly statistics and note-ready Markdown draft.
5. Reporting missing or inconsistent records instead of estimating them.

The user performs the final editorial check and note publication.

## Weekly Schedule

- Monday: fetch and archive finalized Saturday and Sunday results.
- Tuesday or Wednesday: generate one combined note review draft.

## Required Review Sections

- Finish positions of TM INDEX ranks 1-3.
- Finish positions of EV ranks 1-3.
- Win hit rate and win return rate.
- Place hit rate and place return rate.
- Separate summaries for graded and special races.
- Performance by confidence level.
- Review of Blood, Training, and Pace evidence.
- Improvements and hypotheses to verify the following week.

## Return Calculation

Use a fixed simulated stake of JPY 100 per selected horse.

```text
win return rate   = total official win payout / total simulated win stake * 100
place return rate = total official place payout / total simulated place stake * 100
```

Report simulated returns separately from any real betting activity. When a horse
appears in more than one strategy, count it once only in a combined portfolio and
retain it in each strategy-specific report.

## Safety Rules

- Never fabricate finish positions, payouts, weather, going, odds, or popularity.
- Keep Saturday and Sunday publication snapshots immutable.
- Require race identity and horse identity to match before joining.
- A failed result fetch must not overwrite an existing archive.
- Dictionary updates remain approval-based; result ingestion does not automatically
  promote learned Blood or Training rules.

## Planned Commands

```powershell
npm run archive:results
npm run review:note
```

These commands become active only after the JV-Link finalized-result parser and
note generator are implemented and verified.
