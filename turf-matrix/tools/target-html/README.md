# TURF MATRIX TARGET HTML intake research

Sprint 1.8.5 defines a safe landing zone for TARGET frontier JV HTML exports.
This is research only. HTML files are optional and are not connected to
`week-data.json` yet.

## Power Automate Desktop operation

The concrete PAD recording sheet is maintained here:

```text
docs/PAD_TARGET_EXPORT.md
```

Use it as the source of truth for fixed save locations, fixed file names,
Thursday preodds preparation, and Friday production update commands.

## Fixed input folder

Place TARGET HTML exports here:

```text
tools/target-html/input/
```

Do not commit raw HTML files. TARGET/JRA-VAN source HTML may contain licensed raw
data, so `tools/target-html/input/*.html` and `*.htm` are ignored by git.

## Fixed normalized HTML names

Power Automate Desktop should overwrite these fixed file names every week:

```text
tools/target-html/input/racecard.html
tools/target-html/input/pedigree.html
tools/target-html/input/form.html
tools/target-html/input/training-slope.html
tools/target-html/input/training-wood.html
```

Do not include dates, race names, or Japanese race titles in the saved file
names. The fixed names make the future parser deterministic.

## Current confirmed HTML exports

The following files have been identified as useful parser candidates:

| Current export example | Future normalized name | Parser candidate | Future use |
| --- | --- | --- | --- |
| `七夕賞_出馬表.html` | `racecard.html` | racecard parser | Runner profile input |
| `七夕賞_血統.html` | `pedigree.html` | pedigree parser | Blood AI input |
| `七夕賞_前走①.html` | `form.html` | form parser | Form AI input |
| `七夕賞_調教①.html` | `training-slope.html` | slope training parser | Training AI input |
| `七夕賞_調教②.html` | `training-wood.html` | wood/CW training parser | Training AI input |

The current file names may stay as exported during research. Future automation
can rename or map them to the normalized names above.

## Expected encoding

TARGET HTML may be Shift_JIS / CP932. A future parser should read files as:

1. UTF-8 when a UTF-8 BOM or valid UTF-8 is detected.
2. Shift_JIS / CP932 fallback when UTF-8 decoding contains replacement
   characters.

Do not manually convert files during the first parser investigation. Keeping the
raw export helps identify the correct encoding and table structure.

## Candidate extraction fields

### Racecard HTML

Potential fields:

- 馬番
- 馬名
- 性齢
- 騎手
- 斤量
- 調教師
- 馬主
- 生産者
- 毛色
- 誕生日

Future targets:

- `horses[].number`
- `horses[].name`
- `horses[].jockey`
- `horses[].raw.weight`
- `horses[].raw.owner`
- `horses[].raw.breeder`
- `horses[].raw.color`
- `horses[].raw.birthDate`

### Pedigree HTML

Potential fields:

- 父
- 母
- 母父

Future targets:

- `analysis.pedigree.lines`
- `analysis.factorsDetail.blood`
- `horses[].raw.sire`
- `horses[].raw.dam`
- `horses[].raw.damSire`

### Form HTML

Potential fields:

- ZI
- 近走距離
- 脚質
- 着順

Future targets:

- `analysis.factorsDetail.form`
- `analysis.factorsDetail.ability`
- `analysis.factorsDetail.pace`
- `horses[].raw.pastRuns`
- `horses[].raw.runningStyle`

### Training slope HTML

Potential fields:

- 坂路時計
- Lap
- 調教師
- 日付

Future targets:

- `analysis.trainingEval`
- `analysis.factorsDetail.training`
- `horses[].raw.trainingSessions`
- `horses[].raw.trainer`

### Training wood/CW/D HTML

Potential fields:

- ウッド / CW / D
- 10F to 1F
- Lap
- コース
- 回り
- 日付

Future targets:

- `analysis.trainingEval`
- `analysis.factorsDetail.training`
- `horses[].raw.trainingSessions`

## Sprint 1.8.5 rules

- HTML is optional.
- Missing HTML must not fail `npm run validate:csv`.
- Missing HTML must not fail `npm run generate-week`.
- Missing HTML must not fail `npm run build`.
- HTML must not be connected to `week-data.json` in this sprint.
- Do not use HTML to fill dummy data.
- Keep `shutuba.csv` and `odds.csv` as the only required weekly inputs.

## Future parser structure

Candidate files for a future sprint:

```text
tools/target-html/detect-html-inputs.mjs
tools/target-html/parse-racecard.mjs
tools/target-html/parse-pedigree.mjs
tools/target-html/parse-form.mjs
tools/target-html/parse-training-slope.mjs
tools/target-html/parse-training-wood.mjs
```

The first implementation should only detect files, encoding, row/table counts,
and candidate headers. Data connection to Intelligence Layer should happen in a
later sprint.
