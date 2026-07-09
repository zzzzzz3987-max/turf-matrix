# TURF MATRIX preodds workflow

This workflow supports Thursday preparation before odds are available.

For the Power Automate Desktop recording procedure, use:

```text
docs/PAD_TARGET_EXPORT.md
```

## Goal

Import `all.csv` and optional training HTML first, then add `odds.csv` on
Friday and run the production weekly update.

Thursday:

```text
TARGET all.csv / optional training HTML
  -> detect HTML
  -> generate week-data.preodds.json
  -> no production publish
```

Friday:

```text
Add tools/csv/input/odds.csv
  -> validate CSV
  -> generate week-data.next.json
  -> build
  -> promote week-data.json
  -> commit / push
```

## Generated file

The pre-odds output is:

```text
tools/week-data.preodds.json
```

It is ignored by git and must not be used as the production data file.

## Input separation

Main preodds input:

- `tools/csv/input/all.csv`

Optional training HTML:

- `tools/target-html/input/training-slope.html`
- `tools/target-html/input/training-wood.html`

Non-preferred optional HTML:

- `racecard.html`
- `pedigree.html`
- `form.html`

Pedigree, recent form, ZI, body weight, and running style should come from
`all.csv`. Training is the only HTML-assisted input for now.

## Odds-dependent fields

These fields are not calculated before `odds.csv` is available:

- `odds`
- `popularity`
- `EV`
- `Value AI`
- `TM VALUE`

In preodds output they stay:

```json
{ "status": "未取得" }
```

Do not use dummy odds. Do not use approximate odds. Do not run production
`weekly:update` until `odds.csv` exists.

## Commands

Thursday rehearsal:

```bash
npm run detect:html
npm run generate:preodds
npm run build
```

Friday production:

```bash
npm run validate:csv
npm run weekly:update
```

## HTML parser scope

The current preodds workflow only detects HTML files and inspects their
encoding/table shape. It does not connect HTML data to production
`week-data.json`.

Standard parser candidates:

- `training-slope.html`
- `training-wood.html`

`racecard.html`, `pedigree.html`, and `form.html` remain optional research
inputs, not standard pipeline inputs.
