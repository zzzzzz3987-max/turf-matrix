# Automatic Non-Starter Handling

The existing odds runner fetches a complete JV-Link `0B14` snapshot before each
`--odds-only` acquisition. AV records authorize cancellations (`1`) and exclusions
(`2`). A read error, timeout or invalid record fails acquisition; an incomplete
snapshot never means that a runner has been reinstated.

## Validation And Publication

- Bind the date, venue, meeting, race, horse number and horse name to the original
  current-race card and same-day meeting summary.
- Build ignored effective configs in `tools/pad-runtime`. Do not edit the original
  cards or the tracked race config. Use exact active horse-number sets in odds
  verification, full-race generation and detailed special-race generation.
- Replace previous AV information on every fetch, including a complete empty
  snapshot. Do not accumulate cancellations across snapshots or dates.
- Retain original horse numbers. Unexplained missing runners, mismatched names,
  stale snapshots (over ten minutes), duplicate slots and invalid identities fail
  closed. Do not infer a cancellation from missing odds.
- The compatibility path for previously hand-filtered cards requires the saved,
  independently confirmed identity. If that cancellation is later revoked, obtain
  an original card again; the runner stops instead of inventing the missing row.

Raw evidence: ignored `data/target/race-withdrawals.latest.json`, including source,
generation time, announcement time, reason and base64 AV record. Effective configs
carry the snapshot SHA-256. The snapshot is not a separately published feed.

Standalone `capture-odds.ps1` validates with the effective config and restores its
caller's environment. Its effective config is
`tools/pad-runtime/withdrawal-acquisition-runtime.json`; subsequent manual
normalization must explicitly use that config. The automatic updater wires the
effective full-race and special-race configs itself.

## Verification

`node --test tools/intelligence/tests/*.test.mjs` includes AV byte-layout/encoding
fixtures, incomplete-read failures, cancellation/exclusion, revocation, card
identity checks, source preservation and exact active-slot odds checks. The C#
fixture test compiles in an isolated intermediate/output path without calling
JV-Link.

The 2026-11-28 live acquisition confirmed one AV cancellation: Kyoto 11R, horse 9.
It verified 24 races using the effective config. Revocations, multiple exclusions
and malformed data are fixture-tested, not claimed as live observations.

No index weights, training inputs, task definitions or seven-minute scheduling
semantics are changed. A full-day refresh does not complete special-race windows.

## Primary Specification

- [JRA-VAN JV-Data 4.9.0.1](https://jra-van.jp/dlb/sdv/sdk/JV-Data4901.pdf):
  AV format 103 and the `0B14` data specification. Snapshot notifications can be
  withdrawn; use each complete acquisition as the replacement state.
- [JRA-VAN developer clarification](https://developer.jra-van.jp/t/topic/1167).
