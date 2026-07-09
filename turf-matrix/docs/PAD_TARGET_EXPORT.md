# TURF MATRIX PAD TARGET export flow

This document is the operating sheet for Power Automate Desktop.
It fixes every TARGET export name and destination folder.

## Fixed folders

```text
Repo root:
C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix

TARGET CSV:
tools\csv\input\

TARGET training HTML:
tools\target-html\input\
```

Suggested PAD variables:

```text
RepoRoot = C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix
CsvInputDir = %RepoRoot%\tools\csv\input
HtmlInputDir = %RepoRoot%\tools\target-html\input
```

## Current input policy

Main input:

- `tools\csv\input\all.csv`
- Source: TARGET `全て.csv`
- Used for: race data, runner data, pedigree, recent form, ZI, body weight,
  running style

Supplemental input:

- `tools\target-html\input\training-slope.html`
- `tools\target-html\input\training-wood.html`
- Used for: training evidence candidates only

Friday input:

- `tools\csv\input\odds.csv`
- Used for: odds, popularity, EV, Value AI, TM VALUE

Non-preferred optional HTML:

- `racecard.html`
- `pedigree.html`
- `form.html`

These three HTML files are not part of the standard PAD flow for now. Use
`all.csv` as the source for racecard, pedigree, recent form, ZI, body weight,
and running style.

## Minimal export set

Thursday pre-odds preparation:

| TARGET source | Save as | Folder | Role |
| --- | --- | --- | --- |
| TARGET `全て.csv` | `all.csv` | `tools\csv\input\` | Main preodds source |
| Training slope HTML | `training-slope.html` | `tools\target-html\input\` | Optional training evidence |
| Training wood/CW/D HTML | `training-wood.html` | `tools\target-html\input\` | Optional training evidence |

Friday production update:

| TARGET source | Save as | Folder | Role |
| --- | --- | --- | --- |
| TARGET odds CSV | `odds.csv` | `tools\csv\input\` | Required production odds source |

Production `week-data.json` must not be updated until `odds.csv` exists and
CSV validation passes.

## PAD recording flow

Record this once in Power Automate Desktop, then rerun it every week.

1. Launch TARGET frontier JV.
2. Wait until the TARGET main window is active.
3. Run or confirm TARGET data update.
4. Open the target race/week export screen.
5. Export TARGET `全て.csv`.
6. Save it exactly as:
   `tools\csv\input\all.csv`
7. Open the training slope HTML screen when available.
8. Save it exactly as:
   `tools\target-html\input\training-slope.html`
9. Open the training wood/CW/D HTML screen when available.
10. Save it exactly as:
    `tools\target-html\input\training-wood.html`
11. On Friday, export TARGET odds CSV.
12. Save it exactly as:
    `tools\csv\input\odds.csv`

Always overwrite the same fixed file names. Do not add dates, race names,
venue names, or Japanese race titles to the file names.

## Thursday command block

Run this after `all.csv` and optional training HTML are saved. This is preview
only and does not publish.

```powershell
Set-Location "C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix"
npm run detect:html
npm run generate:preodds
npm run build
```

Expected result:

- Training HTML files are detected when present.
- `tools/week-data.preodds.json` may be generated.
- `tools/week-data.json` is not updated.
- No Git commit or push is made.

## Friday command block

Run this only after `tools\csv\input\odds.csv` exists.

```powershell
Set-Location "C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix"
npm run validate:csv
npm run weekly:update
```

Expected result:

- CSV validation requires `all.csv` and `odds.csv`.
- `weekly:update` generates `week-data.next.json`.
- Build must pass before production data is promoted.
- Git commit / push happens only after the safe update path succeeds.

## Failure handling

If Thursday training HTML is missing:

- `npm run detect:html` reports missing optional files.
- Production data is not touched.
- Continue on Friday after odds are available.

If `all.csv` or `odds.csv` is missing on Friday:

- `npm run validate:csv` exits with a non-zero code.
- `weekly:update` must not push.
- Existing `tools/week-data.json` stays untouched.

If build fails:

- Do not push.
- Keep the exported CSV/HTML files in the input folders.
- Fix the cause, then rerun the Friday command block.

## Git safety

Raw TARGET files must not be committed.

The repository ignores:

```text
tools/csv/input/*.csv
tools/target-html/input/*.html
tools/target-html/input/*.htm
tools/week-data.preodds.json
tools/week-data.next.json
```

Before any manual commit, check:

```powershell
git status --short
```

No raw `.csv`, `.html`, or `.htm` file from the input folders should appear.
