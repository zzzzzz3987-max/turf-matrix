# TURF MATRIX Intelligence Layer

This directory owns deterministic analysis after TARGET parser/normalizer output.

Current scope:

- TM INDEX v0 scoring
- Blood AI v1 race-bias scoring
- Training AI v0 scoring
- Value scoring from odds
- Verdict / evidence assembly

Boundaries:

- Do not parse raw CSV or HTML here.
- Do not write `week-data.json` here.
- Do not render UI here.
- Do not introduce dummy data or guessed odds.

Next split targets:

- `blood-ai.mjs`
- `training-ai.mjs`
- `value-ai.mjs`
- `verdict-engine.mjs`

