# TURF MATRIX PAD race batch automation

This is the practical automation plan for the remaining human work:

```text
TARGET screen export for selected races
```

The goal is not to make Power Automate Desktop understand racing data. The goal
is to make PAD repeat the same export/save actions against fixed paths generated
by TURF MATRIX.

## Automation boundary

Automated by TURF MATRIX:

- creates race input folders
- generates PAD save-path manifest
- validates exported files
- generates preview candidate
- builds production app
- publishes on Saturday after odds are present

Automated by PAD:

- launches TARGET
- opens each configured race
- exports fixed TARGET screens
- saves files to the manifest paths

Still intentionally manual:

- choosing the official weekly race set in `tools/race-batch-config.json`
- confirming TARGET has been updated
- checking preview before publish

## One-time setup

```powershell
Set-Location "C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix"
npm run scaffold:race-batch
npm run pad:manifest
```

Generated files:

```text
tools/pad-runtime/race-batch-manifest.json
tools/pad-runtime/race-batch-manifest.md
```

Both files are git-ignored. Recreate them whenever
`tools/race-batch-config.json` changes.

## Thursday PAD flow

Record this once in Power Automate Desktop.

1. Launch TARGET frontier JV.
2. Wait for TARGET main window.
3. Run or confirm data update.
4. For each bundle in `tools/pad-runtime/race-batch-manifest.md`:
   - open the race in TARGET
   - export current race detail CSV
   - save as `current-race-detail.csv`
   - export TARGET all CSV
   - save as `all.csv`
   - if available, save slope training HTML as `training-slope.html`
   - if available, save wood/CW/D training HTML as `training-wood.html`
   - if available, save horse pedigree HTML files into the `pedigree` folder
5. Run:

```powershell
npm run inspect:race-batch
npm run thursday:preview
```

Thursday must not publish production data.

## Thursday operator checklist

Goal:

```text
Grade races must be updated every week with analysis quality above the
2026-07-12 Tanabata Sho release. Special races may use the lighter analysis
path, but they must still receive TM INDEX, course/distance, form, blood, and
training where data exists.
```

Before running PAD:

1. Confirm the weekly target race list in `tools/race-batch-config.json`.
2. Run:

```powershell
Set-Location "C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix"
npm run scaffold:race-batch
npm run pad:manifest
```

3. Open `tools/pad-runtime/race-batch-manifest.md`.
4. Keep it visible while recording or running PAD.

Thursday required files per race:

| Race type | Required | Optional but recommended |
| --- | --- | --- |
| Grade race | `current-race-detail.csv`, `all.csv`, `training-slope.html`, `training-wood.html`, horse-level `pedigree/*.html` | extra pedigree pages if TARGET exposes them |
| Special race | `current-race-detail.csv`, `all.csv` | `training-slope.html`, `training-wood.html`, horse-level `pedigree/*.html` |

Why this split exists:

- Grade races are the weekly showcase. They should have deep Blood AI and
  Training AI evidence.
- Special races still receive Stage 1 Intelligence, but missing optional
  training or pedigree should not block Thursday preview.

After PAD finishes:

```powershell
npm run inspect:race-batch
npm run thursday:preview
```

Expected Thursday result:

- all configured bundles exist
- grade race bundles have current race, all, training, and pedigree evidence
- special race bundles at least have current race and all
- `tools/week-data.json` is not updated
- no commit or push is made

If grade race training or pedigree is missing:

1. Do not ignore it silently.
2. Re-run only the missing TARGET export step for that grade race.
3. Run `npm run inspect:race-batch` again.
4. If TARGET genuinely has no data for that horse or race, publish with the
   honest `未取得` / `一部取得` display.

## PAD recording details

Use fixed variables in Power Automate Desktop:

```text
RepoRoot = C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix
ManifestMd = %RepoRoot%\tools\pad-runtime\race-batch-manifest.md
ManifestJson = %RepoRoot%\tools\pad-runtime\race-batch-manifest.json
```

Recommended PAD structure:

```text
Flow: TURF MATRIX Thursday Export

1. Launch TARGET frontier JV
2. Wait for TARGET main window
3. Run TARGET data update
4. Open ManifestMd so the save paths are visible
5. For each target race:
   5-1. Open race in TARGET
   5-2. Export current race detail CSV
   5-3. Save to the race folder as current-race-detail.csv
   5-4. Export TARGET all CSV
   5-5. Save to the race folder as all.csv
   5-6. If this is a grade race, export slope training HTML
   5-7. Save as training-slope.html
   5-8. If this is a grade race, export wood/CW/D training HTML
   5-9. Save as training-wood.html
   5-10. If this is a grade race, save horse-level pedigree HTML into pedigree folder
6. Run PowerShell command: npm run inspect:race-batch
7. Run PowerShell command: npm run thursday:preview
```

Recommended PAD actions:

| PAD action | Purpose |
| --- | --- |
| `Run application` | Launch TARGET |
| `Wait for window` | Wait until TARGET is ready |
| `Send keys` / `Click UI element` | Operate TARGET menus |
| `Populate text field in window` | Set save file name |
| `If file exists` | Confirm export succeeded |
| `Run PowerShell script` | Run TURF MATRIX verification commands |

Save dialog rule:

```text
Always overwrite the manifest path.
Never add date, venue, race name, or Japanese title to the filename.
```

Failure detection in PAD:

- after each export, check that the saved file exists
- check file size is greater than 1 KB
- for CSV, check the first line or row count is not empty
- if a required grade file is missing, stop the flow and show a message
- if an optional special-race file is missing, log it and continue

Suggested stop message:

```text
TURF MATRIX export stopped.
Missing required grade-race file:
%MissingPath%
Re-export this TARGET screen and rerun inspect:race-batch.
```

## Saturday PAD flow

1. Launch TARGET frontier JV.
2. Update TARGET.
3. For each bundle in `tools/pad-runtime/race-batch-manifest.md`:
   - open the race odds screen
   - export odds CSV
   - save as `odds.csv`
4. Run:

```powershell
npm run inspect:race-batch
npm run saturday:publish
```

Production update is allowed only when all required odds files pass validation.

## Friday/Saturday operator checklist

Goal:

```text
Add real odds only. Do not estimate odds, popularity, TM VALUE, or Value AI.
```

Required files per race:

| Race type | Required |
| --- | --- |
| Grade race | `odds.csv` |
| Special race | `odds.csv` |

Run after PAD odds export:

```powershell
npm run inspect:race-batch
npm run saturday:publish
```

Expected Saturday result:

- every race has `odds.csv`
- odds count matches the race entry count
- TM VALUE is calculated from real odds
- `week-data.json` is updated only after validation and build succeed
- commit / push runs through the safe publish path

If `inspect:race-batch` fails:

- do not run `saturday:publish`
- re-export the failed race odds file
- rerun `inspect:race-batch`

If a race is cancelled or TARGET odds are unavailable:

- do not fabricate odds
- leave the race as `未取得` / `未評価`
- publish only if the release gate accepts the explicit missing state

## Weekly quality bar

Grade race quality bar:

- current race data present
- runner count correct
- all.csv present
- odds.csv present before publish
- training evidence should be present when TARGET provides it
- pedigree evidence should be present when TARGET provides it
- Blood AI explains the strength, not just the four-line names
- Training AI explains final workout, finish, and acceleration where available
- AI verdict must be readable in Japanese

Special race quality bar:

- current race data present
- all.csv present
- odds.csv present before publish
- TM INDEX generated
- TM VALUE generated after odds
- short AI verdict generated
- missing training/pedigree is allowed, but must be displayed honestly

Do not publish if:

- grade race runner count is wrong
- grade race name/course/race number is wrong
- odds are zero-filled or guessed
- `TM INDEX` or AI verdict is copied from another race
- raw CSV/HTML appears in `git status --short`

## Recommended hybrid direction

JV-Link direct intake should gradually replace PAD exports for:

- race details
- runners
- odds

PAD should remain as the fallback for:

- TARGET-specific training HTML
- horse-level pedigree HTML

This keeps the weekly operation practical while JV-Link coverage is still being
validated.

## Failure rules

- If a race folder is missing, run `npm run scaffold:race-batch`.
- If the manifest is stale, run `npm run pad:manifest`.
- If `inspect:race-batch` fails, do not publish.
- If `odds.csv` is missing on Saturday, do not publish.
- Do not commit raw `.csv`, `.html`, or `.htm` files.
