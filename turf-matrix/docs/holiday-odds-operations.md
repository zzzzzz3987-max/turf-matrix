# Holiday Race-Day Odds Updates

Approved by the user on 2026-11-23 after the holiday Monday was not covered by
the weekend-only Windows triggers. This approval expands odds operation only;
it does not switch providers, remove training, or authorize subscription changes.

## Scheduling

- Keep the existing `TURF MATRIX Live Odds` and `TURF MATRIX Odds Watchdog` tasks.
  Preserve their Saturday/Sunday triggers and historical one-time exceptions.
- Add a weekday 08:00 start check to Live Odds and weekday 09:00-17:00 checks
  every five minutes to Watchdog. No additional task is needed.
- Live Odds first checks `tools/odds-race-day.mjs` against the prepared input
  root. The latest published/candidate date must equal today in Japan time, and
  the full-day signals must match that date and the detailed schedule.
- If no current-day data is prepared, return successfully before Git sync,
  acquisition or publication. A mismatched/incomplete current-day schedule is
  an error, not permission to use stale data.
- Watchdog retains its current-day and race-hours checks. Holidays are not
  assumed to be race days merely because they are public holidays. Prepared
  official race data, not the weekday, enables operation. This also covers
  Friday holidays and substitute weekday meetings without fixed date lists.

## Prerequisites And Limits

The normal race-day update still prepares JV-Link fields, history, slope/wood
training, full-day signals and detailed races before the day. These tasks do not
generate the next meeting's fields automatically or discover an unprepared race
calendar. The existing interactive-user login, network, JV-Link entitlement and
computer availability requirements remain.

Live Odds retains full-day refreshes before 1R and 6R and individual special-race
refreshes seven minutes before post time. A manual intraday refresh must not mark
missed morning or already-started special-race windows as completed prospectively.
Never rewrite frozen pre-odds archives to fit an intraday acquisition.

`tm-index` remains a separate monitoring workflow; this change does not edit its
schedule or instructions. Preserve the normal weekend monitoring.

## Verification

`node --test tools/intelligence/tests/odds-race-day.test.mjs` covers holiday
Monday/Friday, substitute Tuesday, weekends, non-race dates, Japan-time rollover,
latest-candidate selection, invalid fields and task wiring. The real Windows
runner is also smoke-tested with an empty input root: it skips successfully
without fetching odds or invoking Git.

When changing an installed task, export its XML first and modify only the trigger
list. Do not re-register over unrelated actions, credentials or settings. Private
installation evidence and before/after exports belong under `tools/pad-runtime/`.
