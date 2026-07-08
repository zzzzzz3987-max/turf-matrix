# TURF MATRIX Sprint 1.7 TARGET CSV / PAD operation guide

This folder defines the weekly CSV intake for TURF MATRIX.

TARGET CSV export is the responsibility of Power Automate Desktop or manual
operation. Codex and the web app only validate the exported files and run the
weekly update pipeline.

## Fixed input folder

Power Automate Desktop must place TARGET exports in this folder:

```text
tools/csv/input/
```

Use fixed file names. Do not add dates, race names, or venue names to file
names.

## Required files

| File | Save path | TARGET source | Purpose |
| --- | --- | --- | --- |
| `shutuba.csv` | `tools/csv/input/shutuba.csv` | 出馬表 / 出馬表分析 CSV | Race and runner base data |
| `odds.csv` | `tools/csv/input/odds.csv` | オッズ CSV | Win odds and popularity for TM VALUE |

The weekly update must stop if either required file is missing, stale, too
small, or has fewer than 2 rows.

## Optional files

| File | Save path | TARGET source | Purpose |
| --- | --- | --- | --- |
| `supplement.csv` | `tools/csv/input/supplement.csv` | 補完用CSV | Horse name, jockey, odds, popularity fallback |
| `training.csv` | `tools/csv/input/training.csv` | 調教 CSV | Future training evidence |
| `pedigree.csv` | `tools/csv/input/pedigree.csv` | 血統 CSV | Future bloodline evidence |

Optional files are checked when present. Missing optional files only produce a
warning and do not stop the weekly update.

## Friday operation

TARGET data is updated on Friday. After the Friday update, run the PAD flow or
perform the same steps manually.

1. Open TARGET frontier JV.
2. Confirm the latest JRA-VAN data is registered.
3. Select the target race date.
4. Select the target races for the week.
5. Export 出馬表 / 出馬表分析 CSV.
6. Save it exactly as `tools/csv/input/shutuba.csv`.
7. Export オッズ CSV.
8. Save it exactly as `tools/csv/input/odds.csv`.
9. Export optional CSV files when available.
10. Run `npm run weekly:update` from the repository root.

Repository root:

```text
C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix
```

## Power Automate Desktop flow

Recommended flow name:

```text
TURF MATRIX Weekly TARGET CSV Export
```

Recommended variables:

```text
RepoRoot = C:\Users\R\Documents\Codex\2026-07-05\turf-matrix-lead-frontend-engineer-ui\work\turf-matrix\turf-matrix
InputDir = %RepoRoot%\tools\csv\input
ShutubaCsv = %InputDir%\shutuba.csv
OddsCsv = %InputDir%\odds.csv
WeeklyCommand = npm run weekly:update
```

PAD operation order:

1. Launch TARGET frontier JV.
2. Wait until TARGET is visible.
3. Confirm the Friday data update is complete.
4. Delete old CSV files in `tools/csv/input/`.
5. Open the 出馬表 or 出馬表分析 CSV export screen.
6. Export the selected race scope to `shutuba.csv`.
7. Open the オッズ CSV export screen.
8. Export the selected race scope to `odds.csv`.
9. Confirm both required files exist.
10. Run PowerShell in `RepoRoot`.
11. Execute:

```powershell
npm run weekly:update
```

Alternative direct command:

```powershell
powershell -ExecutionPolicy Bypass -File tools/weekly-update.ps1
```

## Manual confirmation points

Before running `weekly:update`, confirm:

- `tools/csv/input/shutuba.csv` exists.
- `tools/csv/input/odds.csv` exists.
- Both required files were updated today.
- Both required files are larger than 1 KB.
- Both required files have at least 2 rows.
- The target race date in `tools/csv-config.json` is correct.
- The featured race in `tools/csv-config.json` is correct for the week.

## Expected behavior

When required CSV files are missing:

- `npm run validate:csv` exits with a non-zero code.
- `npm run generate-week` exits with a non-zero code.
- `npm run weekly:update` stops before build.
- `tools/week-data.next.json` is not created.
- Existing `tools/week-data.json` is not changed.
- No commit or push is performed.

When required CSV files are valid:

- `npm run validate:csv` passes.
- `npm run generate-week` creates `tools/week-data.next.json`.
- `npm run weekly:update` temporarily promotes the next data for build.
- `npm run build` runs.
- Only after build succeeds, `tools/week-data.json` remains updated.
- Git commit and push are performed only when data changed.

## Recovery steps

If CSV validation fails:

1. Do not edit `tools/week-data.json`.
2. Re-export `shutuba.csv` and `odds.csv` from TARGET.
3. Confirm they are saved in `tools/csv/input/`.
4. Run `npm run validate:csv` again.
5. Run `npm run weekly:update` only after validation passes.

If JSON generation fails:

1. Keep the existing `tools/week-data.json`.
2. Check `tools/conversion-log.txt` if it exists.
3. Confirm required columns exist in the TARGET exports.
4. Re-export CSV files and retry.

If build fails:

1. `weekly-update.ps1` restores `tools/week-data.json` from backup.
2. Do not push.
3. Fix the cause, then run `npm run weekly:update` again.
