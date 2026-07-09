# TURF MATRIX preodds workflow

This workflow supports Thursday preparation before odds are available.

## Goal

Import everything that does not depend on odds first, then add `odds.csv` on
Friday and run the production weekly update.

Thursday:

```text
TARGET HTML / non-odds CSV
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

Sprint 1.8.5 and the preodds workflow only detect HTML files and inspect their
encoding/table shape. They do not connect HTML data to `week-data.json`.

Future parser candidates:

- `racecard.html`
- `pedigree.html`
- `form.html`
- `training-slope.html`
- `training-wood.html`
