# S7 palette toggle and tile titles

## §0

Verified the authorized pre-fetched local `origin/main` at `a423cbf3d3d2fce25b8c2b335c9fb1f1e66f07c0` before cutting `fix/s7-palette-toggle-titles`. Before any source edit, the approved standalone commands ran unsandboxed: `npm test` passed **225/225**, including the spawn-bound generator, with sweep **ALL 72 OK**; `npm run test:browser` passed **221** in 5.5m. Nothing is reported as a partial suite count.

At 1280×800, the fresh replacement-width census reproduces **39 clipped open / 34 clipped simulated closed** across 52 editable titles in the starter and 11 templates. The rendered-text measurement includes the input's computed font and letter spacing, compared with its content width (client width minus horizontal padding); 1px is allowed for fractional geometry. Omitting letter spacing changes the closed count to 32, so that shortcut is explicitly not used. KPI bounds remain **0 failures / 12 tiles**, in each palette state.

## Behavior and judgment calls

A native **Hide charts / Show charts** button lives beside the page tabs in the edit canvas chrome. It has `aria-controls="palette"` and `aria-expanded`, accepts Enter and Space, and keeps focus when toggled. Hiding the sidebar expands the 1280px canvas from **1016px to 1256px**, exactly matching the census's simulated closed width. GridStack reflows and charts redraw; tile grid coordinates and sizes do not change.

The preference lives in `dashboard-builder:palette-closed:v1`, separate from dashboard data, and persists through present/exit and reload. Storage failures leave a working session preference. Present hides edit controls and the palette while retaining that preference. Responsive auto-collapse keeps the existing Add chart modal and hides the redundant toggle; Add chart reopens a manually hidden palette when appropriate. Removing a chart while manually closed returns focus to the toggle.

Editable titles are full-width native multiline textareas, using the existing **14px** title font and letter spacing. They grow when their value, width or loaded font changes. Short titles use one line, most longer titles use two, and the longest census titles use up to four open / three closed. **Two lines are a treatment, not a clipping cap:** full visibility wins over a rigid two-line clamp. Long unbroken units wrap without ellipsis, and editing/save/reload retains the complete value. Notes retain their compact S3 toolbar.

Action buttons share the data-source row when space allows and retain their accessible names; their existing compact label tiers engage earlier to avoid consuming chart height. This preserves the S1 KPI and legacy resize contracts rather than shrinking title text or changing tile sizes.

## Comparable title measurement

The comparison remains **rendered text width against available editor content width**. A single-line baseline input has one rendered line. At head, an identically styled DOM mirror measures the wrapped line fragments, including letter spacing; native textarea `scrollWidth` and `scrollHeight` additionally prove there is no hidden horizontal or vertical content. Every one of the same **52 titles per state** remains in the audit; no hidden-input zero is used. Full values, available widths, unwrapped diagnostic widths, widest rendered lines, fonts and line counts are recorded in `output/s7-palette-toggle-titles/head-measurements.json`.

For transparency, 23 open / 14 closed head strings would still exceed their newly widened editor width if forced back to one line. They are fully visible by wrapping. Those counterfactual one-line widths are not clipped rendered titles.

| Dashboard | Base open | Base closed | Head open | Head closed |
|---|---:|---:|---:|---:|
| Starter | 4 | 3 | 0 | 0 |
| Homeless system performance (CoC) | 3 | 3 | 0 | 0 |
| Behavioral health quality (CCBHC) | 4 | 4 | 0 | 0 |
| Health center quality (UDS) | 3 | 3 | 0 | 0 |
| Overdose & SUD community surveillance | 4 | 4 | 0 | 0 |
| Community health by place | 4 | 4 | 0 | 0 |
| Program outcomes & funder report | 2 | 2 | 0 | 0 |
| System flow: inflow, outflow & actively homeless | 3 | 2 | 0 | 0 |
| City services: 311 operations | 4 | 3 | 0 | 0 |
| Performance scorecard (targets & thresholds) | 2 | 2 | 0 | 0 |
| Executive overview | 3 | 2 | 0 | 0 |
| Sales performance | 3 | 2 | 0 | 0 |
| **Total** | **39** | **34** | **0** | **0** |

Both head states also retain **0 KPI failures across 12 tiles**, with card text and View data lines inside their bodies and no inner scroll. Screenshots of the starter, CoC and other exemplar templates were visually inspected in both states; full titles paint and the canvas gains the expected width.

## Validation and handback

Base: node 225/225; browser 221; sweep 72/72. Head: **node 225/225; browser 223 passed (6.4m); sweep ALL 72 OK**. Production build passes. No deferred checks remain. Two S7 browser tests were added; no node tests were added. Targeted S7, S1/S3 and legacy resize checks pass. The passing full head browser run includes S4 table reachability, S5 panels and keyboard scrolling, and S6 axes/ticks.

Browser-generated tracked screenshots and diagnostics are restored to HEAD before final worktree review. Port 4173 is verified free after the server stops. Local measurement JSON and inspected screenshots remain in `output/s7-palette-toggle-titles/`, outside the committed product changes.

Not done: Cinder review and Nate's merge. There is no S8 in this fit programme.
