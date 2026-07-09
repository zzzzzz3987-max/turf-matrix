# TURF MATRIX PAD TARGET export flow

This document is the operating sheet for Power Automate Desktop.
It keeps weekend manual work close to zero by fixing every TARGET export name
and every destination folder.

## Fixed folders

Use these folders only:

```text
Repo root:
C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix

TARGET HTML:
tools\target-html\input\

TARGET CSV:
tools\csv\input\
```

Suggested PAD variables:

```text
RepoRoot = C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix
HtmlInputDir = %RepoRoot%\tools\target-html\input
CsvInputDir = %RepoRoot%\tools\csv\input
```

## Minimal export set

Thursday pre-odds preparation:

| TARGET source | Save as | Folder | Required for production? |
| --- | --- | --- | --- |
| 出馬表 HTML | `racecard.html` | `tools\target-html\input\` | No |
| 血統 HTML | `pedigree.html` | `tools\target-html\input\` | No |
| 前走 HTML | `form.html` | `tools\target-html\input\` | No |
| 調教1 / 坂路 HTML | `training-slope.html` | `tools\target-html\input\` | No |
| 調教2 / ウッド/CW/D HTML | `training-wood.html` | `tools\target-html\input\` | No |
| 出馬表 CSV | `shutuba.csv` | `tools\csv\input\` | Yes |

Friday production update:

| TARGET source | Save as | Folder | Required for production? |
| --- | --- | --- | --- |
| オッズ CSV | `odds.csv` | `tools\csv\input\` | Yes |

`shutuba.csv` and `odds.csv` are the only required CSV files for production.
HTML files are optional inputs for future parser work and must never force a
production update.

## PAD recording flow

Record the flow once in Power Automate Desktop, then rerun it every week.

1. Launch TARGET frontier JV.
2. Wait until the TARGET main window is active.
3. Run or confirm TARGET data update.
4. Open the target race/week screen.
5. Save the racecard HTML to:
   `tools\target-html\input\racecard.html`
6. Save the pedigree HTML to:
   `tools\target-html\input\pedigree.html`
7. Save the previous-runs HTML to:
   `tools\target-html\input\form.html`
8. Save the slope training HTML to:
   `tools\target-html\input\training-slope.html`
9. Save the wood/CW/D training HTML to:
   `tools\target-html\input\training-wood.html`
10. Export the racecard CSV to:
    `tools\csv\input\shutuba.csv`
11. On Friday, export odds CSV to:
    `tools\csv\input\odds.csv`

When TARGET's save dialog opens, always overwrite the same fixed file name.
Do not add dates, race names, or Japanese race titles to the file names.

## Thursday command block

Use this after HTML and `shutuba.csv` are saved. This does not publish.

```powershell
Set-Location "C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix"
npm run detect:html
npm run generate:preodds
npm run build
```

Expected result:

- HTML files are detected when present.
- `tools/week-data.preodds.json` may be generated.
- `tools/week-data.json` is not updated.
- No Git commit or push is made.

## Friday command block

Use this only after `tools\csv\input\odds.csv` exists.

```powershell
Set-Location "C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix"
npm run validate:csv
npm run weekly:update
```

Expected result:

- CSV validation must pass first.
- `weekly:update` generates `week-data.next.json`.
- Build must pass before production data is promoted.
- Git commit / push happens only after the safe update path succeeds.

## Failure handling

If Thursday HTML is missing:

- `npm run detect:html` reports missing optional files.
- Production data is not touched.
- Continue on Friday after odds are available.

If `shutuba.csv` or `odds.csv` is missing on Friday:

- `npm run validate:csv` stops with a non-zero exit code.
- `weekly:update` must not push.
- Existing `tools/week-data.json` stays untouched.

If build fails:

- Do not push.
- Keep the exported CSV/HTML files in the input folders.
- Fix the cause, then rerun the Friday command block.

## Git safety

Raw TARGET files must not be committed.

The repository already ignores:

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
