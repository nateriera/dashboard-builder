# Remaining public-app fixes

October 1, 2026. Continues the findings in [the original live report](browser-report.md).

## Changes

- Data popovers observe content and size changes, window resizing and scrolling. Placement is clamped inside an eight-pixel viewport inset, with internal scrolling and a sticky Apply action. Closing disconnects observers and event listeners.
- KPI values use an explicit line height. Narrow donuts use an aligned, wrapping legend with measured spacing and readable center text. Transformation notes use compact margins in the composer. Existing tile geometry and data bindings are preserved.
- The README prominently links to the published demo. The displayed build label is `2f-pages-fit`.

## Local verification

- `npm test`: 36 chart/theme renders and 14 focused tests passed.
- `npm run build`: passed; Vite retains the existing large-chunk warning.
- Full Playwright suite with installed Chrome: 15 tests passed. The new SQL regression uses pointer clicks for Run and Apply after expansion, query results and resizing from 1160×884 to 1024×768. Reopening and Escape verify cleanup. Starter frame bounds are checked horizontally and vertically at 1440, 1160 and 1024 pixels wide.
- In-app Chromium at 1024×768: all five frames fit. KPI height/scroll height: 243/243; donut: 411/411. This verifies the browser scrollbar/font case that previously overflowed despite passing headless checks.
- Existing pointer resize, persistence, import recovery, SQL precision and offline HTML regressions pass.

## Repository metadata limitation

The attempted GitHub About homepage update returned HTTP 404 using the available CLI credentials. The browser and connected GitHub account are `klarollc`, while the repository belongs to `nateriera`; the browser does not expose repository Settings or About editing. The direct README demo link is included in this release. Setting the About website requires owner settings access.

Published release checks will be recorded separately after GitHub Pages deployment.
