# Saturday Release: 2026-11-21

Prepared Nov20 JST for Kyoto and Fukushima only: 24 races / 347 runners.
Special detail: 6 races / 87 runners. Sunday and Monday are separate updates.

## Acquisition And Verification

- Production remains JV-Link with slope/wood training and unchanged weights.
- Current card and pedigree: 347 each; target past runs: 3,578.
- Raw training acquisition: 4,950 slope / 1,632 wood records.
- Same 0B31 acquisition feeds special and full-day views: 347 odds rows, no
  missing win odds; source timestamps Nov20 22:51-22:52 JST.
- Full-day conditions: selected 24, detected 24, active 24, missing 0.
- Bounded Nov14-Nov21 race-shape export: 72 races / 1,019 horses. Model history
  ends Nov15. Existing Nov8/14/15 archives/reviews and unrelated edits protected.
- Special/full shared scores, odds, public roles and fingerprints match for all
  87 detailed runners. Historical runs and training precede target race day.
- Fourteen existing shadow artifacts and initial pre-odds snapshot frozen.
- Reader-copy audit covers all 87 detailed runners. Genuine newcomers retain
  missing past-run evidence rather than fabricated history.
- Local UI checked at widths 320, 390 and 1440, including all six detailed
  races, horse-name visibility, contrast and navigation; no horizontal overflow.

## Narrow Operational Fixes

- Read JSON configs explicitly as UTF-8 in Windows PowerShell. Japanese
  withdrawal metadata previously prevented a new weekly acquisition from starting.
- Require copying `week-race-summary.json` into the isolated odds runner.
  A missing current summary caused Nov15 full-day conditions to map only the
  ten detailed races instead of all 36. This change does not retrospectively
  refresh Nov15 snapshots or claim those historical missing conditions recovered.
- Existing task schedules and weekend monitoring remain unchanged. No Monday
  task, provider switch, subscription or automated posting was introduced.

## Free-Source Trial

Private frozen baseline: 24 races / 347 runners, prepared but not acquired.
Actual new free full-field coverage: 0/24; slope/wood clock rows: 0.
JRDB's documented training endpoint is paid-member-only; KMY Keiba depends on
JRA-VAN/UmaConn. JRA's Fukushima Kinen page is a video announcement, not a
full-day clock feed. No production substitution and no raw trial publication.
Detailed evidence stays under the private dated `output/free-data-evaluation`
directory. Subscription expiry and renewal/cancellation remain unverified.

Publication is user-approved; X remains one draft post with one displayed
leader per special race and no changeable odds.
