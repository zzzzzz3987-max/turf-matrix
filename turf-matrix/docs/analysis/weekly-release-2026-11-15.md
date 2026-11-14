# Sunday Release: 2026-11-15

## Production Inputs

- Official meetings: Tokyo, Kyoto and Fukushima; 36 races.
- Active field: 504 horses; special-race detail: 10 races and 140 horses.
- JV-Link acquisition retained slope/wood training, history and pedigree. No provider or index-weight changes.
- One shared full-day odds capture: 2026-11-14 22:30 JST, 504 actual horse-odds rows. Missing prices were not estimated.
- Shared special/full-day scores, odds, value and public roles matched for all 140 horses.

## Official Withdrawal

Kyoto 10R number 6, Artless Mind (2022105987), is marked cancelled on the [official JRA card](https://app.jra.jp/JRADB/accessD.html?CNAME=sw01ddd0108202605041020261115%2F5E), observed at 2026-11-14T13:34:03.476Z.

The initial registered field was 505 horses, including 141 in the special races. Only this confirmed non-starter was removed from current-day inputs. Original source backups and historical records were retained privately. Original horse numbers were not shifted.

The current-race parser now accepts explicitly declared withdrawn slots. Default contiguous-number validation remains enabled; undeclared missing slots, duplicates, invalid exclusions and oversized fields still fail. The day config declares only Kyoto 10R number 6.

## Verification Before Push

- Data integrity and reader-copy audits passed.
- 698 intelligence tests passed, including four withdrawal tests.
- Production build passed; live data version `8994d688845c1e26`.
- Desktop/mobile widths 1440, 390 and 320: no horizontal overflow. All ten special-race horse pickers, verdict navigation, visible horse names and contrast checks passed.
- Initial pre-odds archive SHA-256: `b7ebaabc07bbf86c90c5f725652427a9407b0055a0c83b24a15f03aa3cc8427f`.
- Fourteen existing shadow artifacts frozen before racing.
- Protected November 14/8 archives, November 14 result summaries and three unrelated development files remained unchanged.

Private free-source trials are excluded from this release. Production remains JV-Link with training. No subscription, scheduled-task or monitoring settings changed. Public deployment and dedicated-runner synchronization are checked separately after push.
