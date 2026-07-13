# Multi-race TARGET input

Create one folder per race. The folder name is only a stable bundle ID; race facts are read from TARGET CSV.

```text
tools/csv/input/races/
  2026-07-19-hakodate-11R/
    current-race-detail.csv
    all.csv
    odds.csv
  2026-07-19-kokura-11R/
    current-race-detail.csv
    all.csv
    odds.csv
```

- `current-race-detail.csv`: current race and runners. Required on Thursday.
- `all.csv`: past-run source for the same runners. Required on Thursday.
- `odds.csv`: win odds and popularity. Added on Friday or race day.
- Do not combine different races in one bundle.
- Do not commit TARGET exports.

Run `npm run inspect:race-batch` after PAD export. A bundle is `previewReady` after the first two CSV files pass and `productionReady` only after matching odds are present.

## 2026-07-19 operating target

The planned Sunday scope is 10 bundles. Confirm the final race card in TARGET after Thursday's publication; the CSV remains the source of truth.

| Track | Race | Planned race |
| --- | ---: | --- |
| Fukushima | 9R | 南相馬特別 |
| Fukushima | 10R | 猪苗代特別 |
| Fukushima | 11R | 福島テレビ賞 |
| Kokura | 9R | 不知火特別 |
| Kokura | 10R | 宮崎ステークス |
| Kokura | 11R | 小倉記念 GIII |
| Kokura | 12R | 筑紫特別 |
| Hakodate | 9R | かもめ島特別 |
| Hakodate | 10R | 駒場特別 |
| Hakodate | 11R | 函館2歳ステークス GIII |

Recommended bundle IDs use ASCII and stay unchanged through the week, for example `2026-07-19-kokura-11R`.

## Batch workflow

```powershell
npm run inspect:race-batch
npm run generate:race-batch
npm run build:race-batch
npm run dev:race-batch
```

`generate:race-batch` writes ignored intermediate JSON only. It never overwrites `tools/week-data.json`. The batch candidate keeps TM INDEX and AI commentary pending until the Intelligence Layer is connected with race-specific context.
