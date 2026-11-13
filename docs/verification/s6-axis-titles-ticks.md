# S6 axis titles and ticks

## §0 baseline

Local `origin/main` verified as `2e17f66b632c160a9933cd7ab93c083e8f80f672`, using Cinder's authorized pre-fetch. Branch: `fix/s6-axis-titles-ticks`. No additional fetch required by the brief. Before source edits, the approved standalone commands ran unsandboxed: `npm test` passed **224/224**, including the spawn-bound template generator, and sweep **ALL 72 OK**; `npm run test:browser` passed **220** in 6.0m. No environmental failures are counted as passes or partial suite results.

At 1280×800, edit/open reproduces all four over-width titles: starter 311 and City 311 each **223.2px / 196px SVG**, overdose rolling rate **199.1 / 196**, overdose substances **199.0 / 196**. Closed palette clears those four historical width failures. The starter's actively-homeless title also has insufficient left margin for its four-digit numeric Y ticks; multiline time ticks require more bottom space.

## Visual inspection of the larger candidates

Historical census candidates were 86 open / 59 closed. The fresh SVG-only probe at this branch point finds **62 open / 48 closed** intersections with both box dimensions above 4px. This is a different, explicitly limited probe: it excludes HTML legends, editor controls and tile titles; nominal 4px intersections can exceed 4 numerically because of fractional geometry. These counts are candidates, not painted-fault counts. Inspection used 2× tile screenshots in both palette states on every candidate-bearing Plot tile touched by this shared-axis change.

| Tile(s) | Painted inspection |
|---|---|
| CCBHC remission by quarter; overdose substances by year | Open: adjacent rotated tick glyphs collide. Closed: their axis-aligned boxes intersect, but painted diagonal labels separate. Fixed open behavior by rotating crowded ticks vertically. |
| Sales pipeline stages | First rotated stage label clips the left edge (clearly open; minimal edge clearance closed). Large pairwise diagonal boxes are artifacts rather than proof of paint collisions. Vertical labels remove the clipping and overlapping boxes. |
| CoC exits: category and adjacent value labels | Bounding boxes overlap; the painted glyphs remain separated. Fractional ~4px value-label intersections belong to the classified touch class. |
| CCBHC PHQ bands; community factors | Tall category-label boxes overlap; painted rows remain separated. |
| CoC equity facets; program attainment facets | Diagonal tick boxes overlap each other and/or the bottom zero tick box; screenshots show separate painted glyphs. |
| Other chart tiles in the starter and 11 templates | Fresh probe found no larger candidate intersections. |

No inspected real painted collision is intentionally left. This classification does not recast the historical 3–4px touch class as faults. The head guard uses 4.1px to absorb subpixel rounding of a nominal 4px touch.

## Implementation and review judgments

Axis titles wrap on word boundaries at 13px. Long unbroken units break without ellipsis; text is retained. Title margins grow, four-digit Y ticks receive measured horizontal room, and multiline date ticks receive bottom room. Bottom categorical labels that outgrow their slot rotate to −90° with sufficient bottom margin, while labels that fit remain horizontal. Continuous numeric/time tick selection remains Plot's observable behavior; no thinning algorithm is presumed.

Plotting area and row spacing are preserved or enlarged, rather than consumed by the new margins. Tight fixed tiles may therefore need vertical scrolling through the existing `.tile-chart` overflow area. This is an explicit review tradeoff; template positions, tile sizes and data are unchanged. S5's panel width/height and keyboard-scroll tests remain in the full browser suite.

Compose follows the S4/S5 canvas simulation, and both palette widths are forced in each mode. Present/open deliberately overrides the normally hidden palette. The new browser test exercises all 72 starter/template × mode × palette combinations, records SVG scale domains, actual tick label strings and transforms, checks clipping/font size/intersections, and compares ordinal tick membership with domain order (existing shortened labels must match their domain member's prefix). Counts alone are not used as proof of membership. An independent read-back of the captured head artifact found **138 ordinal axis/domain observations, zero membership mismatches**. Continuous tick labels and domains are retained in the measurement artifact for inspection.

## Per-tile title measurements

Values are **title width / SVG width**, base edit → head. Head uses the maximum title width and minimum SVG width across edit/compose/present for each palette, so it reports the limiting geometry; individual states are in `output/s6-axis-titles-ticks/s6-final-measurements.json`. All measured head titles fit. Tiles with no axis title still receive tick/clipping checks.

| Template · tile · axis | Open: base → head (px) | Closed: base → head (px) |
|---|---|---|
| Starter · 311: closures trail openings · Y | 121.5/196.0 → 121.5/194.0 | 121.5/256.0 → 121.5/254.0 |
| Starter · Homeless: peak 1,709, falling · Y | 170.4/196.0 → 107.7/194.0 | 170.4/256.0 → 170.4/254.0 |
| Starter · 311 medians beat every target · X | 223.2/196.0 → 134.1/194.0 | 223.2/256.0 → 167.0/254.0 |
| Homeless system performance (CoC) · 4 in 10 exits went to housing · X | 101.5/280.7 → 101.7/278.0 | 101.5/360.7 → 101.7/358.0 |
| Behavioral health quality (CCBHC) · 7 of 10 meet benchmark · X | 145.2/196.0 → 145.2/194.0 | 145.2/256.0 → 145.2/254.0 |
| Behavioral health quality (CCBHC) · DEP-REM-6 rose at Downtown and Riverbend after Jul 2025 · Y | 180.9/196.0 → 131.5/194.0 | 180.9/256.0 → 180.9/254.0 |
| Behavioral health quality (CCBHC) · Up to a third never get a 6-month PHQ-9 · X | 135.2/196.0 → 135.2/194.0 | 135.2/256.0 → 135.2/254.0 |
| Health center quality (UDS) · All four headline measures improved every year · Y | 143.4/280.7 → 143.7/278.0 | 143.4/360.7 → 143.7/358.0 |
| Health center quality (UDS) · Beats national on 5 of 10 · X | 277.4/280.7 → 178.9/278.0 | 277.4/360.7 → 278.1/358.0 |
| Health center quality (UDS) · Medicaid and uninsured patients are two-thirds of the panel every year · Y | 96.1/280.7 → 96.4/278.0 | 96.1/360.7 → 96.4/358.0 |
| Overdose & SUD community surveillance · Down from the 56.2 peak after naloxone · Y | 199.1/196.0 → 118.0/194.0 | 199.1/256.0 → 199.1/254.0 |
| Overdose & SUD community surveillance · Fentanyl drives the rise; xylazine appears from 2023 · Y | 199.0/196.0 → 142.4/194.0 | 199.0/256.0 → 199.0/254.0 |
| Overdose & SUD community surveillance · Ten highest state rates · X | 116.4/196.0 → 116.4/194.0 | 116.4/256.0 → 116.4/254.0 |
| Community health by place · Ten highest uninsured rates · X | 178.7/196.0 → 122.2/194.0 | 178.7/256.0 → 178.7/254.0 |
| Community health by place · More uninsured, more early deaths · Y | 179.9/196.0 → 147.6/194.0 | 179.9/256.0 → 179.9/254.0 |
| Community health by place · More uninsured, more early deaths · X | 186.4/196.0 → 143.9/194.0 | 186.4/256.0 → 186.4/254.0 |
| Community health by place · Meridian runs above the state and U.S. on all six factors · X | 105.8/196.0 → 105.8/194.0 | 105.8/256.0 → 105.8/254.0 |
| Program outcomes & funder report · More Black and fewer White participants than the service area · X | 281.4/365.0 → 281.4/362.0 | 281.4/465.0 → 281.4/462.0 |
| System flow: inflow, outflow & actively homeless · Inflow and outflow trade places; the gap between them moves the count · Y | 123.3/365.0 → 123.3/362.0 | 123.3/465.0 → 123.3/462.0 |
| System flow: inflow, outflow & actively homeless · Peak 1,709 (Jan 2025); falling · Y | 170.0/280.7 → 170.4/278.0 | 170.0/360.7 → 170.4/358.0 |
| System flow: inflow, outflow & actively homeless · Single adults are half · X | 188.6/196.0 → 136.2/194.0 | 188.6/256.0 → 188.6/254.0 |
| City services: 311 operations · Closures trail openings in the last weeks · Y | 121.5/196.0 → 121.5/194.0 | 121.5/256.0 → 121.5/254.0 |
| City services: 311 operations · Medians beat every target · X | 223.2/196.0 → 134.1/194.0 | 223.2/256.0 → 167.0/254.0 |
| City services: 311 operations · District 6 is slowest · X | 152.7/196.0 → 152.7/194.0 | 152.7/256.0 → 152.7/254.0 |
| Performance scorecard (targets & thresholds) · Every perspective improved for four quarters · Y | 137.4/196.0 → 137.4/194.0 | 137.4/256.0 → 137.4/254.0 |
| Executive overview · Ahead of 2025 every month · Y | 100.6/280.7 → 100.8/278.0 | 100.6/360.7 → 100.8/358.0 |
| Executive overview · Tech under · X | 183.1/280.7 → 183.5/278.0 | 183.1/360.7 → 183.5/358.0 |
| Executive overview · Actual vs budget, year to date ($M): Technology furthest under at 89% · X | 117.0/280.7 → 117.3/278.0 | 117.0/360.7 → 117.3/358.0 |
| Sales performance · 3 of 10 reps at quota · X | 165.3/196.0 → 110.0/194.0 | 165.3/256.0 → 165.3/254.0 |
| Sales performance · Beat last year in 10 of 12 months · Y | 100.0/196.0 → 100.0/194.0 | 100.0/256.0 → 100.0/254.0 |
| Sales performance · Thins fast after Proposal · Y | 132.8/196.0 → 132.8/194.0 | 132.8/256.0 → 132.8/254.0 |
| Sales performance · Big = slow · Y | 97.2/196.0 → 97.2/194.0 | 97.2/256.0 → 97.2/254.0 |
| Sales performance · Big = slow · X | 101.0/196.0 → 101.0/194.0 | 101.0/256.0 → 101.0/254.0 |

## Validation and handback

- Base: node 224/224; browser 220; sweep 72/72.
- Head: node 225/225; sweep 72/72; production build passes. Browser **221/221** passed unsandboxed in 5.3m.
- The existing S4 table test settles resize frames and confirms retained focus before its unchanged ArrowRight/scroll assertion, matching the S5 harness pattern. No table product code changed.
- Added one node test for complete wrapped titles and one browser test covering the 72 combinations. Browser count: 221.
- Browser-generated tracked screenshots and diagnostics were restored to HEAD before final worktree review. The local output directory contains baseline and head measurements and inspected screenshots, not staged product assets.
- No sandbox-deferred checks remain; Cinder may reproduce both suites on the seat.
- Port 4173 verified free after Playwright shut down its server.
- Not done: S7 palette toggle and tile-title treatment; merge (Nate's).
