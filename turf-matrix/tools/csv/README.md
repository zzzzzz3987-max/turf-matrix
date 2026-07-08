# TURF MATRIX TARGET CSV export guide

This folder is the fixed landing zone for weekly TARGET frontier JV CSV exports.

## Fixed save location

```text
tools/csv/
```

Power Automate Desktop should always overwrite the files below in this folder.
Do not rename files per week.

## Required CSV files

| File | Source in TARGET | Purpose |
| --- | --- | --- |
| `shutuba.csv` | 出馬表 / 出馬表分析 CSV | Race and runner base data |
| `odds.csv` | オッズ CSV | Win odds and popularity for TM VALUE |

## Optional CSV files

| File | Source in TARGET | Purpose |
| --- | --- | --- |
| `supplement.csv` | 補完用CSV | Horse name, jockey, odds, popularity fallback |
| `training.csv` | 調教 CSV | Future training evidence |
| `pedigree.csv` | 血統 CSV | Future bloodline evidence |

Optional files are checked when present. Missing optional files do not stop the
weekly update.

## Power Automate Desktop order

1. Open TARGET frontier JV.
2. Confirm the latest JRA-VAN data is registered.
3. Select the target race date and target races.
4. Export the 出馬表 or 出馬表分析 CSV as `tools/csv/shutuba.csv`.
5. Export the オッズ CSV as `tools/csv/odds.csv`.
6. Export optional CSVs when available:
   - `tools/csv/supplement.csv`
   - `tools/csv/training.csv`
   - `tools/csv/pedigree.csv`
7. Run `tools/weekly-update.ps1`.

## Failure rules

The weekly update stops before touching `tools/week-data.json` when:

- `shutuba.csv` is missing.
- `odds.csv` is missing.
- Required CSVs were not updated today.
- Required CSVs are smaller than 1 KB.
- Required CSVs have fewer than 2 rows.

If a failure occurs, do not commit or push. Keep the previous production
`tools/week-data.json` online until the CSV export is fixed.
