# TURF MATRIX Intelligence Layer

This directory owns deterministic analysis after TARGET parser/normalizer output.

Current scope:

- TM INDEX v0 scoring
- TM INDEX Engine v1 factor integration (`tm-index-engine.mjs`)
- Form AI v1 ability and recent-form scoring (`form-ai.mjs`)
- Course AI v1 distance/course fit scoring (`course-ai.mjs`)
- Pace AI v1 lap and running-position scoring (`pace-ai.mjs`)
- Support AI v1 auxiliary frame/stable scoring (`support-ai.mjs`)
- Blood AI v1 race-bias scoring (`blood-ai.mjs`)
- Training AI v1 workout scoring (`training-ai.mjs`)
- Value AI v1 odds-value scoring (`value-ai.mjs`)
- Verdict Engine v1 evidence assembly (`verdict-engine.mjs`)

Boundaries:

- Do not parse raw CSV or HTML here.
- Do not write `week-data.json` here.
- Do not render UI here.
- Do not introduce dummy data or guessed odds.

Remaining split targets:

- race-level multi-race selector scoring
- intelligence regression tests
