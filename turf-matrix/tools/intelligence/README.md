# TURF MATRIX Intelligence Layer

This directory owns deterministic analysis after TARGET parser/normalizer output.

Current scope:

- TM INDEX v0 scoring
- Blood AI v1 race-bias scoring (`blood-ai.mjs`)
- Training AI v1 workout scoring (`training-ai.mjs`)
- Value scoring from odds
- Verdict / evidence assembly

Boundaries:

- Do not parse raw CSV or HTML here.
- Do not write `week-data.json` here.
- Do not render UI here.
- Do not introduce dummy data or guessed odds.

Remaining split targets:

- `value-ai.mjs`
- `verdict-engine.mjs`
