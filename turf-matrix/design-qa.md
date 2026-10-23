# Reader Experience QA

Source: approved mobile dark preview, including opponent-copy-mobile.png and horse-picker-raised-mobile.png under output/dark-motion-preview.
Implementation: http://127.0.0.1:4202/ (production build of actual application).

## Evidence
Source and implementation screenshots were opened together. Source capture contains the 390x844 iframe within the desktop stage; implementation capture is the actual 390x844 browser viewport. Stage padding is excluded from judgment.

Implementation screenshots are in output/before-production-redesign-20261019: updated-analysis-mobile.png and updated-home-desktop.png.

## Iteration
- P1: original Tailwind root background overrode dark theme, reducing contrast. Fixed explicit application-root background and foreground; rechecked after rebuild.
- P2: small-field frame allocation inherited a preview error. Corrected single-horse frames for fields of eight or fewer.
- P2: missing odds could be rendered as zero via Number(null). Changed to finite-value-only odds formatting.
- P2: duplicate full race page in advanced disclosure. Replaced with per-horse specialist disclosure while retaining live role/ticket conclusion.

## Required Surfaces
- Typography: Japanese names and evidence wrap without clipping; actual application font retained.
- Layout: flat sections and compact race rows match the approved direction. Sticky selector and modal verified on mobile.
- Colors: white scores, silver controls, ice-blue links/bars and actual frame colors. Header and glossary themed consistently.
- Images: no imagery introduced; icons use existing Lucide package.
- Content: actual provider data, not static preview data. Structured result and clock comparisons retained; unsupported explanations omitted in new reader copy. Specialist legacy evidence remains available separately.

320px and 1440px overflow checks passed; 390px analysis and horse selection inspected. Venue filtering, tab switching, next horse, modal selection and evidence disclosure verified. Build, 643 tests and data integrity passed. Browser error log empty.

P3: some specialist evidence narratives still use the existing technical phrasing; separate reader-facing summary has been updated. Desktop follows the same unframed data layout, not a distinct editorial layout.

final result: passed
