# Odds Recovery: 2026-11-28

The morning refresh failed closed because Kyoto 11R had ten active odds rows
against the previous eleven-runner card. JRA's official card confirms number 9,
Nero Noir (horse ID 2024100638), was cancelled. Only that confirmed slot is
excluded from current inputs, with original numbers retained.

Source: https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202605071120261128/36

- The existing withdrawal-config mechanism is used; field-size checks are not relaxed.
- The odds verifier now honors TURF_MATRIX_RACE_CONFIG, matching the acquisition,
  pair-odds verifier and full-day snapshot runtime. Two regression cases prevent
  falling back to a different config's exclusions.
- One new capture covers 24 races and 337 active runners. Detailed specials:
  six races and 86 runners. Shared fields/indices/odds match between views.
- Completed public race selections and 1,022 pre-existing protected files remain
  unchanged. The missed 1R snapshot is not relabeled as an on-time success.
- 730 tests, integrity checks and Vite build pass. Production remains JV-Link
  with training, unchanged weights, and unchanged scheduled-task configuration.
- User approved correction, reacquisition, push and public verification.
