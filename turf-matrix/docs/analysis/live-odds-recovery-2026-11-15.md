# Live Odds Recovery: 2026-11-15

User-approved manual odds refresh and public release after the missed 1R snapshot.

- One verified full-day capture: 36 races, 504 horses; future-race odds updated at 11:08 JST. Completed pools retain the provider's closed status and final update times.
- Special detail remains 10 races and 140 active horses. Kyoto 10R number 6 remains officially withdrawn.
- Original pre-odds/shadow archives, historical data and unrelated development changes are preserved.
- Production provider and index weights remain unchanged, with slope/wood training retained.

## Necessary Recovery Fixes

The C# acquisition config reader formerly searched every JSON string for race bundle patterns. A withdrawal-map key was consequently acquired again, giving 37 requests and duplicate Kyoto 10R rows. Verification blocked that attempt before archiving or publication. The reader now parses the JSON `bundles` array only and rejects duplicate, stale, invalid and count-mismatched entries. A real compiled-assembly regression test makes no JV-Link calls.

The automatic full-day runtime builder also now carries the explicitly declared withdrawn slots from the same-day full-field config into regeneration. Invalid or stale declarations fail closed. This does not change snapshot times or scheduled-task configuration.

The same full-day runtime is now explicitly used for acquisition and condition extraction, rather than falling back to a special-only acquisition config. Condition extraction filters a mixed-weekend summary to the target date and honors the explicit runtime, so non-special races keep current official going too.

## Verification

703 intelligence tests and the production build passed. Desktop/mobile checks cover widths 320, 390 and 1440 and all ten special-race horse pickers.

The refreshed special/full-day field is checked against the same raw acquisition, including unchanged base indices, withdrawal handling and protected archives. Current official going changes the existing going adjustment for 64 horses; these are not weight or formula changes. Public byte-level payload matching and a restarted existing runner are checked after push. The missed before-1R record must remain missed; this later refresh must not be relabelled as an on-time morning run. The special-race processed flags remain untouched.
