# TURF MATRIX TARGET HTML intake

TARGET HTML is optional. HTML files are not connected directly to production
`week-data.json` in the current flow.

## Fixed input folder

Place optional TARGET HTML exports here:

```text
tools/target-html/input/
```

Do not commit raw HTML files. TARGET/JRA-VAN source HTML may contain licensed
raw data, so `tools/target-html/input/*.html` and `*.htm` are ignored by git.

## Current policy

Main source:

- `tools/csv/input/all.csv`

Training HTML supplements:

- `tools/target-html/input/training-slope.html`
- `tools/target-html/input/training-wood.html`

Horse-level pedigree HTML:

- `tools/target-html/input/pedigree/*.html`

File names may stay as exported horse names, for example:

- `ヤマニンブークリエ.html`
- `リカンカブール.html`
- `メリオーレム.html`

Optional / non-preferred HTML:

- `racecard.html`
- `pedigree.html`
- `form.html`

Racecard, pedigree, recent form, ZI, body weight, and running style should come
from `all.csv`. Training HTML and horse-level four-generation pedigree HTML are
stored as parser inputs, but they are not connected to production data in this
sprint.

## Power Automate Desktop operation

The PAD recording sheet is maintained here:

```text
docs/PAD_TARGET_EXPORT.md
```

Use it as the source of truth for fixed save locations, fixed file names,
Thursday preodds preparation, and Friday production update commands.

## Expected encoding

TARGET HTML may be Shift_JIS / CP932. A future parser should read files as:

1. UTF-8 when a UTF-8 BOM or valid UTF-8 is detected.
2. Shift_JIS / CP932 fallback when UTF-8 decoding contains replacement
   characters.

Do not manually convert files during parser investigation. Keeping the raw
export helps identify the correct encoding and table structure.

## Candidate extraction fields

### Training slope HTML

Potential fields:

- Date
- Trainer
- Slope time
- Lap
- Evaluation

Future targets:

- `analysis.trainingEval`
- `analysis.factorsDetail.training`
- `horses[].raw.trainingSessions`
- `horses[].raw.trainer`

### Training wood/CW/D HTML

Potential fields:

- Date
- Course
- Direction
- 10F to 1F
- Lap
- Evaluation

Future targets:

- `analysis.trainingEval`
- `analysis.factorsDetail.training`
- `horses[].raw.trainingSessions`

## Current rules

- HTML is optional.
- Missing HTML must not fail `npm run validate:csv`.
- Missing HTML must not fail `npm run generate-week`.
- Missing HTML must not fail `npm run build`.
- HTML must not be used to update production `week-data.json` without a future
  sprint.
- Do not use HTML to fill dummy data.
- Keep `all.csv` and `odds.csv` as the only required production CSV inputs.
- Keep raw horse-level pedigree HTML under `tools/target-html/input/pedigree/`.

## Future parser structure

Candidate files for a future sprint:

```text
tools/target-html/detect-html-inputs.mjs
tools/target-html/parse-training-slope.mjs
tools/target-html/parse-training-wood.mjs
```

The first parser implementation should only detect files, encoding, row/table
counts, and candidate headers. Data connection to Intelligence Layer should
happen in a later sprint.
