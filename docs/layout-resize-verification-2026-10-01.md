# Chart placement, scaling and resize verification

Implemented October 1, 2026 under the approved [build plan](layout-resize-build-plan-2026-10-01.md).

## Result

Fresh dashboards use a full-width KPI row, paired bar/line plots and paired donut/scatter plots. The composer has one heading per tile and a Settings disclosure for units, chart options and Fit content. Plots use measured width and height, responsive margins and facet columns. Wrapped legends, source lines, transformation notices and data disclosures have measured space. The data table state survives resize redraws.

GridStack uses 24px rows and disables layout animation. Chart redraws run once per animation frame during resize and after pointer release, outside GridStack's synchronous cleanup. Manual intent starts with the gesture and persists as sizing: manual. Automatic fitting checks intent again before updating geometry.

V3 layouts declare rowHeight: 24. V1/V2 migration multiplies y/h by three, preserving pixel dimensions, x/w, and explicit data bindings. User templates carry the row contract to prevent repeated migration. HTML exports use row geometry with inset gutters; print uses intrinsic chart sizes.

## Verification

- npm test: 36 chart/theme combinations and 14 focused regressions passed.
- npm run build: composer and single-file export built successfully. Vite's existing large-bundle warning remains.
- Playwright with installed Chrome: all 14 acceptance tests passed, including the existing data/storage/SQL regressions and four new layout/resize checks.
- New pointer checks cover redraw before mouseup, increasing useful plot height, normal/outside mouseup, consecutive gestures, Escape, and no movement after release.
- Reload, actual data-binding changes, present mode, Fit content persistence, legacy import, user-template row preservation, offline HTML and print passed.
- At 1440×900, every starter chart frame fits its content without horizontal or vertical scrolling. At 1024×768, frames have no horizontal overflow; compact titles truncate with a full-title tooltip. Manual tiles below readable plot dimensions use one outer scrolling fallback.

On the retained sample-bar run, the first changed plot redraw occurred 43.5ms after pointer motion began. Plot width/height grew from 530×212 to 630×275 during the gesture, then settled at 628×284. This is a local diagnostic measurement, not a latency guarantee for all datasets or devices.

## Evidence

- [Pointer measurements](diagnostics/layout-resize-2026-10-01/pointer-result.json)
- [1440×900 screenshot](diagnostics/layout-resize-2026-10-01/verified-1440.png)
- [1024×768 screenshot](diagnostics/layout-resize-2026-10-01/verified-1024.png)
- [Print PDF](diagnostics/layout-resize-2026-10-01/verified-print.pdf)
- Browser acceptance can be reproduced with `npx playwright test`; the JSON reporter writes to ignored `test-results/browser-results.json`.

Legacy saved dashboards retain their arrangement rather than adopting the fresh starter composition. Browser acceptance was run against the local Vite server with isolated storage; hosted acceptance was not part of this verification.
