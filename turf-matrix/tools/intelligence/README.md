# TURF MATRIX Intelligence Layer

This directory owns deterministic analysis after TARGET parser/normalizer output.

Current scope:

- TM INDEX Engine v1.5 race-category weighting (`tm-index-engine.mjs`)
- Form AI v1.5 ability, class, margin, and recent-form scoring (`form-ai.mjs`)
- Course AI v1.5 distance/course/surface fit scoring (`course-ai.mjs`)
- Pace AI v1.5 running-style, position, and lap scoring (`pace-ai.mjs`)
- Support AI v1 auxiliary frame/stable scoring (`support-ai.mjs`)
- Blood AI v1.5 race-bias and line-trait scoring (`blood-ai.mjs`)
- Training AI v1.5 final-workout and finish-lap scoring (`training-ai.mjs`)
- Value AI v1.5 odds gap and implied-probability scoring (`value-ai.mjs`)
- Verdict Engine v1.5 evidence assembly (`verdict-engine.mjs`)
- Race selector v1 deterministic featured-race selection (`race-selector.mjs`)
- Race Context v1 per-race surface and distance profile (`race-context.mjs`)
- Output contract validation (`output-contract.mjs`)
- Live-data regression suite (`tests/intelligence-regression.test.mjs`)

Stage 1.5 quality gates:

- no fabricated odds or dummy runners;
- no mojibake in published intelligence text;
- readable evidence for Form, Blood, Training, Course, Pace, and Value;
- TM INDEX contributors are kept as structured output for future UI display.
- data quality and race-relative ranks are stored when candidate generation has enough context.

Offline learning:

- `npm run learn:blood` aggregates pedigree roles against normalized past results into ignored `tools/jvlink/output/bloodlines.learned.json`.
- Post-race learning can pass `--cutoff YYYY-MM-DD --for-week YYYY-MM-DD`; only observations strictly before the cutoff are eligible.
- A Blood statistic needs at least 12 runs from 5 different horses before it can affect a score.
- `npm run approve:blood` explicitly promotes only qualified statistics to `data/master/bloodlines.json`. Weekly generation never promotes learned data automatically.
- `npm run approve:blood:pairing-reference` promotes sample-qualified pairing and cross statistics to `data/master/blood-pairing-reference.json` for Evidence display only. This reference file never changes Blood Score or TM INDEX.
- Pairing reference selection uses father x broodmare-sire first, then normalized line fallbacks, and always applies leave-one-horse-out before exposing a sample.
- `npm run learn:stables` scans reviewed archives for trainer workout patterns and writes ignored `tools/jvlink/output/stables.learned.json`.
- A learned stable pattern needs at least 20 reviewed runners. Runtime scoring reads only explicitly approved `data/master/stables.json`.
- Learning remains offline. Weekly Intelligence execution only performs deterministic lookup and matching.
- Score-affecting pairing/cross adjustments remain in the frozen shadow pipeline until their predeclared adoption gates pass.

Boundaries:

- Do not parse raw CSV or HTML here.
- Do not write `week-data.json` here.
- Do not render UI here.
- Do not introduce dummy data or guessed odds.

Remaining split targets:

- course-specific bias profiles backed by reviewed evidence
- Intelligence Engine version promotion after multi-race regression baselines are approved

Verification:

```powershell
npm run verify:intelligence
npm run build
```

The regression suite uses the committed production/candidate data. It does not create dummy runners or guessed scores.
