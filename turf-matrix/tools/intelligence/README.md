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
- Race selector v1 deterministic featured-race selection (`race-selector.mjs`)
- Output contract validation (`output-contract.mjs`)
- Live-data regression suite (`tests/intelligence-regression.test.mjs`)

Boundaries:

- Do not parse raw CSV or HTML here.
- Do not write `week-data.json` here.
- Do not render UI here.
- Do not introduce dummy data or guessed odds.

Remaining split targets:

- multi-race TARGET input integration
- Intelligence Engine version promotion after regression baselines are approved

Verification:

```powershell
npm run verify:intelligence
npm run build
```

The regression suite uses the committed production/candidate data. It does not create dummy runners or guessed scores.
