# Holiday Release: 2026-11-23

Prepared Nov22 JST for Tokyo and Fukushima: 24 races / 359 runners.
Special detail: 6 races / 87 runners, including Tokyo Sports Hai Nisai Stakes.
The official holiday meeting is independent of the weekend-only task schedule.

## Production Verification

- Production remains JV-Link with slope/wood training and unchanged weights.
- Full-day candidate includes 3,619 prior runs, 5,451 slope and 1,697 wood sessions.
  Every historical feature precedes the target day; 43 newcomers retain empty histories.
- The same verified 0B31 capture feeds both views: 359 valid win-odds rows,
  acquisition Nov22 20:28 JST, no missing win odds.
- Pair odds cover 48 race/types and 5,080 combinations. Unvoted combinations
  remain unavailable, never estimated; validation has warnings but no failures.
- Conditions cover all 24 races. All 87 shared horses match in scores, odds,
  public roles and engine fingerprint.
- Reader-copy evidence is present for 87/87 special horses and 316/359 all-race
  horses; no historical performance is invented for debut horses.
- Fourteen established shadow artifacts and the initial pre-odds snapshot frozen.
- 720 local tests, integrity checks and Vite build pass. UI widths 320, 390 and
  1440 pass, including all six detailed-race pickers and verdict navigation.
- 970 protected historical archives, shadows, reviews and unrelated edits retain
  their prior hashes, including the finalized Nov22 results.
- No qualifying battle-race snapshot at this capture; Nov22's plan is not reused.
- New-day baseline-missing warnings in the odds-only delta check refer to the
  preceding day's disjoint field, not observed index changes. The independent
  target-day full/detail identity and score checks pass.

## Free-Source Status

Private baseline prepared for 24 races / 359 horses; actual new free-source
acquisition is 0/24 races, 0/359 horses and zero slope/wood clocks. A newly inspected
GitHub official-JRA pipeline is an unverified adapter candidate, not a training-feed
replacement or permission to publish source data. Private controlled training
ablation changes 207 indices and 2 leaders, not a proof of equivalent accuracy.
No production cutover, paid replacement, cancellation or task changes.

## Publication Boundary

Commit/push explicitly requested. X is draft only, one displayed leader per special
race, omitting changeable forecast odds. Deployment/runner checks are recorded
privately after publication. Monday is outside both existing weekend task triggers;
this release does not enable Monday automatic odds updates or heartbeat monitoring.
