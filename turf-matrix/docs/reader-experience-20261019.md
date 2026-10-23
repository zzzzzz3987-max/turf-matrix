# Reader Experience Integration

Local integration only. No deployment, push, data generation, odds fetching, runner edits or scoring changes.

## Included
- Black, white and silver palette with ice-blue interaction and evaluation bars.
- Existing count-up timing and multicolor underline on the featured index.
- Special/all-race list, venue filter, chronological order and compact rows.
- Sticky horse selector, previous/next controls, 90dvh accessible modal horse list.
- Reader-oriented assessment, supporting results and substantiated cautions.
- Direct meetings match date, venue, surface, distance and race identity. Time differences remain seconds; no guessed horse lengths.
- Existing live-data provider and refresh mechanism remain authoritative.
- Battle race, daily top horses, public conclusion, tickets, pedigree, training, advanced evidence and glossary remain accessible.

The loaded production payload contains 11 detailed races / 136 horses; the all-race signal feed contains 36 summaries. Unlike the separate design preview, this integration does not import the untracked 450-horse all-race candidate. Summary-only rows remain summaries, as in the original application.

Specialized legacy evidence panels are retained under per-horse advanced disclosure; this change does not rewrite all of those specialist narratives. The new reader-facing analysis uses the new copy rules.

## Checks
- Vite production build passed.
- Intelligence suite: 643 passed, including five reader-copy tests.
- Data integrity: 11 races / 136 horses, zero odds join or Value display mismatches.
- Browser verified at 320, 390 and 1440 CSS pixels: no horizontal overflow.
- Venue filter: 36 all-venue rows / 12 Tokyo rows, chronological order.
- Next horse, modal selection, analysis opening and specialist disclosure checked.
- Browser error log empty.

## Restore
Original source snapshots are outside the repository at:
`C:/Users/R/Documents/Codex/2026-07-05/turf-matrix-lead-frontend-engineer-ui/output/before-production-redesign-20261019/`

Restoring its App.jsx to src/App.jsx returns the prior entry points and removes the new stylesheet import. The snapshot index.css is unchanged by this integration. Preserve unrelated review-script changes. No reset or checkout of the whole worktree is needed.
