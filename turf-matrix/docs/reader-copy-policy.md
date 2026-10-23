# Reader Copy

The reader layer changes explanations, not indices, odds, selections, or historical results.

- Evaluate the horse's own pre-race performances using finish, margin, corner positions, closing time, and matched historical race shape.
- Select a relevant performance from the preceding two years, including earlier races when their content is more informative than the latest result. Always show the year. Pair an older highlight with the latest performance, including a poor run.
- Treat sectional pace and front/rear outcome bias separately. Only a high-confidence, exactly matched outcome can substantiate a counter-bias performance. A quick final 600m alone does not establish a strong field, fastest finish, or graded-race ability.
- Use actual same-event clocks for opponent gaps. Never convert seconds to horse lengths. Unknown venues cannot establish a direct meeting.
- Make cautions conditional on the upcoming pace, observed position, distance change, surface change, draw zone, or layoff. Do not manufacture past traffic trouble, slow starts, effort levels, or wet-track ability.
- Straight Niigata 1000m races do not inherit corner positions or corner-race style claims.
- Omit unsupported statements instead of displaying internal missing-data messages. Do not manufacture a positive assessment when the recorded performance is weak.
- Keep the headline under 150 characters, supporting evidence under 200 total, and the caution under 160.

Run `node tools/analyze/audit-reader-copy.mjs` for the published detailed field. Supply a payload path to check another field, and an optional output directory to produce a per-horse review with source facts. The source payload must remain unchanged.
