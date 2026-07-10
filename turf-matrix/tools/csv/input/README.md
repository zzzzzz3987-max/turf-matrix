# TURF MATRIX CSV input

Power Automate Desktop saves TARGET CSV files here.

## Files

| File | Timing | Role |
| --- | --- | --- |
| `all.csv` | Thursday | Main input |
| `odds.csv` | Friday | Value AI input |

## Rules

- `all.csv` is the primary TARGET export.
- `odds.csv` is added on Friday.
- Do not update production `week-data.json` until `odds.csv` exists and the weekly pipeline succeeds.
- Do not commit exported CSV files.
- `README.md` and `.gitkeep` stay managed by git.
