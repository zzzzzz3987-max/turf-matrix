# TURF MATRIX TARGET CSV intake

This folder defines the weekly CSV intake for TURF MATRIX.

Power Automate Desktop or manual TARGET operation exports raw files. The app
only validates those files and runs the safe weekly update pipeline.

## Fixed input folder

Power Automate Desktop must place TARGET CSV exports here:

```text
tools/csv/input/
```

Use fixed file names. Do not add dates, race names, or venue names.

## Required files

| Timing | File | Save path | TARGET source | Purpose |
| --- | --- | --- | --- | --- |
| Thursday or Friday | `all.csv` | `tools/csv/input/all.csv` | TARGET `全て.csv` | Main source for races, runners, pedigree, recent form, ZI, body weight, running style |
| Friday | `odds.csv` | `tools/csv/input/odds.csv` | TARGET odds CSV | Odds, popularity, EV, Value AI, TM VALUE |

`all.csv` is the primary input. `odds.csv` is added on Friday before the
production update. Production `week-data.json` must not be updated until
`odds.csv` exists and validation passes.

## Deprecated / non-preferred CSV files

The following older split CSV inputs are no longer the preferred weekly path:

| File | Current status |
| --- | --- |
| `shutuba.csv` | Deprecated for the standard flow. Use `all.csv` instead. |
| `supplement.csv` | Non-preferred. Expected fields should come from `all.csv`. |
| `training.csv` | Non-preferred. Training is handled by HTML candidates for now. |
| `pedigree.csv` | Non-preferred. Pedigree should come from `all.csv`. |

Keep these out of the standard PAD flow unless a future sprint explicitly
reintroduces them.

## Validation rules

`npm run validate:csv` requires:

- `tools/csv/input/all.csv` exists.
- `tools/csv/input/odds.csv` exists.
- Each required CSV was updated today.
- Each required CSV is at least 1 KB.
- Each required CSV has at least 2 rows.

If a required CSV is missing or invalid:

- validation exits with a non-zero code;
- `week-data.next.json` is not generated;
- existing `tools/week-data.json` is not changed;
- no commit or push is performed.

## Thursday preodds operation

Thursday can prepare all non-odds data:

1. Export TARGET `全て.csv`.
2. Save it as `tools/csv/input/all.csv`.
3. Save optional training HTML files when available.
4. Run:

```powershell
npm run detect:html
npm run generate:preodds
npm run build
```

This may create `tools/week-data.preodds.json`, but it must not update
production `tools/week-data.json`.

## Friday production operation

Friday adds odds:

1. Export TARGET odds CSV.
2. Save it as `tools/csv/input/odds.csv`.
3. Run:

```powershell
npm run validate:csv
npm run weekly:update
```

Only after validation and build succeed may the pipeline promote
`week-data.next.json` to `week-data.json` and push to GitHub.
