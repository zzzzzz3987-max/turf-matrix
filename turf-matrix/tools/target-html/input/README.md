# TURF MATRIX TARGET HTML input

Power Automate Desktop saves TARGET HTML files here.

## Files

| File | Role |
| --- | --- |
| `training-slope.html` | Slope training input |
| `training-wood.html` | Wood/CW/D training input |

## Pedigree HTML

Horse-level four-generation pedigree HTML files are saved under:

```text
tools/target-html/input/pedigree/
```

File names do not need to be changed.

Examples:

- `ヤマニンブークリエ.html`
- `リカンカブール.html`
- `メリオーレム.html`

## Rules

- Raw HTML files are ignored by git.
- Do not commit exported TARGET HTML.
- `README.md` and `.gitkeep` stay managed by git.
