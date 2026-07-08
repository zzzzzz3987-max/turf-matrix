# TURF MATRIX TARGET CSV export guide

This folder defines the weekly TARGET frontier JV CSV intake.

## Fixed save location

Power Automate Desktop must place exported CSV files in:

```text
tools/csv/input/
```

Use fixed file names. Do not add dates to file names.

## Required CSV files

| File | Save path | Source in TARGET | Purpose |
| --- | --- | --- | --- |
| `shutuba.csv` | `tools/csv/input/shutuba.csv` | 出馬表 / 出馬表分析 CSV | Race and runner base data |
| `odds.csv` | `tools/csv/input/odds.csv` | オッズ CSV | Win odds and popularity for TM VALUE |

The weekly update stops when either required file is missing, stale, too small,
or has fewer than 2 rows.

## Optional CSV files

| File | Save path | Source in TARGET | Purpose |
| --- | --- | --- | --- |
| `supplement.csv` | `tools/csv/input/supplement.csv` | 補完用CSV | Horse name, jockey, odds, popularity fallback |
| `training.csv` | `tools/csv/input/training.csv` | 調教 CSV | Future training evidence |
| `pedigree.csv` | `tools/csv/input/pedigree.csv` | 血統 CSV | Future bloodline evidence |

Optional files are checked when present. Missing optional files only produce a
warning and do not stop the weekly update.

## Friday operation

TARGET data is updated on Friday. After the Friday update:

1. Open TARGET frontier JV.
2. Register or confirm the latest JRA-VAN data.
3. Select the target race date and target races.
4. Export 出馬表 / 出馬表分析 CSV to `tools/csv/input/shutuba.csv`.
5. Export オッズ CSV to `tools/csv/input/odds.csv`.
6. Export optional CSVs to `tools/csv/input/` when available.
7. Run `tools/weekly-update.ps1`.

## Power Automate Desktop order

1. Open TARGET frontier JV.
2. Confirm the latest Friday data update is complete.
3. Delete old files in `tools/csv/input/`.
4. Export `shutuba.csv`.
5. Export `odds.csv`.
6. Export optional CSVs if available.
7. Run:

```powershell
powershell -ExecutionPolicy Bypass -File tools/weekly-update.ps1
```

## Failure rules

The weekly update stops before publishing new data when:

- `tools/csv/input/shutuba.csv` is missing.
- `tools/csv/input/odds.csv` is missing.
- Required CSVs were not updated today.
- Required CSVs are smaller than 1 KB.
- Required CSVs have fewer than 2 rows.

`npm run generate-week` writes `tools/week-data.next.json` first. Existing
`tools/week-data.json` must stay unchanged until CSV validation, JSON generation,
and build all succeed.
