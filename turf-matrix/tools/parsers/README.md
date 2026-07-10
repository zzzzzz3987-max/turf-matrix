# TURF MATRIX parser layer

Sprint 1.9 adds parser skeletons only.

The parser layer is responsible for:

- defining each raw input contract;
- checking whether a raw input exists;
- checking basic file health;
- listing extraction targets for future sprints.

The parser layer is not connected to:

- `tools/week-data.json`;
- Intelligence Layer;
- Blood AI;
- Training AI;
- UI.

## Inputs

| Parser | Input | Role |
| --- | --- | --- |
| `all-csv-parser.mjs` | `tools/csv/input/all.csv` | Main TARGET all export |
| `training-slope-html-parser.mjs` | `tools/target-html/input/training-slope.html` | Optional slope training HTML |
| `training-wood-html-parser.mjs` | `tools/target-html/input/training-wood.html` | Optional wood/CW/D training HTML |
| `pedigree-html-parser.mjs` | `tools/target-html/input/pedigree/*.html` | Optional horse-level pedigree HTML |

`tools/csv/input/odds.csv` remains a Friday input for the existing weekly
pipeline. It is intentionally not parsed in Sprint 1.9 because Value AI / EV /
TM VALUE are outside this sprint.

## Contract shape

Each parser exports:

- `parserId`
- `source`
- `extractionTargets`
- `inspect(options)`

`inspect` returns a deterministic validation summary and must not return dummy
race or horse data.

