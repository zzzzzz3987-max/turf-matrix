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
